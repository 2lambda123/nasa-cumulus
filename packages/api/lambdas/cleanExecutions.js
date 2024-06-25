//@ts-check
'use strict';

const { ExecutionPgModel, getKnexClient } = require('@cumulus/db');
const { getEsClient } = require('@cumulus/es-client/search');
const pLimit = require('p-limit');
const moment = require('moment');
const Logger = require('@cumulus/logger');
const log = new Logger({
  sender: '@cumulus/api/lambdas/cleanExecutions',
});

/**
 * @typedef {import('@cumulus/db').PostgresExecutionRecord} PostgresExecutionRecord
 * @typedef {import('knex').Knex} Knex
 */

/**
 * Extract expiration dates and identify greater and lesser bounds
 *
 * @param {number} completeTimeoutDays - Maximum number of days a completed
 *   record may have payload entries
 * @param {number} nonCompleteTimeoutDays - Maximum number of days a non-completed
 *   record may have payload entries
 * @param {boolean} runComplete - Enable removal of completed execution
 *   payloads
 * @param {boolean} runNonComplete - Enable removal of execution payloads for
 *   statuses other than 'completed'
 * @returns {{
 *  laterExpiration: Date,
 *  completeExpiration: Date,
 *  nonCompleteExpiration: Date
 *  earlierExpiration: Date
 * }}
 */
const getExpirationDates = (
  completeTimeoutDays,
  nonCompleteTimeoutDays,
  runComplete,
  runNonComplete
) => {
  const completeExpiration = moment().subtract(completeTimeoutDays, 'days').toDate();
  const nonCompleteExpiration = moment().subtract(nonCompleteTimeoutDays, 'days').toDate();
  let laterExpiration;
  let earlierExpiration;
  if (runComplete && runNonComplete) {
    laterExpiration = new Date(Math.max(completeExpiration.getTime(), nonCompleteExpiration.getTime()));
    earlierExpiration = new Date(Math.min(completeExpiration.getTime(), nonCompleteExpiration.getTime()));
  } else if (runComplete) {
    laterExpiration = completeExpiration;
    earlierExpiration = completeExpiration;
  } else if (runNonComplete) {
    laterExpiration = nonCompleteExpiration;
    earlierExpiration = nonCompleteExpiration;
  } else {
    throw new Error('cannot run with both complete and nonComplete turned off');
  }

  return {
    laterExpiration,
    completeExpiration,
    nonCompleteExpiration,
    earlierExpiration,
  };
};

/**
 * 
 * @param {Knex} knex
 * @param {Date} expiration
 * @param {number} limit
 * @returns {Promise<Array<PostgresExecutionRecord>>}
 */
const getExpirablePayloadRecords = async (
  knex,
  expiration,
  limit,
) => {
  return await knex(new ExecutionPgModel().tableName)
    .where('updated_at', '<=', expiration)
    .where((builder) => {
      builder.whereNotNull('final_payload')
        .orWhereNotNull('original_payload');
    })
    .limit(limit);
};

/**
 * Extract expiration dates and identify greater and lesser bounds
 *
 * @param {number} completeTimeoutDays - Maximum number of days a completed
 *   record may have payload entries
 * @param {number} nonCompleteTimeoutDays - Maximum number of days a non-completed
 *   record may have payload entries
 * @param {boolean} runComplete - Enable removal of completed execution
 *   payloads
 * @param {boolean} runNonComplete - Enable removal of execution payloads for
 *   statuses other than 'completed'
 * @param {string} index - Elasticsearch index to cleanup
 * @returns {Promise<void>}
*/
const cleanupExpiredESExecutionPayloads = async (
  completeTimeoutDays,
  nonCompleteTimeoutDays,
  runComplete,
  runNonComplete,
  index
) => {

  const updateLimit = process.env.UPDATE_LIMIT || 10000;
  const {
    laterExpiration: _laterExpiration,
    completeExpiration: _completeExpiration,
    nonCompleteExpiration: _nonCompleteExpiration,
    earlierExpiration: _earlierExpiration
  } = getExpirationDates(
    completeTimeoutDays,
    nonCompleteTimeoutDays,
    runComplete,
    runNonComplete
  );
  const laterExpiration = _laterExpiration.getTime();
  const completeExpiration = _completeExpiration.getTime();
  const nonCompleteExpiration = _nonCompleteExpiration.getTime();
  const earlierExpiration = _earlierExpiration.getTime();

  const must = [
    { range: { updatedAt: { lte: laterExpiration } } },
    {
      bool: {
        should: [
          { exists: { field: 'finalPayload' } },
          { exists: { field: 'originalPayload' } }
        ]
      }
    }
  ]
  const removePayloadScript = "ctx._source.remove('finalPayload'); ctx._source.remove('originalPayload')"
  const mustNot = [];
  let script = { inline: removePayloadScript }
  if (runComplete && runNonComplete) {
    const removeForCompleteBoolean = `ctx._source.updatedAt < ${completeExpiration}L && ctx._source.status == 'completed'`;
    const removeForNonCompleteBoolean = `ctx._source.updatedAt < ${nonCompleteExpiration}L && ctx._source.status != 'completed'`;
    // a way to perform only integer comparison whenever possible, and do relatively slow string comparison only when necessary
    const removeForEitherBoolean = `ctx._source.updatedAt < ${earlierExpiration}L`;
    const removeForLaterBoolean = completeExpiration === laterExpiration ? removeForCompleteBoolean : removeForNonCompleteBoolean
    script = {
      inline: `if ((${removeForEitherBoolean}) || (${removeForLaterBoolean})) { ${removePayloadScript} }`
    }
  } else if (runNonComplete && !runComplete) {

    mustNot.push({ term: { status: 'completed' } })
  } else if (runComplete && !runNonComplete) {

    must.push({ term: { status: 'completed' } })
  }
  const body = {
    query: {
      bool: {
        must,
        mustNot
      }
    },
    script: script,
  }
  const esClient = await getEsClient();
  await esClient._client.updateByQuery({
    index,
    type: 'execution',
    size: updateLimit,
    body,
    refresh: true
  })
};

