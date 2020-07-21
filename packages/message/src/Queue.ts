'use strict';

/**
 * Utility functions for parsing queue information from a Cumulus message
 * @module Queue
 *
 * @example
 * const Queue = require('@cumulus/message/Queue');
 */

import findKey from 'lodash/findKey';
import get from 'lodash/get';
import isNil from 'lodash/isNil';
import { Message } from '@cumulus/types';

/**
 * Get queue ARN by URL from execution message.
 *
 * @param {Message.CumulusMessage} message - An execution message
 * @param {string} queueUrl - An SQS queue URL
 * @returns {string|undefined} An SQS queue name or undefined
 *
 * @alias module:Queue
 */
export const getQueueArnByUrl = (
  message: Message.CumulusMessage,
  queueUrl: string
) => {
  const queues = get(message, 'meta.queues', {});
  return findKey(queues, (value) => value === queueUrl);
};

/**
 * Get the queue name from a workflow message.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {string} A queue name
 * @throws {Error} if no queue name in the message
 *
 * @alias module:Queue
 */
export const getQueueName = (message: Message.CumulusMessage) => {
  const queueName = get(message, 'cumulus_meta.queueName');
  if (isNil(queueName)) {
    throw new Error('cumulus_meta.queueName not set in message');
  }
  return queueName;
};

/**
 * Get the queue URL from a workflow message.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {string} A queue URL
 * @throws {Error} if no queue URL in the message
 *
 * @alias module:Queue
 */
export const getQueueUrl = (message: Message.CumulusMessage) => {
  const queueUrl = get(message, 'cumulus_meta.queueUrl');
  if (isNil(queueUrl)) {
    throw new Error('cumulus_meta.queueUrl not set in message');
  }
  return queueUrl;
};

/**
 * Get the maximum executions for a queue.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @param {string} queueUrl - A queue URL
 * @returns {number} Count of the maximum executions for the queue
 * @throws {Error} if no maximum executions can be found
 *
 * @alias module:Queue
 */
export const getMaximumExecutions = (
  message: Message.CumulusMessage,
  queueUrl: string
) => {
  const maxExecutions = get(message, `meta.queueExecutionLimits.${queueUrl}`);
  if (isNil(maxExecutions)) {
    throw new Error(`Could not determine maximum executions for queue ${queueUrl}`);
  }
  return maxExecutions;
};

/**
 * Determine if there is a queue and queue execution limit in the message.
 *
 * @param {Message.CumulusMessage} message - A workflow message object
 * @returns {boolean} True if there is a queue and execution limit.
 *
 * @alias module:Queue
 */
export const hasQueueAndExecutionLimit = (message: Message.CumulusMessage) => {
  try {
    const queueUrl = getQueueUrl(message);
    getMaximumExecutions(message, queueUrl);
  } catch (error) {
    return false;
  }
  return true;
};
