'use strict';

const get = require('lodash/get');
const pMap = require('p-map');
const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const { enqueueGranuleIngestMessage } = require('@cumulus/ingest/queue');
const { buildExecutionArn } = require('@cumulus/message/Executions');
const {
  providers: providersApi,
  granules: granulesApi,
} = require('@cumulus/api-client');
const CollectionConfigStore = require('@cumulus/collection-config-store');

async function fetchGranuleProvider(prefix, providerId) {
  const { body } = await providersApi.getProvider({
    prefix,
    providerId,
  });

  return JSON.parse(body);
}

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
    get(event, 'cumulus_config.state_machine'),
    get(event, 'cumulus_config.execution_name')
  );

  const executionArns = await pMap(
    granules,
    async (granule) => {
      const collectionConfig = await collectionConfigStore.get(
        granule.dataType,
        granule.version
      );
      const executionArn = await enqueueGranuleIngestMessage({
        granule,
        queueUrl: event.config.queueUrl,
        granuleIngestWorkflow: event.config.granuleIngestWorkflow,
        provider: granule.provider
          ? await fetchGranuleProvider(event.config.stackName, granule.provider)
          : event.config.provider,
        collection: collectionConfig,
        pdr: event.input.pdr,
        parentExecutionArn: arn,
        stack: event.config.stackName,
        systemBucket: event.config.internalBucket,
        executionNamePrefix: event.config.executionNamePrefix,
        additionalCustomMeta: event.config.childWorkflowMeta,
      });
      if (executionArn) {
        const queuedGranule = {
          granuleId: granule.granuleId,
          status: 'queued',
          retries: 3,
        };
        await granulesApi.updateGranule({
          prefix: event.config.stackName,
          body: queuedGranule,
        });
      }
      return executionArn;
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
  return await cumulusMessageAdapter.runCumulusTask(
    queueGranules,
    event,
    context
  );
}
exports.handler = handler;
