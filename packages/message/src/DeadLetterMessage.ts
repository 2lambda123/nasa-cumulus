//@ts-check
import { SQSRecord } from 'aws-lambda';
import moment from 'moment';

import { uuid } from 'uuidv4';
import { isEventBridgeEvent, StepFunctionEventBridgeEvent } from '@cumulus/aws-client/Lambda';
import { parseSQSMessageBody, isSQSRecordLike } from '@cumulus/aws-client/SQS';
import { CumulusMessage } from '@cumulus/types/message';
import { DLQRecord, DLARecord } from '@cumulus/types/api/dead_letters';
import Logger from '@cumulus/logger';
import { MessageGranule } from '@cumulus/types';
import { isMessageWithProvider, getMessageProviderId } from './Providers';
import { isCumulusMessageLike } from './CumulusMessage';
import { getCumulusMessageFromExecutionEvent } from './StepFunctions';
import { constructCollectionId } from './Collections';

const log = new Logger({ sender: '@cumulus/DeadLetterMessage' });

type UnwrapDeadLetterCumulusMessageInputType = (
  StepFunctionEventBridgeEvent
  | DLQRecord | SQSRecord
  | CumulusMessage
);

/**
 * Bare check for SQS message Shape
 */
export const isDLQRecordLike = (message: Object): message is DLQRecord => (
  isSQSRecordLike(message)
  && 'error' in message
);

/**
 * Unwrap dead letter Cumulus message, which may be wrapped in a
 * States cloudwatch event, which is wrapped in an SQS message.
 */
export const unwrapDeadLetterCumulusMessage = async (
  messageBody: UnwrapDeadLetterCumulusMessageInputType
): Promise<UnwrapDeadLetterCumulusMessageInputType> => {
  try {
    if (isSQSRecordLike(messageBody)) {
      // AWS.SQS.Message/SQS.Record case
      const unwrappedMessageBody = parseSQSMessageBody(
        messageBody
      );
      return await unwrapDeadLetterCumulusMessage(unwrappedMessageBody);
    }
    if (isEventBridgeEvent(messageBody)) {
      return await getCumulusMessageFromExecutionEvent(
        messageBody
      );
    }
    if (isCumulusMessageLike(messageBody)) {
      return messageBody;
    }
    throw new TypeError('DeadLetter CumulusMessage in unrecognized format');
  } catch (error) {
    log.error(
      'Falling back to storing wrapped message after encountering unwrap error',
      error,
      JSON.stringify(messageBody)
    );
    return messageBody;
  }
};

interface PayloadWithGranules {
  granules: Array<MessageGranule>
}

const payloadHasGranules = (payload: any): payload is PayloadWithGranules => (
  payload instanceof Object
  && 'granules' in payload
  && Array.isArray(payload.granules)
);

const extractCollectionId = (message: CumulusMessage): string | null => {
  const collectionName = message?.meta?.collection?.name || null;
  const collectionVersion = message?.meta?.collection?.version || null;
  if (collectionName && collectionVersion) {
    return constructCollectionId(collectionName, collectionVersion);
  }
  return null;
};

const extractGranules = (message: CumulusMessage): Array<string | null> | null => {
  if (payloadHasGranules(message.payload)) {
    return message.payload.granules.map((granule) => granule?.granuleId || null);
  }
  return null;
};

/**
 * Reformat object with key attributes at top level.
 *
 */
export const hoistCumulusMessageDetails = async (dlqRecord: SQSRecord): Promise<DLARecord> => {
  let error = null;
  let executionArn = null;
  let stateMachineArn = null;
  let status = null;
  let time = null;
  let collectionId = null;
  let granules = null;
  let providerId = null;

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
    executionArn = messageBody?.detail?.executionArn || null;
    stateMachineArn = messageBody?.detail?.stateMachineArn || null;
    status = messageBody?.detail?.status || null;
    time = messageBody?.time || null;
    let cumulusMessage;
    try {
      cumulusMessage = await getCumulusMessageFromExecutionEvent(messageBody);
    } catch (error_) {
      cumulusMessage = undefined;
      log.error(
        'could not parse details from DLQ message body',
        error_,
        messageBody
      );
    }
    if (cumulusMessage) {
      collectionId = extractCollectionId(cumulusMessage);
      granules = extractGranules(cumulusMessage);
      if (isMessageWithProvider(cumulusMessage)) {
        providerId = getMessageProviderId(cumulusMessage) || null;
      }
    }
  } else {
    log.error(
      'could not parse details from DLQ message body',
      messageBody,
      'expected EventBridgeEvent'
    );
  }

  return {
    ...dlqRecord,
    collectionId,
    providerId,
    granules,
    executionArn,
    stateMachineArn,
    status,
    time,
    error,
  };
};

export const getDLARootKey = (stackName: string): string => `${stackName}/dead-letter-archive/sqs/`;

export const extractDateString = (message: DLARecord): string => (
  message.time && moment.utc(message.time).isValid() ? moment.utc(message.time).format('YYYY-MM-DD') : moment.utc().format('YYYY-MM-DD')
);

export const getDLAKey = (stackName: string, message: DLARecord): string => {
  const dateString = extractDateString(message);
  const execution = message.executionArn || 'unknown';
  return `${getDLARootKey(stackName)}${dateString}/${execution}-${uuid()}`;
};
