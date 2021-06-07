'use strict';

const router = require('express-promise-router')();
const S3UtilsLib = require('@cumulus/aws-client/S3');
const {
  getKnexClient,
  PdrPgModel,
} = require('@cumulus/db');
const log = require('@cumulus/common/log');
const { inTestMode } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { indexPdr } = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const models = require('../models');

/**
 * List and search pdrs
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const search = new Search(
    { queryStringParameters: req.query },
    'pdr',
    process.env.ES_INDEX
  );
  const result = await search.query();
  return res.send(result);
}

/**
 * get a single PDR
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const pdrName = req.params.pdrName;

  const pdrModel = new models.Pdr();

  try {
    const result = await pdrModel.get({ pdrName });
    return res.send(result);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`No record found for ${pdrName}`);
    }
    throw error;
  }
}

const isRecordDoesNotExistError = (e) => e.message.includes('RecordDoesNotExist');

/**
 * delete a given PDR
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    pdrModel = new models.Pdr(),
    pdrPgModel = new PdrPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
    s3Utils = S3UtilsLib,
  } = req.testContext || {};

  const pdrName = req.params.pdrName;
  const pdrS3Key = `${process.env.stackName}/pdrs/${pdrName}`;

  let existingPdr;
  try {
    existingPdr = await pdrModel.get({ pdrName });
  } catch (error) {
    // Ignore error if record does not exist in DynamoDb
    if (!(error instanceof RecordDoesNotExist)) {
      throw error;
    }
  }

  const esPdrClient = new Search(
    {},
    'pdr',
    process.env.ES_INDEX
  );
  const esPdrRecord = await esPdrClient.get(pdrName).catch(log.info);

  try {
    let dynamoPdrDeleted = false;
    let esPdrDeleted = false;
    try {
      await knex.transaction(async (trx) => {
        await pdrPgModel.delete(trx, { name: pdrName });
        await pdrModel.delete({ pdrName });
        dynamoPdrDeleted = true;
        await esClient.delete({
          id: pdrName,
          index: process.env.ES_INDEX,
          type: 'pdr',
          refresh: inTestMode(),
        }, { ignore: [404] });
        esPdrDeleted = true;
        await s3Utils.deleteS3Object(process.env.system_bucket, pdrS3Key);
      });
    } catch (innerError) {
      // Delete is idempotent, so there may not be a DynamoDB
      // record to recreate
      if (dynamoPdrDeleted && existingPdr) {
        await pdrModel.create(existingPdr);
      }
      if (esPdrDeleted && esPdrRecord) {
        delete esPdrRecord._id;
        await indexPdr(esClient, esPdrRecord, process.env.ES_INDEX);
      }
      throw innerError;
    }
  } catch (error) {
    if (!isRecordDoesNotExistError(error)) throw error;
  }
  return res.send({ detail: 'Record deleted' });
}

router.get('/:pdrName', get);
router.get('/', list);
router.delete('/:pdrName', del);

module.exports = {
  del,
  router,
};
