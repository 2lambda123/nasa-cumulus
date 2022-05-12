'use strict';

const Logger = require('@cumulus/logger');
const asyncOperations = require('@cumulus/async-operations');
const models = require('../models');

const logger = new Logger({ sender: '@cumulus/api/start-async-operation' });

/**
 * Start an async operation
 *
 * @param {Object} event - A DynamoDB event
 * @returns {Promise}
 */
const handler = async (event) => {
  const dynamoTableName = process.env.AsyncOperationsTable;
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const cluster = process.env.EcsCluster;
  const asyncOperationTaskDefinition = process.env.AsyncOperationTaskDefinition;

  const {
    asyncOperationId, callerLambdaName, lambdaName, description, operationType, payload,
  } = event;

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationId,
    cluster,
    callerLambdaName,
    lambdaName,
    asyncOperationTaskDefinition,
    description,
    operationType,
    payload,
    stackName,
    systemBucket,
    dynamoTableName,
    knexConfig: process.env,
    useLambdaEnvironmentVariables: true,
  }, models.AsyncOperation);

  logger.info(`Started async operation ${asyncOperation.id} for ${operationType}`);
  return asyncOperation;
};

module.exports = { handler };
