'use strict';

const router = require('express-promise-router')();
const aws = require('@cumulus/common/aws'); // important to import all to allow stubbing
const { StepFunction } = require('@cumulus/ingest/aws');

/**
 * fetchRemote fetches remote message from S3
 *
 * @param  {Object} eventMessage - Cumulus Message Adapter message
 * @returns {string}              Cumulus Message Adapter message in JSON string
 */
async function fetchRemote(eventMessage) {
  if (eventMessage.replace) {
    const file = await aws.getS3Object(eventMessage.replace.Bucket, eventMessage.replace.Key);
    return file.Body.toString();
  }

  return JSON.stringify(eventMessage);
}

/**
 * getEventDetails
 *   - replaces StepFunction-specific keys with input or output keys
 *   - replaces "replace" key in input or output with message stored on S3
 *
 * @param  {Object} event - StepFunction event object
 * @returns {Object}       StepFunction event object, with SFn keys and
 *                        "replace" values replaced with "input|output"
 *                        and message stored on S3, respectively.
 */
async function getEventDetails(event) {
  let result = Object.assign({}, event);
  let prop;

  if (event.type.endsWith('StateEntered')) {
    prop = 'stateEnteredEventDetails';
  }
  else if (event.type.endsWith('StateExited')) {
    prop = 'stateExitedEventDetails';
  }
  else if (event.type) {
    prop = `${event.type.charAt(0).toLowerCase() + event.type.slice(1)}EventDetails`;
  }

  if (prop && event[prop]) {
    result = Object.assign(result, event[prop]);
    delete result[prop];
  }

  if (result.input) result.input = await fetchRemote(JSON.parse(result.input));
  if (result.output) result.output = await fetchRemote(JSON.parse(result.output));

  return result;
}

/**
 * get a single execution status
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object 
 */
async function get(req, res) {
  const arn = req.params.arn;

  const status = await StepFunction.getExecutionStatus(arn)

  // if execution output is stored remotely, fetch it from S3 and replace it
  const executionOutput = status.execution.output;

  /* eslint-disable no-param-reassign */
  if (executionOutput) {
    status.execution.output = await fetchRemote(JSON.parse(status.execution.output));
  }
  /* eslint-enable no-param-reassign */

  const updatedEvents = [];
  for (let i = 0; i < status.executionHistory.events.length; i += 1) {
    const sfEvent = status.executionHistory.events[i];
    updatedEvents.push(getEventDetails(sfEvent));
  }
  /* eslint-disable no-param-reassign */
  status.executionHistory.events = await Promise.all(updatedEvents);
  /* eslint-enable no-param-reassign */
  return res.send(status);
}

router.get('/:arn', get);

module.exports = router;