const cleanupExpiredPGExecutionPayloads = async (
  completeTimeoutDays,
  nonCompleteTimeoutDays,
  runComplete,
  runNonComplete
) => {
  const {
    laterExpiration,
    completeExpiration,
    nonCompleteExpiration,
  } = getExpirationDates(
    completeTimeoutDays,
    nonCompleteTimeoutDays,
    runComplete,
    runNonComplete
  );
  const knex = await getKnexClient();
  const updateLimit = process.env.UPDATE_LIMIT || 10000;
  const executionModel = new ExecutionPgModel();
  const executionRecords = await getExpirablePayloadRecords(
    knex,
    laterExpiration,
    updateLimit
  );
  if (executionRecords.length == updateLimit) {
    log.warn(`running cleanup for ${updateLimit} out of maximum ${updateLimit} executions. more processing likely needed`);
  }
  const concurrencyLimit = process.env.CONCURRENCY || 100;
  const limit = pLimit(concurrencyLimit);
  const wipedPayloads = {
    original_payload: null,
    final_payload: null
  };
  const updatePromises = executionRecords.map((entry) => limit(() => {
    if (runComplete && entry.status === 'completed' && entry.updated_at <= completeExpiration) {

      return executionModel.update(knex, { cumulus_id: entry.cumulus_id }, wipedPayloads);
    }
    if (runNonComplete && !(entry.status === 'completed') && entry.updated_at <= nonCompleteExpiration) {

      return executionModel.update(knex, { cumulus_id: entry.cumulus_id }, wipedPayloads);
    }
    return Promise.resolve();
  }));
  return await Promise.all(updatePromises);
};

async function cleanExecutionPayloads() {
  let completeDisable = process.env.completeExecutionPayloadTimeoutDisable || 'false';
  let nonCompleteDisable = process.env.nonCompleteExecutionPayloadTimeoutDisable || 'false';

  completeDisable = JSON.parse(completeDisable);
  if (completeDisable) {
    log.info('skipping complete execution cleanup');
  }

  nonCompleteDisable = JSON.parse(nonCompleteDisable);
  if (nonCompleteDisable) {
    log.info('skipping nonComplete execution cleanup')
  }
  if (completeDisable && nonCompleteDisable) {
    return [];
  }

  const nonCompleteTimeout = Number.parseInt(process.env.nonCompleteExecutionPayloadTimeout || '10', 10);
  if (!Number.isInteger(nonCompleteTimeout)) {
    throw new TypeError(`Invalid number of days specified in configuration for nonCompleteExecutionPayloadTimeout: ${nonCompleteTimeout}`);
  }
  const completeTimeout = Number.parseInt(process.env.completeExecutionPayloadTimeout || '10', 10);
  if (!Number.isInteger(nonCompleteTimeout)) {
    throw new TypeError(`Invalid number of days specified in configuration for completeExecutionPayloadTimeout: ${completeTimeout}`);
  }

  const esIndex = process.env.ES_INDEX || 'cumulus'
  await Promise.all([
    cleanupExpiredPGExecutionPayloads(
      completeTimeout,
      nonCompleteTimeout,
      !completeDisable,
      !nonCompleteDisable
    ),
    cleanupExpiredESExecutionPayloads(
      completeTimeout,
      nonCompleteTimeout,
      !completeDisable,
      !nonCompleteDisable,
      esIndex
    ),
  ])
}

async function handler(_event) {
  return await cleanExecutionPayloads();
}
module.exports = {
  handler,
  cleanExecutionPayloads,
  getExpirationDates,
  cleanupExpiredPGExecutionPayloads,
  cleanupExpiredESExecutionPayloads,
  getExpirablePayloadRecords
}
async function wrap() {
  await handler();
}
if (require.main === module) {
  wrap(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}