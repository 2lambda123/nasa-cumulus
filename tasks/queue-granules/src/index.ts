import { Context } from 'aws-lambda';
import get from 'lodash/get';
import isNumber from 'lodash/isNumber';
import memoize from 'lodash/memoize';
import pMap from 'p-map';
import cumulusMessageAdapter from '@cumulus/cumulus-message-adapter-js';
import { enqueueGranuleIngestMessage } from '@cumulus/ingest/queue';
import {
  getWorkflowFileKey,
  templateKey,
} from '@cumulus/common/workflows';
import { constructCollectionId, deconstructCollectionId } from '@cumulus/message/Collections';
import { buildExecutionArn } from '@cumulus/message/Executions';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { getJsonS3Object } from '@cumulus/aws-client/S3';

import {
  collections as collectionsApi,
  providers as providersApi,
  granules as granulesApi,
} from '@cumulus/api-client';
import { QueueGranulesInput, QueueGranulesConfig, QueueGranulesOutput } from './types';
import GroupAndChunkIterable from './iterable';

interface HandlerEvent {
  input: QueueGranulesInput,
  config: QueueGranulesConfig,
}

type ApiGranule = QueueGranulesInput['granules'][number];

async function fetchGranuleProvider(event: HandlerEvent, providerId?: string | null) {
  if (!providerId || providerId === event.config.provider.id) {
    return event.config.provider;
  }

  const { body } = await providersApi.getProvider({
    prefix: event.config.stackName,
    providerId,
  });

  return JSON.parse(body);
}

/**
 * Return the collectionId from a Granule if possible, otherwise throw an Error
 *
 * @param {ApiGranule} granule - the granule to get the collectionId from
 * @returns {String} the collectionId of the granule if has it in its properties'
 */
function getCollectionIdFromGranule(granule: ApiGranule): string {
  if (granule.collectionId) {
    return granule.collectionId;
  }
  if (granule.dataType && granule.version) {
    return constructCollectionId(granule.dataType, granule.version);
  }
  throw new Error('Invalid collection information provided, please check task input to make sure collection information is provided');
}

/**
 * Return an Iterable of granules, grouped by collectionId and provider, containing
 * chunks of granules to queue together.
 *
 * @param granules Granules to group and chunk
 * @param preferredBatchSize The max chunk size to use when chunking the groups (default 1)
 * @returns Iterable
 */
function createIterable(
  granules: ApiGranule[],
  preferredBatchSize: any
): GroupAndChunkIterable<ApiGranule, { collectionId: string, provider: string | undefined }> {
  return new GroupAndChunkIterable(
    granules,
    (granule) => {
      const collectionId = getCollectionIdFromGranule(granule);
      return { collectionId, provider: granule.provider };
    },
    isNumber(preferredBatchSize) && preferredBatchSize > 0 ? preferredBatchSize : 1
  );
}

/**
* Updates each granule in the 'batch' to the passed in createdAt value if one does not already exist
* @param {Array<BackwardsCompatibleApiGranule>} granuleBatch - Array of Cumulus Granule objects
* @param {number} createdAt           - 'Date.now()' to apply to the granules if there is no
*                                     existing createdAt value
* @returns {Array<Object>} updated array of Cumulus Granule objects
*/
function updateGranuleBatchCreatedAt(granuleBatch: ApiGranule[], createdAt: number): ApiGranule[] {
  return granuleBatch.map((granule) => ({
    ...granule,
    createdAt: granule.createdAt ? granule.createdAt : createdAt,
  }));
}

/**
 * See schemas/input.json and schemas/config.json for detailed event description
 *
 * @param {HandlerEvent} event - Lambda event object
 * @param {Object} testMocks - Object containing mock functions for testing
 * @returns {Promise<QueueGranulesOutput>} - see schemas/output.json for detailed output schema
 *   that is passed to the next task in the workflow
 **/
async function queueGranules(event: HandlerEvent): Promise<QueueGranulesOutput> {
  const granules = (event.input.granules || []);
  const memoizedFetchProvider = memoize(fetchGranuleProvider, (_, providerId) => providerId);
  const memoizedFetchCollection = memoize(
    collectionsApi.getCollection,
    ({ collectionName, collectionVersion }) => constructCollectionId(
      collectionName,
      collectionVersion
    )
  );
  const parentExecutionArn = buildExecutionArn(
    get(event, 'cumulus_config.state_machine')!,
    get(event, 'cumulus_config.execution_name')!
  )!;
  const pMapConcurrency = get(event, 'config.concurrency', 3);

  const messageTemplate = await getJsonS3Object(
    event.config.internalBucket,
    templateKey(event.config.stackName)
  );
  const { arn: granuleIngestWorkflowArn } = await getJsonS3Object(
    event.config.internalBucket,
    getWorkflowFileKey(event.config.stackName, event.config.granuleIngestWorkflow)
  );

  const executionArns = await pMap(
    createIterable(granules, event.config.preferredQueueBatchSize),
    async ({ provider, collectionId, chunks }) => {
      const { name: collectionName, version: collectionVersion } = deconstructCollectionId(
        collectionId
      );
      const [collection, normalizedProvider] = await Promise.all([
        memoizedFetchCollection({
          prefix: event.config.stackName,
          collectionName,
          collectionVersion,
        }),
        memoizedFetchProvider(event, provider),
      ]);

      return await pMap(
        chunks,
        async (granuleBatchIn) => {
          const granuleBatch = updateGranuleBatchCreatedAt(granuleBatchIn, Date.now());
          await granulesApi.bulkUpdateGranules({
            prefix: event.config.stackName,
            // @ts-ignore TODO: Need to update the typehint on the api-client method
            //    both bulkUpdate and update take ApiGranuleRecord which requires updatedAt
            granules: granuleBatch.map(({ granuleId, createdAt }) => ({
              collectionId,
              granuleId,
              status: 'queued',
              createdAt,
            })),
          });

          return await enqueueGranuleIngestMessage({
            messageTemplate,
            workflow: {
              name: event.config.granuleIngestWorkflow,
              arn: granuleIngestWorkflowArn,
            },
            granules: granuleBatch,
            queueUrl: event.config.queueUrl,
            provider: normalizedProvider,
            collection,
            pdr: event.input.pdr,
            parentExecutionArn,
            executionNamePrefix: event.config.executionNamePrefix,
            additionalCustomMeta: event.config.childWorkflowMeta,
          });
        },
        { concurrency: pMapConcurrency }
      );
    },
    // purposefully serial, the chunks run in parallel.
    { concurrency: 1 }
  );

  return {
    running: executionArns.flat(),
    ...(event.input.pdr ? { pdr: event.input.pdr } : {}),
  };
}

/**
 * Lambda handler
 *
 * @param {CumulusMessage | CumulusRemoteMessage} event - a Cumulus Message
 * @param {Context} context    - an AWS Lambda context
 * @returns {Promise<CumulusMessage | CumulusRemoteMessage>} - Returns output from task.
 */
async function handler(
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<CumulusMessage | CumulusRemoteMessage> {
  return await cumulusMessageAdapter.runCumulusTask(
    queueGranules,
    event,
    context
  );
}

export {
  createIterable,
  handler,
  queueGranules,
  updateGranuleBatchCreatedAt,
};
