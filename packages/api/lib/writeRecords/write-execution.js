const isNil = require('lodash/isNil');

const {
  createRejectableTransaction,
  ExecutionPgModel,
  translateApiExecutionToPostgresExecution,
  translatePostgresExecutionToApiExecution,
} = require('@cumulus/db');
const {
  upsertExecution,
} = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const {
  getMessageExecutionArn,
  getExecutionUrlFromArn,
  getMessageCumulusVersion,
  getMessageExecutionOriginalPayload,
  getMessageExecutionFinalPayload,
  generateExecutionApiRecordFromMessage,
} = require('@cumulus/message/Executions');
const {
  getMetaStatus,
  getMessageWorkflowTasks,
  getMessageWorkflowName,
  getMessageWorkflowStartTime,
  getMessageWorkflowStopTime,
  getWorkflowDuration,
} = require('@cumulus/message/workflows');
const { parseException } = require('@cumulus/message/utils');

const { removeNilProperties } = require('@cumulus/common/util');
const Logger = require('@cumulus/logger');

const { publishExecutionSnsMessage } = require('../publishSnsMessageUtils');
const Execution = require('../../models/executions');

const logger = new Logger({ sender: '@cumulus/api/lib/writeRecords/write-execution' });

const shouldWriteExecutionToPostgres = ({
  messageCollectionNameVersion,
  collectionCumulusId,
  messageAsyncOperationId,
  asyncOperationCumulusId,
  messageParentExecutionArn,
  parentExecutionCumulusId,
}) => {
  const noMessageCollectionOrExistsInPostgres = isNil(messageCollectionNameVersion)
    || !isNil(collectionCumulusId);
  const noMessageAsyncOperationOrExistsInPostgres = isNil(messageAsyncOperationId)
    || !isNil(asyncOperationCumulusId);
  const noMessageParentExecutionOrExistsInPostgres = isNil(messageParentExecutionArn)
    || !isNil(parentExecutionCumulusId);

  return noMessageCollectionOrExistsInPostgres
    && noMessageAsyncOperationOrExistsInPostgres
    && noMessageParentExecutionOrExistsInPostgres;
};

const buildExecutionRecord = ({
  cumulusMessage,
  asyncOperationCumulusId,
  collectionCumulusId,
  parentExecutionCumulusId,
  now = new Date(),
  updatedAt = Date.now(),
}) => {
  const arn = getMessageExecutionArn(cumulusMessage);
  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
  const workflowStopTime = getMessageWorkflowStopTime(cumulusMessage);

  return removeNilProperties({
    arn,
    status: getMetaStatus(cumulusMessage),
    url: getExecutionUrlFromArn(arn),
    cumulus_version: getMessageCumulusVersion(cumulusMessage),
    tasks: getMessageWorkflowTasks(cumulusMessage),
    workflow_name: getMessageWorkflowName(cumulusMessage),
    created_at: workflowStartTime ? new Date(workflowStartTime) : undefined,
    timestamp: now,
    updated_at: new Date(updatedAt),
    error: parseException(cumulusMessage.exception),
    original_payload: getMessageExecutionOriginalPayload(cumulusMessage),
    final_payload: getMessageExecutionFinalPayload(cumulusMessage),
    duration: getWorkflowDuration(workflowStartTime, workflowStopTime),
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: parentExecutionCumulusId,
  });
};

const writeExecutionToES = async (params) => {
  const {
    apiRecord,
    esClient = await Search.es(),
  } = params;
  return await upsertExecution({
    esClient,
    updates: apiRecord,
    index: process.env.ES_INDEX,
  });
};

/**
 * Write execution record to databases
 *
 * @param {Object} params
 * @param {Object} params.apiRecord - Execution API record to be written
 * @param {Object} params.postgresRecord - Execution PostgreSQL record to be written
 * @param {Object} params.knex - Knex client
 * @param {Object} [params.executionPgModel] - PostgreSQL execution model
 * @param {number} [params.updatedAt] - updatedAt timestamp to use when writing records
 * @param {Object} [params.esClient] - Elasticsearch client
 * @returns {Promise<Object>} - PostgreSQL execution record that was written to the database
 */
const _writeExecutionRecord = ({
  apiRecord,
  postgresRecord,
  knex,
  executionPgModel = new ExecutionPgModel(),
  updatedAt = Date.now(),
  esClient,
}) => createRejectableTransaction(knex, async (trx) => {
  logger.info(`About to write execution ${postgresRecord.arn} to PostgreSQL`);
  const [executionPgRecord] = await executionPgModel.upsert(trx, postgresRecord);
  logger.info(`Successfully wrote execution ${postgresRecord.arn} to PostgreSQL with cumulus_id ${executionPgRecord.cumulus_id}`);
  try {
    await writeExecutionToES({
      apiRecord,
      updatedAt,
      esClient,
    });
    logger.info(`Successfully wrote Elasticsearch record for execution ${apiRecord.arn}`);
  } catch (error) {
    logger.info(`Write to Elasticsearch failed, rolling back data store write for execution ${apiRecord.arn}`);
    throw error;
  }
  return executionPgRecord;
});

/**
 * Write execution record to databases and publish SNS message
 *
 * @param {Object} params
 * @param {Object} params.apiRecord - Execution API record to be written
 * @param {Object} params.postgresRecord - Execution PostgreSQL record to be written
 * @param {Object} params.knex - Knex client
 * @param {Object} [params.executionPgModel] - PostgreSQL execution model
 * @param {number} [params.updatedAt] - updatedAt timestamp to use when writing records
 * @param {Object} [params.esClient] - Elasticsearch client
 * @returns {Promise<Object>} - PostgreSQL execution record that was written to the database
 */
const _writeExecutionAndPublishSnsMessage = async ({
  apiRecord,
  postgresRecord,
  knex,
  executionPgModel,
  updatedAt,
  esClient,
}) => {
  const writeExecutionResponse = await _writeExecutionRecord(
    {
      apiRecord,
      postgresRecord,
      knex,
      esClient,
      executionPgModel,
      updatedAt,
    }
  );
  const translatedExecution = await translatePostgresExecutionToApiExecution(
    writeExecutionResponse,
    knex
  );
  await publishExecutionSnsMessage(translatedExecution);
  return writeExecutionResponse;
};

const writeExecutionRecordFromMessage = async ({
  cumulusMessage,
  knex,
  collectionCumulusId,
  asyncOperationCumulusId,
  parentExecutionCumulusId,
  executionModel = new Execution(),
  updatedAt = Date.now(),
  esClient,
}) => {
  const postgresRecord = buildExecutionRecord({
    cumulusMessage,
    collectionCumulusId,
    asyncOperationCumulusId,
    parentExecutionCumulusId,
    updatedAt,
  });
  const executionApiRecord = generateExecutionApiRecordFromMessage(cumulusMessage, updatedAt);
  const writeExecutionResponse = await _writeExecutionAndPublishSnsMessage({
    apiRecord: executionApiRecord,
    postgresRecord,
    knex,
    executionModel,
    esClient,
  });
  return writeExecutionResponse.cumulus_id;
};

const writeExecutionRecordFromApi = async ({
  record: apiRecord,
  knex,
}) => {
  const postgresRecord = await translateApiExecutionToPostgresExecution(apiRecord, knex);
  return await _writeExecutionAndPublishSnsMessage({
    apiRecord,
    postgresRecord,
    knex,
  });
};

module.exports = {
  buildExecutionRecord,
  shouldWriteExecutionToPostgres,
  writeExecutionToES,
  writeExecutionRecordFromMessage,
  writeExecutionRecordFromApi,
};
