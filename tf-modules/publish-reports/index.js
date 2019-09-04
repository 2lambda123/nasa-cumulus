'use strict';

const aws = require('@cumulus/common/aws');
const {
  getSfEventMessageObject,
  getSfEventStatus,
  isFailedSfStatus,
  isTerminalSfStatus
} = require('@cumulus/common/cloudwatch-event');
const {
  getMessageExecutionArn
} = require('@cumulus/common/message');
const log = require('@cumulus/common/log');
const StepFunctions = require('@cumulus/common/StepFunctions');

/**
 * Publish a message to an SNS topic.
 *
 * Catch any thrown errors and log them.
 *
 * @param {string} snsTopicArn - SNS topic ARN
 * @param {Object} eventMessage - Workflow execution message
 * @returns {Promise}
 */
async function publishSnsMessage(
  snsTopicArn,
  eventMessage
) {
  try {
    if (!snsTopicArn) {
      throw new Error('Missing SNS topic ARN');
    }

    await aws.sns().publish({
      TopicArn: snsTopicArn,
      Message: JSON.stringify(eventMessage)
    }).promise();
  } catch (err) {
    log.error(`Failed to post message to SNS topic: ${snsTopicArn}`, err);
    log.info('Execution message', eventMessage);
  }
}

/**
 * Publish SNS message for execution reporting.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @param {string} [executionSnsTopicArn]
 *  SNS topic ARN for reporting executions. Defaults to `process.env.execution_sns_topic_arn`.
 * @returns {Promise}
 */
async function publishExecutionSnsMessage(
  eventMessage,
  executionSnsTopicArn = process.env.execution_sns_topic_arn
) {
  return publishSnsMessage(executionSnsTopicArn, eventMessage);
}

/**
 * Publish SNS message for granule reporting.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @param {string} [granuleSnsTopicArn]
 *   SNS topic ARN for reporting granules. Defaults to `process.env.granule_sns_topic_arn`.
 * @returns {Promise}
 */
async function publishGranuleSnsMessage(
  eventMessage,
  granuleSnsTopicArn = process.env.granule_sns_topic_arn
) {
  return publishSnsMessage(granuleSnsTopicArn, eventMessage);
}

/**
 * Publish SNS message for PDR reporting.
 *
 * @param {Object} eventMessage - Workflow execution message
 * @param {string} [pdrSnsTopicArn]
 *   SNS topic ARN for reporting PDRs. Defaults to `process.env.pdr_sns_topic_arn`.
 * @returns {Promise}
 */
async function publishPdrSnsMessage(
  eventMessage,
  pdrSnsTopicArn = process.env.pdr_sns_topic_arn
) {
  return publishSnsMessage(pdrSnsTopicArn, eventMessage);
}

/**
 * Lambda handler for publish-reports Lambda.
 *
 * @param {Object} event - Cloudwatch event
 * @returns {Promise}
 */
async function handler(event) {
  const eventStatus = getSfEventStatus(event);
  const isTerminalStatus = isTerminalSfStatus(eventStatus);
  const isFailedStatus = isFailedSfStatus(eventStatus);

  const eventMessage = isTerminalStatus && !isFailedStatus
    ? getSfEventMessageObject(event, 'output')
    : getSfEventMessageObject(event, 'input', '{}');

  // TODO: Get event message from first failed step from execution history for failed executions
  /*if (isFailedSfStatus) {
    const executionArn = getMessageExecutionArn(eventMessage);
    const executionHistory = await StepFunctions.getExecutionHistory({ executionArn });
    for (let i = 0; i < executionHistory.events.length; i += 1) {
      const sfEvent = executionHistory.events[i];
      updatedEvents.push(getEventDetails(sfEvent));
    }
  }*/

  eventMessage.meta = eventMessage.meta || {};

  // if this is the sns call at the end of the execution
  if (isTerminalStatus) {
    eventMessage.meta.status = isFailedStatus ? 'failed' : 'completed';
  } else {
    eventMessage.meta.status = 'running';
  }

  return Promise.all([
    publishExecutionSnsMessage(eventMessage),
    publishGranuleSnsMessage(eventMessage),
    publishPdrSnsMessage(eventMessage)
  ]);
}

module.exports = {
  handler
};
