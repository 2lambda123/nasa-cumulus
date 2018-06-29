'use strict';

const uuidv4 = require('uuid/v4');

const {
  getS3Object,
  sendSQSMessage,
  parseS3Uri,
  getExecutionArn
} = require('@cumulus/common/aws');

/**
 * Create a message from a template stored on S3
 *
 * @param {string} templateUri - S3 uri to the workflow template
 * @returns {Promise} message object
 **/
async function getMessageFromTemplate(templateUri) {
  const parsedS3Uri = parseS3Uri(templateUri);
  const data = await getS3Object(parsedS3Uri.Bucket, parsedS3Uri.Key);
  return JSON.parse(data.Body);
}

/**
 * Enqueue a PDR to be parsed
 *
 * @param {Object} pdr - the PDR to be enqueued for parsing
 * @param {string} queueUrl - the SQS queue to add the message to
 * @param {string} parsePdrMessageTemplateUri - the S3 URI of template for
 * a granule ingest message
 * @param {Object} provider - the provider config to be attached to the message
 * @param {Object} rule - the rule to be attached to the message
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueParsePdrMessage(
  pdr,
  queueUrl,
  parsePdrMessageTemplateUri,
  provider,
  rule
) {
  const message = await getMessageFromTemplate(parsePdrMessageTemplateUri);

  message.meta.provider = provider;
  message.meta.rule = rule;

  message.payload = { pdr };

  return sendSQSMessage(queueUrl, message);
}
module.exports.enqueueParsePdrMessage = enqueueParsePdrMessage;

/**
 * Enqueue a granule to be ingested
 *
 * @param {Object} granule - the granule to be enqueued for ingest
 * @param {string} queueUrl - the SQS queue to add the message to
 * @param {string} granuleIngestMessageTemplateUri - the S3 URI of template for
 * a granule ingest message
 * @param {Object} provider - the provider config to be attached to the message
 * @param {Object} rule - the rule to be attached to the message
 * @param {Object} pdr - an optional PDR to be configured in the message payload
 * @returns {Promise} - resolves when the message has been enqueued
 */
async function enqueueGranuleIngestMessage(
  granule,
  queueUrl,
  granuleIngestMessageTemplateUri,
  provider,
  rule,
  pdr
) {
  // Build the message from a template
  const message = await getMessageFromTemplate(granuleIngestMessageTemplateUri);

  message.payload = {
    granules: [{
      granuleId: granule.granuleId,
      dataType: granule.dataType,
      version: granule.version,
      files: granule.files
    }]
  };
  if (pdr) message.meta.pdr = pdr;

  message.meta.provider = provider;
  message.meta.rule = rule;
  message.cumulus_meta.execution_name = uuidv4();
  const arn =
    getExecutionArn(message.cumulus_meta.state_machine, message.cumulus_meta.execution_name);
  await sendSQSMessage(queueUrl, message);
  return arn;
}
exports.enqueueGranuleIngestMessage = enqueueGranuleIngestMessage;
