'use strict';

const log = require('@cumulus/common/log');

const { s3 } = require('@cumulus/aws-client/services');
const { getJsonS3Object } = require('@cumulus/aws-client/S3');
const { getKnexClient } = require('@cumulus/db');
const { getMessageExecutionName } = require('@cumulus/message/Executions');

const { writeRecords } = require('./sf-event-sqs-to-db-records');

async function processDeadLetterArchive({
  knex,
  bucket = process.env.system_bucket,
  path = `${process.env.stackName}/dead-letter-archive/sqs/`,
  writeRecordsFunction = writeRecords,
  batchSize = 1000,
}) {
  let listObjectsResponse;
  let continuationToken;
  /* eslint-disable no-await-in-loop */
  do {
    listObjectsResponse = await s3().listObjectsV2({
      Bucket: bucket,
      Prefix: path,
      ContinuationToken: continuationToken,
      MaxKeys: batchSize,
    }).promise();
    continuationToken = listObjectsResponse.NextContinuationToken;
    const deadLetterObjects = listObjectsResponse.Contents;
    const promises = await Promise.allSettled(deadLetterObjects.map(
      async (deadLetterObject) => {
        const cumulusMessage = await getJsonS3Object(bucket, deadLetterObject.Key);
        try {
          await writeRecordsFunction({ cumulusMessage, knex });
          return deadLetterObject.Key;
        } catch (error) {
          const executionName = getMessageExecutionName(cumulusMessage);
          log.error(`Failed to write records from cumulusMessage for execution ${executionName}, reason: `, error);
          throw error;
        }
      }
    ));
    const keysToDelete = promises.filter(
      (prom) => prom.status === 'fulfilled'
    ).map((prom) => ({ Key: prom.value }));
    await s3().deleteObjects({
      Bucket: bucket,
      Delete: {
        Objects: keysToDelete,
      },
    }).promise();
  } while (listObjectsResponse.IsTruncated);
  /* eslint-enable no-await-in-loop */
}

/**
 * Lambda handler for AsyncOperation purposes
 *
 * @param {Object} event - Input payload object
 * @param {string} [event.bucket] - Bucket containing dead letter archive (default to system bucket)
 * @param {string} [event.key] - Dead letter archive path key
 * @returns {Promise<undefined>}
 */
async function handler(event) {
  const knex = await getKnexClient({
    env: {
      ...process.env,
      ...event.env,
    },
  });
  const {
    bucket,
    path,
  } = event;
  return processDeadLetterArchive({ knex, bucket, path });
}

module.exports = {
  handler,
  processDeadLetterArchive,
};
