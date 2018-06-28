'use strict';

const _get = require('lodash.get');
const aws = require('@cumulus/common/aws');
const { inTestMode } = require('@cumulus/common/test-utils');
const log = require('@cumulus/common/log');
const handle = require('../lib/response').handle;
const Search = require('../es/search').Search;
const models = require('../models');
const { moveGranuleFiles } = require('@cumulus/ingest/granule');

/**
 * List all granules for a given collection.
 *
 * @param {Object} event - aws lambda event object.
 * @param {callback} cb - aws lambda callback function
 * @returns {Object} list of granules
 */
function list(event, cb) {
  const search = new Search(event, 'granule');
  return search.query().then((res) => cb(null, res)).catch(cb);
}

/**
 * Update a single granule.
 * Supported Actions: reingest, Remove From CMR.
 *
 * @param {Object} event - aws lambda event object.
 * @returns {Promise} response from the actions
 */
async function put(event) {
  const granuleId = _get(event.pathParameters, 'granuleName');
  let body = _get(event, 'body', '{}');
  body = JSON.parse(body);

  const action = _get(body, 'action');
  const g = new models.Granule();

  if (action) {
    const response = await g.get({ granuleId });
    if (action === 'reingest') {
      await g.reingest(response);
      return {
        granuleId: response.granuleId,
        action,
        status: 'SUCCESS'
      };
    }
    if (action === 'applyWorkflow') {
      const workflow = _get(body, 'workflow');
      const messageSource = _get(body, 'messageSource');
      await g.reingest(response, workflow, messageSource);
      return {
        granuleId: response.granuleId,
        action,
        status: 'SUCCESS'
      };
    }
    else if (action === 'removeFromCmr') {
      await g.removeGranuleFromCmr(response.granuleId, response.collectionId);
      return {
        granuleId: response.granuleId,
        action,
        status: 'SUCCESS'
      };
    }
    else if (action === 'move') {
      const destinations = body.destinations;
      const distEndpoint = process.env.distEndpoint;

      await moveGranuleFiles(response.files, destinations, distEndpoint);

      return {
        granuleId: response.granuleId,
        action,
        status: 'SUCCESS'
      };
    }

    throw new Error('Action is not supported. Choices are: "move", "reingest", & "removeFromCmr"');
  }

  throw new Error('Action is missing');
}

async function del(event) {
  const granuleId = _get(event.pathParameters, 'granuleName');
  log.info(`granules.del ${granuleId}`);

  const g = new models.Granule();
  const record = await g.get({ granuleId });

  if (record.detail) {
    throw record;
  }

  if (record.published) {
    const errMsg = 'You cannot delete a granule that is published to CMR. Remove it from CMR first';
    throw new Error(errMsg);
  }

  // remove files from s3
  await Promise.all(record.files.map((file) => {
    const parsed = aws.parseS3Uri(file.filename);
    if (aws.fileExists(parsed.Bucket, parsed.Key)) {
      return aws.deleteS3Object(parsed.Bucket, parsed.Key);
    }
    return {};
  }));

  await g.delete({ granuleId });

  return { detail: 'Record deleted' };
}

/**
 * Query a single granule.
 *
 * @param {Object} event - aws lambda event object.
 * @param {callback} cb - aws lambda callback function
 * @returns {Object} a single granule object.
 */
function get(event, cb) {
  const granuleId = _get(event.pathParameters, 'granuleName');

  const g = new models.Granule();
  return g.get({ granuleId }).then((response) => {
    cb(null, response);
  }).catch(cb);
}

/**
 * The main handler for the lambda function
 *
 * @param {Object} event - aws lambda event object.
 * @param {Object} context - aws context object
 * @returns {undefined} undefined
 */
function handler(event, context) {
  return handle(event, context, !inTestMode() /* authCheck */, (cb) => {
    if (event.httpMethod === 'GET' && event.pathParameters) {
      return get(event, cb);
    }
    else if (event.httpMethod === 'PUT' && event.pathParameters) {
      return put(event).then((r) => cb(null, r)).catch((e) => cb(e));
    }
    else if (event.httpMethod === 'DELETE' && event.pathParameters) {
      return del(event).then((r) => cb(null, r)).catch((e) => cb(e));
    }

    return list(event, cb);
  });
}

module.exports = handler;
