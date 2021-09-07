'use strict';

const get = require('lodash/get');
const groupBy = require('lodash/groupBy');
const chunk = require('lodash/chunk');
const pMap = require('p-map');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueGranuleIngestMessage } = require('@cumulus/ingest/queue');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { buildExecutionArn } = require('@cumulus/message/Executions');
const { providers: providersApi } = require('@cumulus/api-client');
const CollectionConfigStore = require('@cumulus/collection-config-store');

async function fetchGranuleProvider(prefix, providerId) {
  const { body } = await providersApi.getProvider({
    prefix,
    providerId,
  });

  return JSON.parse(body);
}

/**
 * Group granules by collection and split into batches
 *
 * @param {Array<Object>} granules - list of input granules
 * @param {number} [batchSize] - size of batch of granules to queue
 * @returns {Array<Object>} list of lists of granules: each list contains granules which belong
 *                          to the same collection, and each list's max length is set by batchSize
 */
function groupAndBatchGranules(granules, batchSize = 1) {
  const granulesByCollectionMap = groupBy(
    granules,
    (g) => constructCollectionId(g.dataType, g.version)
  );
  return Object.values(granulesByCollectionMap).reduce(
    (arr, granulesByCollection) => arr.concat(chunk(granulesByCollection, batchSize)),
    []
  ); // possible TODO - separate batches by provider?
}
exports.groupAndBatchGranules = groupAndBatchGranules;

/**
* See schemas/input.json and schemas/config.json for detailed event description
*
* @param {Object} event - Lambda event object
* @returns {Promise} - see schemas/output.json for detailed output schema
*   that is passed to the next task in the workflow
**/
async function queueGranules(event) {
  const granules = event.input.granules || [];

  const collectionConfigStore = new CollectionConfigStore(
    event.config.internalBucket,
    event.config.stackName
  );

  const arn = buildExecutionArn(
    get(event, 'cumulus_config.state_machine'), get(event, 'cumulus_config.execution_name')
  );

  const groupedAndBatchedGranules = groupAndBatchGranules(
    granules,
    event.config.preferredQueueBatchSize
  );

  const executionArns = await pMap(
    groupedAndBatchedGranules,
    async (granuleBatch) => {
      const collectionConfig = await collectionConfigStore.get(
        granuleBatch[0].dataType,
        granuleBatch[0].version
      );
      return enqueueGranuleIngestMessage({
        granules: granuleBatch,
        queueUrl: event.config.queueUrl,
        granuleIngestWorkflow: event.config.granuleIngestWorkflow,
        provider: granuleBatch[0].provider // TODO: is this a safe assumption?
          ? await fetchGranuleProvider(event.config.stackName, granuleBatch[0].provider)
          : event.config.provider,
        collection: collectionConfig,
        pdr: event.input.pdr,
        parentExecutionArn: arn,
        stack: event.config.stackName,
        systemBucket: event.config.internalBucket,
        executionNamePrefix: event.config.executionNamePrefix,
        additionalCustomMeta: event.config.childWorkflowMeta,
      });
    },
    { concurrency: get(event, 'config.concurrency', 3) }
  );

  const result = { running: executionArns };
  if (event.input.pdr) result.pdr = event.input.pdr;
  return result;
}
exports.queueGranules = queueGranules;

/**
 * Lambda handler
 *
 * @param {Object} event      - a Cumulus Message
 * @param {Object} context    - an AWS Lambda context
 * @returns {Promise<Object>} - Returns output from task.
 *                              See schemas/output.json for detailed output schema
 */
async function handler(event, context) {
  return await cumulusMessageAdapter.runCumulusTask(queueGranules, event, context);
}
exports.handler = handler;
