'use strict';

/**
 * @module Executions
 *
 * @example
 * const Executions = require('@cumulus/integration-test/Executions');
 */

const executionsApi = require('@cumulus/api-client/executions');
const get = require('lodash/get');
const isNil = require('lodash/isNil');
const pick = require('lodash/pick');
const pRetry = require('p-retry');

/**
 * Find the execution ARN matching the `matcher` function
 *
 * @param {string} prefix - the name of the Cumulus stack
 * @param {Function} matcher - a predicate function that takes an execution and determines if this
 * is the execution that is being searched for
 * @param {Object} [options]
 * @param {integer} [options.timeout=0] - the number of seconds to wait for a matching execution
 * to be found
 * @returns {Promise<string>} the ARN of the matching execution
 *
 * @alias module:Executions
 */
const findExecutionArn = async (prefix, matcher, options = { timeout: 0 }) =>
  pRetry(
    async () => {
      let execution;

      try {
        const { body } = await executionsApi.getExecutions({ prefix });
        const executions = JSON.parse(body);
        execution = executions.results.find(matcher);
      } catch (err) {
        throw new pRetry.AbortError(err);
      }

      if (isNil(execution)) throw new Error('Not Found');

      return execution.arn;
    },
    {
      retries: options.timeout,
      maxTimeout: 1000
    }
  );

class ExecutionNotFoundError extends Error {
  constructor(arn) {
    super(`Execution ${arn} not found`);
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
  }
}

const getExecution = async (params) => {
  const execution = await executionsApi.getExecution(params);

  if (execution.statusCode === 404) throw new ExecutionNotFoundError(params.arn);

  return execution;
};

/**
 * Wait for an execution to have an expected status and return the execution
 *
 * @param {Object} params
 * @param {string} params.prefix - the name of the Cumulus stack
 * @param {string} params.arn - the execution ARN to fetch
 * @param {string} params.status - the status to wait for
 * @param {Function} [params.callback=cumulusApiClient.invokeApifunction] - an async function to
 * invoke the API Lambda that takes a prefix / user payload
 * @param {integer} [params.timeout=30] - the number of seconds to wait for the
 *   execution to reach a terminal state
 * @returns {Promise<Object>} the execution as returned by the `GET /executions/<execution-arn>`
 * endpoint
 *
 * @alias module:Executions
 */
const getExecutionWithStatus = async (params) =>
  pRetry(
    async () => {
      let execution;

      try {
        execution = await getExecution(pick(params, ['prefix', 'arn', 'callback']));
      } catch (err) {
        if (err.name === 'ExecutionNotFoundError') throw err;
        throw new pRetry.AbortError(`Error fetching execution ${params.arn}: ${err}`);
      }

      if (execution.status === params.status) return execution;

      if (['completed', 'failed'].includes(execution.status)) {
        throw new pRetry.AbortError(
          new Error(
            `Expected ${params.arn} to have status ${params.status} but found ${execution.status}`
          )
        );
      }

      throw new Error(`Execution ${params.arn} still running`);
    },
    {
      retries: get(params, 'timeout', 30),
      maxTimeout: 1000
    }
  );

module.exports = {
  findExecutionArn,
  getExecutionWithStatus
};
