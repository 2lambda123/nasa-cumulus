import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import { ApiFile } from '@cumulus/types/api/files';
import {
  CollectionPgModel,
  ExecutionPgModel,
  GranulePgModel,
  upsertGranuleWithExecutionJoinRecord,
  FilePgModel,
  PostgresFile,
  translateApiGranuleToPostgresGranule,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import Logger from '@cumulus/logger';

import {
  RecordAlreadyMigrated,
  RecordDoesNotExist,
  PostgresUpdateFailed,
} from '@cumulus/errors';

import {
  GranuleDynamoDbSearchParams,
  MigrationResult,
  GranulesMigrationResult,
} from '@cumulus/types/migration';

const logger = new Logger({ sender: '@cumulus/data-migration/granules' });
const { getBucket, getKey } = require('@cumulus/api/lib/FileUtils');
const { deconstructCollectionId } = require('@cumulus/api/lib/utils');

export interface GranulesAndFilesMigrationResult {
  granulesResult: GranulesMigrationResult,
  filesResult: MigrationResult,
}

/**
 * Migrate granules record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} record
 *   Record from DynamoDB
 * @param {Knex.Transaction} knex - Knex transaction
 * @returns {Promise<any>}
 * @throws {RecordAlreadyMigrated} if record was already migrated
 * @throws {PostgresUpdateFailed} if the granule upsert effected 0 rows
 */
export const migrateGranuleRecord = async (
  record: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex.Transaction
): Promise<number> => {
  const { name, version } = deconstructCollectionId(record.collectionId);
  const collectionPgModel = new CollectionPgModel();
  const executionPgModel = new ExecutionPgModel();
  const granulePgModel = new GranulePgModel();

  const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
    knex,
    { name, version }
  );

  // It's possible that very old records could have this field be undefined
  const executionCumulusId = record.execution
    ? await executionPgModel.getRecordCumulusId(
      knex,
      {
        url: record.execution,
      }
    )
    : undefined;

  let existingRecord;

  try {
    existingRecord = await granulePgModel.get(knex, {
      granule_id: record.granuleId,
      collection_cumulus_id: collectionCumulusId,
    });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  const isExistingRecordNewer = existingRecord
    && existingRecord.updated_at >= new Date(record.updatedAt);

  if (isExistingRecordNewer) {
    throw new RecordAlreadyMigrated(`Granule ${record.granuleId} was already migrated, skipping`);
  }

  const granule = await translateApiGranuleToPostgresGranule(record, knex);

  const [cumulusId] = await knex.transaction((trx) => upsertGranuleWithExecutionJoinRecord(
    trx,
    granule,
    executionCumulusId
  ));

  if (!cumulusId) {
    throw new PostgresUpdateFailed(`Upsert for granule ${record.granuleId} returned no rows. Record was not updated in the Postgres table.`);
  }

  return cumulusId;
};

/**
 * Migrate File record from a Granules record from DynamoDB  to RDS.
 *
 * @param {ApiFile} file - Granule file
 * @param {number} granuleCumulusId - ID of granule
 * @param {Knex.Transaction} trx - Knex transaction
 * @returns {Promise<void>}
 * @throws {RecordAlreadyMigrated} if record was already migrated
 */
export const migrateFileRecord = async (
  file: ApiFile,
  granuleCumulusId: number,
  trx: Knex.Transaction
): Promise<void> => {
  const filePgModel = new FilePgModel();

  const bucket = getBucket(file);
  const key = getKey(file);

  // Map old record to new schema.
  const updatedRecord: PostgresFile = {
    bucket,
    key,
    granule_cumulus_id: granuleCumulusId,
    file_size: file.size,
    checksum_value: file.checksum,
    checksum_type: file.checksumType,
    file_name: file.fileName,
    source: file.source,
    path: file.path,
  };
  await filePgModel.upsert(trx, updatedRecord);
};

/**
 * Migrate granule and files from DynamoDB to RDS
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 * @param {GranulesAndFilesMigrationResult} granuleAndFileMigrationResult
 * @param {Knex} knex
 * @param {number} loggingInterval
 * @returns {Promise<MigrationSummary>} - Migration summary for granules and files
 */
export const migrateGranuleAndFilesViaTransaction = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  granuleAndFileMigrationResult: GranulesAndFilesMigrationResult,
  knex: Knex,
  loggingInterval: number
): Promise<GranulesAndFilesMigrationResult> => {
  const files = dynamoRecord.files ?? [];
  const { granulesResult, filesResult } = granuleAndFileMigrationResult;

  granulesResult.total_dynamo_db_records += 1;
  filesResult.total_dynamo_db_records += files.length;

  if (granulesResult.total_dynamo_db_records % loggingInterval === 0) {
    logger.info(`Batch of ${loggingInterval} granule records processed, ${granulesResult.total_dynamo_db_records} total`);
  }

  try {
    await knex.transaction(async (trx) => {
      const granuleCumulusId = await migrateGranuleRecord(dynamoRecord, trx);
      return Promise.all(files.map(
        async (file : ApiFile) => migrateFileRecord(file, granuleCumulusId, trx)
      ));
    });
    granulesResult.migrated += 1;
    filesResult.migrated += files.length;
  } catch (error) {
    if (error instanceof RecordAlreadyMigrated) {
      granulesResult.skipped += 1;
    } else {
      granulesResult.failed += 1;
      filesResult.failed += files.length;
      logger.error(
        `Could not create granule record and file records in RDS for DynamoDB Granule granuleId: ${dynamoRecord.granuleId} with files ${dynamoRecord.files}`,
        error
      );
    }
  }

  return { granulesResult, filesResult };
};

