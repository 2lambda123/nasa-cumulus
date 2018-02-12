'use strict';

const cumulusMessageAdapter = require('@cumulus/cumulus-message-adapter-js');
const get = require('lodash.get');
const errors = require('@cumulus/common/errors');
const pdr = require('@cumulus/ingest/pdr');
const log = require('@cumulus/common/log');

/**
* Parse a PDR
* See schemas/input.json for detailed input schema
*
* @param {Object} event - Lambda event object
* @param {Object} event.config - configuration object for the task
* @param {string} event.config.stack - the name of the deployment stack
* @param {string} event.config.pdrFolder - folder for the PDRs
* @param {Object} event.config.provider - provider information
* @param {Object} event.config.buckets - S3 buckets
* @param {Object} event.config.collection - information about data collection related to task
* @returns {Promise.<Object>} - see schemas/output.json for detailed output schema
* that is passed to the next task in the workflow
**/
function parsePdr(event) {
  const config = get(event, 'config');
  const provider = get(config, 'provider', null);
  const queue = get(config, 'useQueue', true);

  if (!provider) {
    const err = new errors.ProviderNotFound('Provider info not provided');
    log.error(err);
    return Promise.reject(err);
  }

  const Parse = pdr.selector('parse', provider.protocol, queue);
  const parse = new Parse(event);

  return parse.ingest()
    .then((payload) => {
      if (parse.connected) {
        parse.end();
      }

      const output = Object.assign({}, event.input, payload);
      return output;
    })
    .catch((e) => {
      if (e.toString().includes('ECONNREFUSED')) {
        const err = new errors.RemoteResourceError('Connection Refused');
        log.error(err);
        throw err;
      }
      else if (e.details && e.details.status === 'timeout') {
        const err = new errors.ConnectionTimeout('connection Timed out');
        log.error(err);
        throw err;
      }

      log.error(e);
      throw e;
    });
}
exports.parsePdr = parsePdr; // exported to support testing

/**
 * Lambda handler
 *
 * @param {Object} event - a Cumulus Message
 * @param {Object} context - an AWS Lambda context
 * @param {Function} callback - an AWS Lambda handler
 * @returns {undefined} - does not return a value
 */
function handler(event, context, callback) {
  cumulusMessageAdapter.runCumulusTask(parsePdr, event, context, callback);
}
exports.handler = handler;
