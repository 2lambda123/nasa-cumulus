import Knex from 'knex';

import DynamoDbSearchQueue from '@cumulus/aws-client/DynamoDbSearchQueue';
import Logger from '@cumulus/logger';
import {
  CollectionPgModel,
  ExecutionPgModel,
  PdrPgModel,
  PostgresPdr,
  ProviderPgModel,
} from '@cumulus/db';
import { envUtils } from '@cumulus/common';
import {
  RecordAlreadyMigrated,
  RecordDoesNotExist,
  PostgresUpdateFailed,
} from '@cumulus/errors';

import { MigrationSummary } from '@cumulus/types/migrations';

const logger = new Logger({ sender: '@cumulus/data-migration/pdrs' });
const { deconstructCollectionId } = require('@cumulus/api/lib/utils');

/**
 * Migrate PDR record from Dynamo to RDS.
 *
 * @param {AWS.DynamoDB.DocumentClient.AttributeMap} dynamoRecord
 *   Record from DynamoDB
 * @param {Knex} knex - Knex client for writing to RDS database
 * @returns {Promise<number>} - Cumulus ID for record
 * @throws {RecordAlreadyMigrated} if record was already migrated
 * @throws {PostgresUpdateFailed} if the upsert effected 0 rows
 */
export const migratePdrRecord = async (
  dynamoRecord: AWS.DynamoDB.DocumentClient.AttributeMap,
  knex: Knex
): Promise<void> => {
  const { name, version } = deconstructCollectionId(dynamoRecord.collectionId);
  const collectionPgModel = new CollectionPgModel();
  const executionPgModel = new ExecutionPgModel();
  const pdrPgModel = new PdrPgModel();
  const providerPgModel = new ProviderPgModel();

  let existingRecord;

  try {
    existingRecord = await pdrPgModel.get(knex, { name: dynamoRecord.pdrName });
  } catch (error) {
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  const isExistingRecordNewer = existingRecord
    && existingRecord.updated_at >= new Date(dynamoRecord.updatedAt);

  if (isExistingRecordNewer) {
    throw new RecordAlreadyMigrated(`PDR name ${dynamoRecord.pdrName} was already migrated, skipping.`);
  }

  const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
    knex,
    { name, version }
  );

  const providerCumulusId = await providerPgModel.getRecordCumulusId(
    knex,
    { name: dynamoRecord.provider }
  );

  const executionCumulusId = dynamoRecord.execution
    ? await executionPgModel.getRecordCumulusId(
      knex,
      { arn: dynamoRecord.execution }
    )
    : undefined;

  // Map old record to new schema.
  const updatedRecord: PostgresPdr = {
    name: dynamoRecord.pdrName,
    provider_cumulus_id: providerCumulusId,
    collection_cumulus_id: collectionCumulusId,
    execution_cumulus_id: executionCumulusId,
    status: dynamoRecord.status,
    progress: dynamoRecord.progress,
    pan_sent: dynamoRecord.PANSent,
    pan_message: dynamoRecord.PANmessage,
    stats: dynamoRecord.stats,
    address: dynamoRecord.address,
    original_url: dynamoRecord.originalUrl,
    timestamp: dynamoRecord.timestamp ? new Date(dynamoRecord.timestamp) : undefined,
    duration: dynamoRecord.duration,
    created_at: new Date(dynamoRecord.createdAt),
    updated_at: dynamoRecord.updatedAt ? new Date(dynamoRecord.updatedAt) : undefined,
  };

  const [cumulusId] = await pdrPgModel.upsert(knex, updatedRecord);

  if (!cumulusId) {
    throw new PostgresUpdateFailed(`Upsert for PDR ${dynamoRecord.pdrName} returned no rows. Record was not updated in the Postgres table.`);
  }
};

export const migratePdrs = async (
  env: NodeJS.ProcessEnv,
  knex: Knex
): Promise<MigrationSummary> => {
  const pdrsTable = envUtils.getRequiredEnvVar('PdrsTable', env);
  const loggingInterval = env.loggingInterval ? Number.parseInt(env.loggingInterval, 10) : 100;

  const searchQueue = new DynamoDbSearchQueue({
    TableName: pdrsTable,
  });

  const migrationSummary = {
    dynamoRecords: 0,
    success: 0,
    failed: 0,
    skipped: 0,
  };

  let record = await searchQueue.peek();
  /* eslint-disable no-await-in-loop */
  while (record) {
    migrationSummary.dynamoRecords += 1;

    if (migrationSummary.dynamoRecords % loggingInterval === 0) {
      logger.info(`Batch of ${loggingInterval} PDR records processed, ${migrationSummary.dynamoRecords} total`);
    }
    try {
      await migratePdrRecord(record, knex);
      migrationSummary.success += 1;
    } catch (error) {
      if (error instanceof RecordAlreadyMigrated) {
        migrationSummary.skipped += 1;
      } else {
        migrationSummary.failed += 1;
        logger.error(
          `Could not create PDR record in RDS for Dynamo PDR name: ${record.pdrName}`,
          error
        );
      }
    }

    await searchQueue.shift();
    record = await searchQueue.peek();
  }
  /* eslint-enable no-await-in-loop */
  logger.info(`Successfully migrated ${migrationSummary.success} PDR records.`);
  return migrationSummary;
};
