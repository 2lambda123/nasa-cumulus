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

import { MigrationSummary } from './types';

const logger = new Logger({ sender: '@cumulus/data-migration/granules' });
const { getBucket, getKey } = require('@cumulus/api/lib/FileUtils');
const { deconstructCollectionId } = require('@cumulus/api/lib/utils');

export interface GranulesAndFilesMigrationSummary {
  granulesSummary: MigrationSummary,
  filesSummary: MigrationSummary,
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

  // Schema validation on Dynamo record will fail if `record.execution`
  // does not exist
  const executionCumulusId = await executionPgModel.getRecordCumulusId(
    knex,
    {
      url: record.execution,
    }
  );

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
 * @param {GranulesAndFilesMigrationSummary} granuleAndFileMigrationSummary
 * @param {Knex} knex
 * @param {number} loggingInterval
 * @returns {Promise<MigrationSummary>} - Migration summary for granules and files
 */
export const migrateGranuleAndFilesViaTransaction = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  granuleAndFileMigrationSummary: GranulesAndFilesMigrationSummary,
  knex: Knex,
  loggingInterval: number
): Promise<GranulesAndFilesMigrationSummary> => {
  const files = dynamoRecord.files;
  const { granulesSummary, filesSummary } = granuleAndFileMigrationSummary;

  granulesSummary.dynamoRecords += 1;
  filesSummary.dynamoRecords += files.length;

  if (granulesSummary.dynamoRecords % loggingInterval === 0) {
    logger.info(`Batch of ${loggingInterval} granule records processed, ${granulesSummary.dynamoRecords} total`);
  }

  try {
    await knex.transaction(async (trx) => {
      const granuleCumulusId = await migrateGranuleRecord(dynamoRecord, trx);
      return Promise.all(files.map(
        async (file : ApiFile) => migrateFileRecord(file, granuleCumulusId, trx)
      ));
    });
    granulesSummary.success += 1;
    filesSummary.success += files.length;
  } catch (error) {
    if (error instanceof RecordAlreadyMigrated) {
      granulesSummary.skipped += 1;
    } else {
      granulesSummary.failed += 1;
      filesSummary.failed += files.length;
      logger.error(
        `Could not create granule record and file records in RDS for DynamoDB Granule granuleId: ${dynamoRecord.granuleId} with files ${dynamoRecord.files}`,
        error
      );
    }
  }

  return { granulesSummary, filesSummary };
};

export const migrateGranulesAndFiles = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<GranulesAndFilesMigrationSummary> => {
  const loggingInterval = env.loggingInterval ? Number.parseInt(env.loggingInterval, 10) : 100;
  const granulesTable = envUtils.getRequiredEnvVar('GranulesTable', env);

  const searchQueue = new DynamoDbSearchQueue({
    TableName: granulesTable,
  });

  const granuleMigrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  const fileMigrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  const summary = {
    granulesSummary: granuleMigrationSummary,
    filesSummary: fileMigrationSummary,
  };

  let record = await searchQueue.peek();

  /* eslint-disable no-await-in-loop */
  while (record) {
    // eslint-disable-next-line max-len
    const migrationSummary = await migrateGranuleAndFilesViaTransaction(record, summary, knex, loggingInterval);
    summary.granulesSummary = migrationSummary.granulesSummary;
    summary.filesSummary = migrationSummary.filesSummary;

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`Successfully migrated ${summary.granulesSummary.success} granule records.`);
  logger.info(`Successfully migrated ${summary.filesSummary.success} file records.`);
  return { granulesSummary: summary.granulesSummary, filesSummary: summary.filesSummary };
};
