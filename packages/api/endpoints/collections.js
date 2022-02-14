'use strict';

const omit = require('lodash/omit');
const router = require('express-promise-router')();
const { inTestMode } = require('@cumulus/common/test-utils');
const {
  InvalidRegexError,
  UnmatchedRegexError,
} = require('@cumulus/errors');
const Logger = require('@cumulus/logger');
const { constructCollectionId } = require('@cumulus/message/Collections');

const {
  CollectionPgModel,
  getKnexClient,
  TableNames,
  translateApiCollectionToPostgresCollection,
  createRejectableTransaction,
} = require('@cumulus/db');
const { Search } = require('@cumulus/es-client/search');
const {
  addToLocalES,
  indexCollection,
} = require('@cumulus/es-client/indexer');
const Collection = require('@cumulus/es-client/collections');
const models = require('../models');
const { AssociatedRulesError, isBadRequestError } = require('../lib/errors');
const insertMMTLinks = require('../lib/mmt');

const log = new Logger({ sender: '@cumulus/api/collections' });

const dynamoRecordToDbRecord = (
  dynamoRecord
) => translateApiCollectionToPostgresCollection(dynamoRecord);

/**
 * List all collections.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const { getMMT, includeStats, ...queryStringParameters } = req.query;
  const collection = new Collection(
    { queryStringParameters },
    undefined,
    process.env.ES_INDEX,
    includeStats === 'true'
  );
  let result = await collection.query();
  if (getMMT === 'true') {
    result = await insertMMTLinks(result);
  }
  return res.send(result);
}

/**
 * List all collections with active granules
 * If time params are specified the query will return collections
 * that have granules that have been updated in that time frame.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function activeList(req, res) {
  const { getMMT, includeStats, ...queryStringParameters } = req.query;

  const collection = new Collection(
    { queryStringParameters },
    undefined,
    process.env.ES_INDEX,
    includeStats === 'true'
  );
  let result = await collection.queryCollectionsWithActiveGranules();
  if (getMMT === 'true') {
    result = await insertMMTLinks(result);
  }
  return res.send(result);
}

/**
 * Query a single collection.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const name = req.params.name;
  const version = req.params.version;
  try {
    const c = new models.Collection();
    const result = await c.get({ name, version });
    // const stats = await collection.getStats([res], [res.name]);
    return res.send(result);
  } catch (error) {
    return res.boom.notFound(error.message);
  }
}

/**
 * Creates a new collection
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const {
    collectionsModel = new models.Collection(),
    dbClient = await getKnexClient(),
  } = req.testContext || {};

  const collection = req.body || {};
  const { name, version } = collection;

  if (!name || !version) {
    return res.boom.badRequest('Field name and/or version is missing');
  }

  if (await collectionsModel.exists(name, version)) {
    return res.boom.conflict(`A record already exists for ${name} version: ${version}`);
  }

  collection.updatedAt = Date.now();
  collection.createdAt = Date.now();

  try {
    const dynamoRecord = await collectionsModel.create(
      omit(collection, 'dataType')
    );

    const dbRecord = dynamoRecordToDbRecord(dynamoRecord);

    try {
      await dbClient('collections').insert(dbRecord, 'cumulus_id');
    } catch (error) {
      await collectionsModel.delete({ name, version });

      throw error;
    }

    if (inTestMode()) {
      await addToLocalES(collection, indexCollection);
    }

    return res.send({
      message: 'Record saved',
      record: collection,
    });
  } catch (error) {
    if (
      isBadRequestError(error)
      || error instanceof InvalidRegexError
      || error instanceof UnmatchedRegexError
    ) {
      return res.boom.badRequest(error.message);
    }
    log.error('Error occurred while trying to create collection:', error);
    return res.boom.badImplementation(error.message);
  }
}

/**
 * Updates an existing collection
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function put(req, res) {
  const { name, version } = req.params;
  const collection = req.body;
  let dynamoRecord;
  let oldCollection;

  if (name !== collection.name || version !== collection.version) {
    return res.boom.badRequest('Expected collection name and version to be'
      + ` '${name}' and '${version}', respectively, but found '${collection.name}'`
      + ` and '${collection.version}' in payload`);
  }
  const collectionsModel = new models.Collection();
  const collectionPgModel = new CollectionPgModel();

  try {
    oldCollection = await collectionsModel.get({ name, version });
  } catch (error) {
    if (error.name !== 'RecordDoesNotExist') {
      throw error;
    }
    return res.boom.notFound(`Collection '${name}' version '${version}' not found`);
  }

  collection.updatedAt = Date.now();
  collection.createdAt = oldCollection.createdAt;

  const postgresCollection = dynamoRecordToDbRecord(collection);

  const dbClient = await getKnexClient();
  await dbClient.transaction(async (trx) => {
    await collectionPgModel.upsert(trx, postgresCollection);
    dynamoRecord = await collectionsModel.create(collection);
  });

  if (inTestMode()) {
    await addToLocalES(dynamoRecord, indexCollection);
  }

  return res.send(dynamoRecord);
}

/**
 * Delete a collection record
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const { name, version } = req.params;
  const collectionsModel = new models.Collection();

  const knex = await getKnexClient({ env: process.env });
  try {
    await createRejectableTransaction(knex, async (trx) => {
      await trx(TableNames.collections).where({ name, version }).del();
      await collectionsModel.delete({ name, version });
      if (inTestMode()) {
        const collectionId = constructCollectionId(name, version);
        const esClient = await Search.es(process.env.ES_HOST);
        await esClient.delete({
          id: collectionId,
          index: process.env.ES_INDEX,
          type: 'collection',
        }, { ignore: [404] });
      }
    });
    return res.send({ message: 'Record deleted' });
  } catch (error) {
    log.debug(`Failed to delete collection with name ${name} and version ${version}. Error: ${JSON.stringify(error)}`);
    if (error instanceof AssociatedRulesError) {
      const message = `Cannot delete collection with associated rules: ${error.rules.join(', ')}`;
      return res.boom.conflict(message);
    }
    throw error;
  }
}

// express routes
router.get('/:name/:version', get);
router.put('/:name/:version', put);
router.delete('/:name/:version', del);
router.post('/', post);
router.get('/', list);
router.get('/active', activeList);

module.exports = {
  del,
  dynamoRecordToDbRecord,
  post,
  put,
  router,
};
