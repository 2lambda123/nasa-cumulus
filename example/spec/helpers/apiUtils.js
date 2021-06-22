'use strict';

const isMatch = require('lodash/isMatch');
const isNil = require('lodash/isNil');
const pRetry = require('p-retry');

function setDistributionApiEnvVars() {
  process.env.PORT = 5002;
  process.env.DISTRIBUTION_REDIRECT_ENDPOINT = `http://localhost:${process.env.PORT}/redirect`;
  process.env.DISTRIBUTION_ENDPOINT = `http://localhost:${process.env.PORT}`;
  // Ensure integration tests use Earthdata login UAT if not specified.
  if (!process.env.EARTHDATA_BASE_URL) {
    process.env.EARTHDATA_BASE_URL = 'https://uat.urs.earthdata.nasa.gov';
  }
}

async function waitForApiRecord(getMethod, params, matchParams, retryConfig = {}) {
  return await pRetry(
    async () => {
      if (isNil(matchParams)) {
        throw new pRetry.AbortError('matchParams are required');
      }

      const record = await getMethod(params);

      if (!isMatch(record, matchParams)) {
        throw new Error(`Record ${JSON.stringify(record)} did not match expected ${JSON.stringify(matchParams)}`);
      }
      return record;
    },
    {
      maxTimeout: 60 * 1000,
      ...retryConfig,
    }
  );
}

async function throwIfApiError(apiFunction, apiFuncParams) {
  const response = await apiFunction(apiFuncParams);
  const parsedResponse = JSON.parse(response.body);
  if (parsedResponse.error) {
    throw new Error(parsedResponse.message);
  }
  return parsedResponse;
}

/**
 * Check a record for a particular set of statuses and retry until the record gets that status
 * This is to mitigate issues where a workflow completes, but there is a lag between
 * the workflow end, cloudwatch event sqs message, and database update
 *
 * @param {Object} model - model from api/models
 * @param {Object} params - params to pass to model.get
 * @param {string[] | string} status - status to wait for
 */
async function waitForModelStatus(model, params, status) {
  return await pRetry(
    async () => {
      const record = await model.get(params);
      const checkStatus = [status].flat();
      if (!checkStatus.includes(record.status)) {
        throw new Error(`Record status ${record.status}. Expect status ${checkStatus}`);
      }

      return record;
    },
    {
      maxTimeout: 60 * 1000,
    }
  );
}

module.exports = {
  setDistributionApiEnvVars,
  waitForApiRecord,
  waitForModelStatus,
  throwIfApiError,
};
