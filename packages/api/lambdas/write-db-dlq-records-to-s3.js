//@ts-check

'use strict';

const get = require('lodash/get');
const uuidv4 = require('uuid/v4');

const log = require('@cumulus/common/log');
const { isEventBridgeEvent } = require('@cumulus/aws-client/Lambda');
const { s3PutObject } = require('@cumulus/aws-client/S3');
const { parseSQSMessageBody, isSQSRecordLike } = require('@cumulus/aws-client/SQS');
const { unwrapDeadLetterCumulusMessage, isDLQRecordLike } = require('@cumulus/message/DeadLetterMessage');
const { getCumulusMessageFromExecutionEvent } = require('@cumulus/message/StepFunctions');
/**
 *
 * @typedef {import('@cumulus/types/message').CumulusMessage} CumulusMessage
 * @typedef {import('@cumulus/types').MessageGranule} MessageGranule
 * @typedef {{granules: Array<MessageGranule>}} PayloadWithGranules
 * @typedef {import('@cumulus/types/api/dead_letters').DLQRecord} DLQRecord
 * @typedef {import('@cumulus/types/api/dead_letters').DLARecord} DLARecord
 * @typedef {import('aws-lambda').EventBridgeEvent} EventBridgeEvent
 */

/**
 * @param {unknown} payload
 * @returns {payload is PayloadWithGranules}
 */
function payloadHasGranules(payload) {
  return (
    payload instanceof Object
    && 'granules' in payload
    && Array.isArray(payload.granules)
  );
}
/**
 * Reformat object with key attributes at top level.
 *
 * @param {DLQRecord} dlqRecord - event bridge event as defined in aws-lambda
 * @returns {Promise<DLARecord>} - message packaged with
 * metadata or null where metadata not found
 * {
 *   error: <errorString | null>
 *   time: <timestamp(utc) | null>
 *   status: <status | null>
 *   collection: <collectionName | null>
 *   granules: <[granuleIds, ...] | []>
 *   execution: <executionArn | null>
 *   stateMachine: <stateMachineArn | null>
 *   ...originalAttributes
 * }
 */
async function hoistCumulusMessageDetails(dlqRecord) {
  let error = null;
  let execution = null;
  let stateMachine = null;
  let status = null;
  let time = null;
  let collection = null;
  let granules = null;

  /* @type {any} */
  let messageBody;
  messageBody = dlqRecord;
  /* de-nest sqs records of unknown depth */
  while (isSQSRecordLike(messageBody)) {
    /* capture outermost recorded error */
    if (isDLQRecordLike(messageBody) && !error) {
      error = messageBody.error || null;
    }
    messageBody = parseSQSMessageBody(messageBody);
  }

  if (isEventBridgeEvent(messageBody)) {
    execution = messageBody?.detail?.executionArn || null;
    stateMachine = messageBody?.detail?.stateMachineArn || null;
    status = messageBody?.detail?.status || null;
    time = messageBody?.time || null;
    let cumulusMessage;
    try {
      cumulusMessage = await getCumulusMessageFromExecutionEvent(messageBody);
    } catch (error_) {
      cumulusMessage = undefined;
      log.error(`could not parse details from DLQ message body due to ${error_}`);
    }

    collection = cumulusMessage?.meta?.collection?.name || null;

    const payload = cumulusMessage?.payload;
    if (payloadHasGranules(payload)) {
      granules = payload.granules.map((granule) => granule?.granuleId || null);
    }
  } else {
    log.error('could not parse details from DLQ message body, expected EventBridgeEvent');
  }

  return {
    ...dlqRecord,
    collection,
    granules,
    execution,
    stateMachine,
    status,
    time,
    error,
  };
}

/**
 * Lambda handler for saving DLQ reports to DLA in s3
 *
 * @param {{Records: Array<DLQRecord>, [key: string]: any}} event - Input payload
 * @returns {Promise<void>}
 */
async function handler(event) {
  if (!process.env.system_bucket) throw new Error('System bucket env var is required.');
  if (!process.env.stackName) throw new Error('Could not determine archive path as stackName env var is undefined.');
  const sqsMessages = get(event, 'Records', []);
  await Promise.all(sqsMessages.map(async (sqsMessage) => {
    let massagedMessage;
    let execution;
    if (isSQSRecordLike(sqsMessage)) {
      massagedMessage = await hoistCumulusMessageDetails(sqsMessage);
      execution = massagedMessage.execution;
    } else {
      massagedMessage = sqsMessage;
      execution = null;
    }
    const executionName = execution || 'unknown';
    // version messages with UUID as workflows can produce multiple messages that may all fail.
    const s3Identifier = `${executionName}-${uuidv4()}`;

    await s3PutObject({
      Bucket: process.env.system_bucket,
      Key: `${process.env.stackName}/dead-letter-archive/sqs/${s3Identifier}.json`,
      Body: JSON.stringify(massagedMessage),
    });
  }));
}

module.exports = {
  handler,
  unwrapDeadLetterCumulusMessage,
  hoistCumulusMessageDetails,
};
