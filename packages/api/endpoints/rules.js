'use strict';

const router = require('express-promise-router')();
const { inTestMode } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/errors');
const Logger = require('@cumulus/logger');

const {
  getKnexClient,
  RulePgModel,
  tableNames,
  translateApiRuleToPostgresRule,
} = require('@cumulus/db');
const { isBadRequestError } = require('../lib/errors');
const models = require('../models');
const { Search } = require('../es/search');
const { addToLocalES, indexRule } = require('../es/indexer');

const log = new Logger({ sender: '@cumulus/api/rules' });

/**
 * List all rules.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const search = new Search(
    { queryStringParameters: req.query },
    'rule',
    process.env.ES_INDEX
  );
  const response = await search.query();
  return res.send(response);
}

/**
 * Query a single rule.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const name = req.params.name;

  const model = new models.Rule();
  try {
    const result = await model.get({ name });
    delete result.password;
    return res.send(result);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound('No record found');
    }
    throw error;
  }
}

/**
 * Creates a new rule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function post(req, res) {
  const {
    model = new models.Rule(),
    dbClient = await getKnexClient(),
  } = req.testContext || {};

  let record;
  const apiRule = req.body || {};
  const name = apiRule.name;
  const rulePgModel = new RulePgModel();

  if (await model.exists(name)) {
    return res.boom.conflict(`A record already exists for ${name}`);
  }

  try {
    apiRule.createdAt = Date.now();
    apiRule.updatedAt = Date.now();
    const postgresRule = await translateApiRuleToPostgresRule(apiRule, dbClient);

    await dbClient.transaction(async (trx) => {
      await rulePgModel.create(trx, postgresRule);
      record = await model.create(apiRule);
    });
    if (inTestMode()) await addToLocalES(record, indexRule);
    return res.send({ message: 'Record saved', record });
  } catch (error) {
    if (isBadRequestError(error)) {
      return res.boom.badRequest(error.message);
    }
    log.error('Error occurred while trying to create rule:', error);
    return res.boom.badImplementation(error.message);
  }
}

/**
 * Replaces an existing rule.
 *
 * @param {Object} req - express request object
 * @param {string} req.params.name - name of the rule to replace
 * @param {Object} req.body - complete replacement rule
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object, which
 *    is a Bad Request (400) if the rule's name property does not match the
 *    name request parameter, or a Not Found (404) if there is no existing rule
 *    with the specified name
 */
async function put({ params: { name }, body }, res) {
  const model = new models.Rule();
  const apiRule = { ...body };
  let newRule;

  if (name !== apiRule.name) {
    return res.boom.badRequest(`Expected rule name to be '${name}', but found`
      + ` '${body.name}' in payload`);
  }

  try {
    const oldRule = await model.get({ name });
    const dbClient = await getKnexClient();
    const rulePgModel = new RulePgModel();

    apiRule.updatedAt = Date.now();
    apiRule.createdAt = oldRule.createdAt;
    // If rule type is onetime no change is allowed unless it is a rerun

    if (apiRule.action === 'rerun') {
      return models.Rule.invoke(oldRule).then(() => res.send(oldRule));
    }

    const fieldsToDelete = Object.keys(oldRule).filter(
      (key) => !(key in apiRule) && key !== 'createdAt'
    );
    const postgresRule = await translateApiRuleToPostgresRule(apiRule, dbClient);

    await dbClient.transaction(async (trx) => {
      await rulePgModel.upsert(trx, postgresRule);
      newRule = await model.update(oldRule, apiRule, fieldsToDelete);
    });

    if (inTestMode()) await addToLocalES(newRule, indexRule);
    return res.send(newRule);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound(`Rule '${name}' not found`);
    }

    throw error;
  }
}

/**
 * deletes a rule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const name = (req.params.name || '').replace(/%20/g, ' ');
  const model = new models.Rule();
  const dbClient = await getKnexClient();

  let apiRule;
  try {
    apiRule = await model.get({ name });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound('No record found');
    }
    throw error;
  }

  await dbClient.transaction(async (trx) => {
    await trx(tableNames.rules).where({ name }).del();
    await model.delete(apiRule);
  });

  if (inTestMode()) {
    const esClient = await Search.es(process.env.ES_HOST);
    await esClient.delete({
      id: name,
      index: process.env.ES_INDEX,
      type: 'rule',
    }, { ignore: [404] });
  }
  return res.send({ message: 'Record deleted' });
}

router.get('/:name', get);
router.get('/', list);
router.put('/:name', put);
router.post('/', post);
router.delete('/:name', del);

module.exports = {
  router,
  post,
};