/**
 * Query DynamoDB for granule records to create granule/file records in PostgreSQL.
 *
 * @param {NodeJS.ProcessEnv} env - Environment variables which may contain configuration
 * @param {number} env.loggingInterval
 *   Sets the interval number of records when a log message will be written on migration progress
 * @param {Knex} knex - Instance of a database client
 * @param {GranuleDynamoDbSearchParams} granuleSearchParams
 *   Parameters to control data selected for migration
 * @param {string} granuleSearchParams.granuleId
 *   Granule ID to use for querying granules to migrate
 * @param {string} granuleSearchParams.collectionId
 *   Collection name/version to use for querying granules to migrate
 * @returns {Promise<GranulesAndFilesMigrationResult>}
 *   Result object summarizing the granule/files migration
 */
export const migrateGranulesAndFiles = async (
  env: NodeJS.ProcessEnv,
  knex: Knex,
  granuleSearchParams: GranuleDynamoDbSearchParams = {}
): Promise<GranulesAndFilesMigrationResult> => {
  const loggingInterval = env.loggingInterval ? Number.parseInt(env.loggingInterval, 10) : 100;
  const granulesTable = envUtils.getRequiredEnvVar('GranulesTable', env);

  const granuleMigrationResult: GranulesMigrationResult = {
    filters: granuleSearchParams,
    total_dynamo_db_records: 0,
    migrated: 0,
    failed: 0,
    skipped: 0,
  };

  const fileMigrationResult: MigrationResult = {
    total_dynamo_db_records: 0,
    migrated: 0,
    failed: 0,
    skipped: 0,
  };

  const migrationResult = {
    granulesResult: granuleMigrationResult,
    filesResult: fileMigrationResult,
  };

  let extraSearchParams = {};
  type searchType = 'scan' | 'query';
  let dynamoSearchType: searchType = 'scan';

  if (granuleSearchParams.granuleId) {
    dynamoSearchType = 'query';
    extraSearchParams = {
      KeyConditionExpression: 'granuleId = :granuleId',
      ExpressionAttributeValues: {
        ':granuleId': granuleSearchParams.granuleId,
      },
    };
  } else if (granuleSearchParams.collectionId) {
    dynamoSearchType = 'query';
    extraSearchParams = {
      IndexName: 'collectionId-granuleId-index',
      KeyConditionExpression: 'collectionId = :collectionId',
      ExpressionAttributeValues: {
        ':collectionId': granuleSearchParams.collectionId,
      },
    };
  }

  const searchQueue = new DynamoDbSearchQueue(
    {
      TableName: granulesTable,
      ...extraSearchParams,
    },
    dynamoSearchType
  );

  let record = await searchQueue.peek();

  /* eslint-disable no-await-in-loop */
  while (record) {
    // eslint-disable-next-line max-len
    const result = await migrateGranuleAndFilesViaTransaction(record, migrationResult, knex, loggingInterval);
    migrationResult.granulesResult = result.granulesResult;
    migrationResult.filesResult = result.filesResult;

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`Successfully migrated ${migrationResult.granulesResult.migrated} granule records.`);
  logger.info(`Successfully migrated ${migrationResult.filesResult.migrated} file records.`);
  return migrationResult;
};
