'use strict';

const router = require('express-promise-router')();
const isBoolean = require('lodash/isBoolean');

const asyncOperations = require('@cumulus/async-operations');
const {
  CollectionPgModel,
  ExecutionPgModel,
  getKnexClient,
  getUniqueGranuleByGranuleId,
  GranulePgModel,
  translateApiGranuleToPostgresGranule,
  translatePostgresCollectionToApiCollection,
  translatePostgresGranuleToApiGranule,
} = require('@cumulus/db');
const {
  RecordDoesNotExist,
} = require('@cumulus/errors');
const { Search } = require('@cumulus/es-client/search');
const { deconstructCollectionId } = require('@cumulus/message/Collections');
const Logger = require('@cumulus/logger');

const {
  deleteGranuleAndFiles,
} = require('../src/lib/granule-delete');
const { chooseTargetExecution } = require('../lib/executions');
const {
  createGranuleFromApi,
  updateGranuleFromApi,
  updateGranuleStatusToQueued,
  writeGranuleRecordAndPublishSns,
} = require('../lib/writeRecords/write-granules');
const { asyncOperationEndpointErrorHandler } = require('../app/middleware');
const { errorify } = require('../lib/utils');
const AsyncOperation = require('../models/async-operation');
const Granule = require('../models/granules');
const { moveGranule } = require('../lib/granules');
const { reingestGranule, applyWorkflow } = require('../lib/ingest');
const { unpublishGranule } = require('../lib/granule-remove-from-cmr');
const { addOrcaRecoveryStatus, getOrcaRecoveryStatusByGranuleId } = require('../lib/orca');
const { validateBulkGranulesRequest, getFunctionNameFromRequestContext } = require('../lib/request');

const log = new Logger({ sender: '@cumulus/api/granules' });

/**
* 200/201 helper method for .put update/create messages
* @param {boolean} isNewRecord - Boolean variable representing if the granule is a new record
* @param {boolean} granule   - API Granule being written
* @param {Object} res        - express response object
* @returns {Promise<Object>} Promise resolving to an express response object
*/
function _returnPutGranuleStatus(isNewRecord, granule, res) {
  if (isNewRecord) {
    return res.status(201).send(
      { message: `Successfully wrote granule with Granule Id: ${granule.granuleId}, Collection Id: ${granule.collectionId}` }
    );
  }
  return res.status(200).send(
    { message: `Successfully updated granule with Granule Id: ${granule.granuleId}, Collection Id: ${granule.collectionId}` }
  );
}

/**
 * List all granules for a given collection.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function list(req, res) {
  const { getRecoveryStatus, ...queryStringParameters } = req.query;
  const es = new Search(
    { queryStringParameters },
    'granule',
    process.env.ES_INDEX
  );

  let result = await es.query();
  if (getRecoveryStatus === 'true') {
    result = await addOrcaRecoveryStatus(result);
  }

  return res.send(result);
}

/**
 * Create new granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object.
 */
const create = async (req, res) => {
  const {
    knex = await getKnexClient(),
    collectionPgModel = new CollectionPgModel(),
    granulePgModel = new GranulePgModel(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const granule = req.body || {};

  try {
    const pgGranule = await translateApiGranuleToPostgresGranule(granule, knex);
    if (
      await granulePgModel.exists(knex, {
        granule_id: pgGranule.granule_id,
        collection_cumulus_id: await collectionPgModel.getRecordCumulusId(
          knex,
          deconstructCollectionId(granule.collectionId)
        ),
      })
    ) {
      return res.boom.conflict(
        `A granule already exists for granule_id: ${granule.granuleId}`
      );
    }
  } catch (error) {
    return res.boom.badRequest(errorify(error));
  } try {
    await createGranuleFromApi(granule, knex, esClient);
  } catch (error) {
    log.error('Could not write granule', error);
    return res.boom.badRequest(JSON.stringify(error, Object.getOwnPropertyNames(error)));
  }
  return res.send({ message: `Successfully wrote granule with Granule Id: ${granule.granuleId}, Collection Id: ${granule.collectionId}` });
};

/**
 * Update existing granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object.
 */
const putGranule = async (req, res) => {
  const {
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};
  const apiGranule = req.body || {};

  let pgCollection;

  if (!apiGranule.collectionId) {
    res.boom.badRequest('Granule update must include a valid CollectionId');
  }

  try {
    pgCollection = await collectionPgModel.get(
      knex, deconstructCollectionId(apiGranule.collectionId)
    );
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      log.error(`granule collectionId ${apiGranule.collectionId} does not exist, cannot update granule`);
      res.boom.badRequest(`granule collectionId ${apiGranule.collectionId} invalid`);
    } else {
      throw error;
    }
  }

  let isNewRecord = false;
  try {
    await granulePgModel.get(knex, {
      granule_id: apiGranule.granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    }); // TODO this should do a select count, not a full record get
  } catch (error) {
    // Set status to `201 - Created` if record did not originally exist
    if (error instanceof RecordDoesNotExist) {
      isNewRecord = true;
    } else {
      return res.boom.badRequest(errorify(error));
    }
  }

  try {
    await updateGranuleFromApi(apiGranule, knex, esClient);
  } catch (error) {
    log.error('failed to update granule', error);
    return res.boom.badRequest(errorify(error));
  }
  return _returnPutGranuleStatus(isNewRecord, apiGranule, res);
};

/**
 * Update a single granule.
 * Supported Actions: reingest, move, applyWorkflow, RemoveFromCMR.
 * If no action is included on the request, the body is assumed to be an
 * existing granule to update, and update is called with the input parameters.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function put(req, res) {
  const {
    granuleModel = new Granule(),
    knex = await getKnexClient(),
    granulePgModel = new GranulePgModel(),
    reingestHandler = reingestGranule,
    updateGranuleStatusToQueuedMethod = updateGranuleStatusToQueued,
  } = req.testContext || {};

  const granuleId = req.params.granuleName;
  const body = req.body;
  const action = body.action;

  if (!action) {
    if (req.body.granuleId === req.params.granuleName) {
      return putGranule(req, res);
    }
    return res.boom.badRequest(
      `input :granuleName (${req.params.granuleName}) must match body's granuleId (${req.body.granuleId})`
    );
  }

  const pgGranule = await getUniqueGranuleByGranuleId(knex, granuleId, granulePgModel);

  const collectionPgModel = new CollectionPgModel();
  const pgCollection = await collectionPgModel.get(
    knex,
    { cumulus_id: pgGranule.collection_cumulus_id }
  );
  const apiGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    collectionPgRecord: pgCollection,
    knexOrTransaction: knex,
  });

  if (action === 'reingest') {
    const apiCollection = translatePostgresCollectionToApiCollection(pgCollection);
    let targetExecution;
    try {
      targetExecution = await chooseTargetExecution({
        granuleId, executionArn: body.executionArn, workflowName: body.workflowName,
      });
    } catch (error) {
      if (error instanceof RecordDoesNotExist) {
        return res.boom.badRequest(`Cannot reingest granule: ${error.message}`);
      }
      throw error;
    }

    if (targetExecution) {
      log.info(`targetExecution has been specified for granule (${granuleId}) reingest: ${targetExecution}`);
    }

    await updateGranuleStatusToQueuedMethod({ apiGranule, knex });

    await reingestHandler({
      apiGranule: {
        ...apiGranule,
        ...(targetExecution && { execution: targetExecution }),
      },
      queueUrl: process.env.backgroundQueueUrl,
    });

    const response = {
      action,
      granuleId: apiGranule.granuleId,
      status: 'SUCCESS',
    };

    if (apiCollection.duplicateHandling !== 'replace') {
      response.warning = 'The granule files may be overwritten';
    }
    return res.send(response);
  }

  if (action === 'applyWorkflow') {
    await updateGranuleStatusToQueued({ apiGranule, knex });
    await applyWorkflow({
      apiGranule,
      workflow: body.workflow,
      meta: body.meta,
    });

    return res.send({
      granuleId: apiGranule.granuleId,
      action: `applyWorkflow ${body.workflow}`,
      status: 'SUCCESS',
    });
  }

  if (action === 'removeFromCmr') {
    await unpublishGranule({
      knex,
      pgGranuleRecord: pgGranule,
      pgCollection: pgCollection,
    });

    return res.send({
      granuleId: apiGranule.granuleId,
      action,
      status: 'SUCCESS',
    });
  }

  if (action === 'move') {
    // FUTURE - this should be removed from the granule model
    // TODO -- Phase 3 -- This needs to be pulled out of the granule model
    const filesAtDestination = await granuleModel.getFilesExistingAtLocation(
      apiGranule,
      body.destinations
    );

    if (filesAtDestination.length > 0) {
      const filenames = filesAtDestination.map((file) => file.fileName);
      const message = `Cannot move granule because the following files would be overwritten at the destination location: ${filenames.join(', ')}. Delete the existing files or reingest the source files.`;

      return res.boom.conflict(message);
    }

    await moveGranule(
      apiGranule,
      body.destinations,
      process.env.DISTRIBUTION_ENDPOINT,
      granuleModel
    );

    return res.send({
      granuleId: apiGranule.granuleId,
      action,
      status: 'SUCCESS',
    });
  }
  return res.boom.badRequest('Action is not supported. Choices are "applyWorkflow", "move", "reingest", "removeFromCmr" or specify no "action" to update an existing granule');
}

/**
 * associate an execution with a granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} promise of an express response object
 */
const associateExecution = async (req, res) => {
  const granuleName = req.params.granuleName;

  const { collectionId, granuleId, executionArn } = req.body || {};
  if (!granuleId || !collectionId || !executionArn) {
    return res.boom.badRequest('Field granuleId, collectionId or executionArn is missing from request body');
  }

  if (granuleName !== granuleId) {
    return res.boom.badRequest(`Expected granuleId to be ${granuleName} but found ${granuleId} in payload`);
  }

  const {
    executionPgModel = new ExecutionPgModel(),
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  let pgGranule;
  let pgExecution;
  let pgCollection;
  try {
    pgCollection = await collectionPgModel.get(
      knex, deconstructCollectionId(collectionId)
    );
    pgGranule = await granulePgModel.get(knex, {
      granule_id: granuleId,
      collection_cumulus_id: pgCollection.cumulus_id,
    });
    pgExecution = await executionPgModel.get(knex, {
      arn: executionArn,
    });
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      if (pgCollection === undefined) {
        return res.boom.notFound(`No collection found to associate execution with for collectionId ${collectionId}`);
      }
      if (pgGranule === undefined) {
        return res.boom.notFound(`No granule found to associate execution with for granuleId ${granuleId} and collectionId: ${collectionId}`);
      }
      if (pgExecution === undefined) {
        return res.boom.notFound(`No execution found to associate granule with for executionArn ${executionArn}`);
      }
      return res.boom.notFound(`Execution ${executionArn} not found`);
    }
    return res.boom.badRequest(errorify(error));
  }

  // Update both granule objects with new execution/updatedAt time
  const updatedPgGranule = {
    ...pgGranule,
    updated_at: new Date(),
  };
  const apiGranuleRecord = {
    ...(await translatePostgresGranuleToApiGranule({
      knexOrTransaction: knex,
      granulePgRecord: updatedPgGranule,
    })),
    execution: pgExecution.url,
  };

  try {
    await writeGranuleRecordAndPublishSns({
      apiGranuleRecord,
      esClient,
      executionCumulusId: pgExecution.cumulus_id,
      granuleModel: new Granule(),
      granulePgModel,
      postgresGranuleRecord: updatedPgGranule,
      knex,
      snsEventType: 'Update',
    });
  } catch (error) {
    log.error(`failed to associate execution ${executionArn} with granule granuleId ${granuleId} collectionId ${collectionId}`, error);
    return res.boom.badRequest(errorify(error));
  }
  return res.send({
    message: `Successfully associated execution ${executionArn} with granule granuleId ${granuleId} collectionId ${collectionId}`,
  });
};

/**
 * Delete a granule
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function del(req, res) {
  const {
    knex = await getKnexClient(),
    esClient = await Search.es(),
  } = req.testContext || {};

  const granuleId = req.params.granuleName;
  const esGranulesClient = new Search(
    {},
    'granule',
    process.env.ES_INDEX
  );
  log.info(`granules.del ${granuleId}`);

  let pgGranule;
  let esResult;
  try {
    // TODO - Phase 3 - we need a ticket to address granule/collection consistency
    // For now use granule ID without collection search in ES
    pgGranule = await getUniqueGranuleByGranuleId(knex, granuleId);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      // TODO - Phase 3 - we need to require the collectionID, not infer it

      esResult = await esGranulesClient.get(granuleId);

      if (esResult.detail === 'Record not found') {
        log.info('Granule does not exist in Elasticsearch and PostgreSQL');
        return res.boom.notFound('No record found');
      }
      if (esResult.detail === 'More than one record was found!') {
        return res.boom.notFound('No Postgres record found, multiple ES entries found for deletion');
      }
      log.info(`Postgres Granule with ID ${granuleId} does not exist but exists in Elasticsearch.  Proceeding to remove from elasticsearch.`);
    } else {
      throw error;
    }
  }

  await deleteGranuleAndFiles({
    knex,
    apiGranule: esResult,
    pgGranule: pgGranule,
    esClient,
  });

  return res.send({ detail: 'Record deleted' });
}

/**
 * Query a single granule.
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function get(req, res) {
  const {
    knex = await getKnexClient(),
  } = req.testContext || {};
  const { getRecoveryStatus } = req.query;
  const granuleId = req.params.granuleName;
  let granule;
  try {
    granule = await getUniqueGranuleByGranuleId(knex, granuleId);
  } catch (error) {
    if (error instanceof RecordDoesNotExist) {
      return res.boom.notFound('Granule not found');
    }

    throw error;
  }

  // Get related files, execution ARNs, provider, PDR, and collection and format
  const result = await translatePostgresGranuleToApiGranule({
    granulePgRecord: granule,
    knexOrTransaction: knex,
  });

  const recoveryStatus = getRecoveryStatus === 'true'
    ? await getOrcaRecoveryStatusByGranuleId(granuleId)
    : undefined;
  return res.send({ ...result, recoveryStatus });
}

async function bulkOperations(req, res) {
  const payload = req.body;

  if (!payload.workflowName) {
    return res.boom.badRequest('workflowName is required.');
  }
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  // TODO remove this env variable setting when we update the async model
  const tableName = process.env.AsyncOperationsTable;

  let description;
  if (payload.query) {
    description = `Bulk run ${payload.workflowName} on ${payload.query.size} granules`;
  } else if (payload.ids) {
    description = `Bulk run ${payload.workflowName} on ${payload.ids.length} granules`;
  } else {
    description = `Bulk run on ${payload.workflowName}`;
  }

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.BulkOperationLambda,
    description,
    operationType: 'Bulk Granules',
    payload: {
      payload,
      type: 'BULK_GRANULE',
      envVars: {
        ES_HOST: process.env.ES_HOST,
        GranulesTable: process.env.GranulesTable,
        granule_sns_topic_arn: process.env.granule_sns_topic_arn,
        system_bucket: process.env.system_bucket,
        stackName: process.env.stackName,
        invoke: process.env.invoke,
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
      },
    },
    esHost: process.env.ES_HOST,
    stackName,
    systemBucket,
    dynamoTableName: tableName,
    knexConfig: process.env,
  }, AsyncOperation);

  return res.status(202).send(asyncOperation);
}

/**
 * Start an AsyncOperation that will perform a bulk granules delete
 *
 * @param {Object} req - express request object
 * @param {Object} res - express response object
 * @returns {Promise<Object>} the promise of express response object
 */
async function bulkDelete(req, res) {
  const payload = req.body;

  if (payload.forceRemoveFromCmr && !isBoolean(payload.forceRemoveFromCmr)) {
    return res.boom.badRequest('forceRemoveFromCmr must be a boolean value');
  }

  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const tableName = process.env.AsyncOperationsTable;

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.BulkOperationLambda,
    description: 'Bulk granule deletion',
    operationType: 'Bulk Granule Delete', // this value is set on an ENUM field, so cannot change
    payload: {
      type: 'BULK_GRANULE_DELETE',
      payload,
      envVars: {
        cmr_client_id: process.env.cmr_client_id,
        CMR_ENVIRONMENT: process.env.CMR_ENVIRONMENT,
        cmr_oauth_provider: process.env.cmr_oauth_provider,
        cmr_password_secret_name: process.env.cmr_password_secret_name,
        cmr_provider: process.env.cmr_provider,
        cmr_username: process.env.cmr_username,
        GranulesTable: process.env.GranulesTable,
        granule_sns_topic_arn: process.env.granule_sns_topic_arn,
        launchpad_api: process.env.launchpad_api,
        launchpad_certificate: process.env.launchpad_certificate,
        launchpad_passphrase_secret_name: process.env.launchpad_passphrase_secret_name,
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
        stackName: process.env.stackName,
        system_bucket: process.env.system_bucket,
        ES_HOST: process.env.ES_HOST,
      },
    },
    stackName,
    systemBucket,
    dynamoTableName: tableName,
    knexConfig: process.env,
  }, AsyncOperation);

  return res.status(202).send(asyncOperation);
}

async function bulkReingest(req, res) {
  const payload = req.body;
  const stackName = process.env.stackName;
  const systemBucket = process.env.system_bucket;
  const tableName = process.env.AsyncOperationsTable;

  const numOfGranules = (payload.query && payload.query.size)
    || (payload.ids && payload.ids.length);
  const description = `Bulk granule reingest run on ${numOfGranules || ''} granules`;

  const asyncOperation = await asyncOperations.startAsyncOperation({
    asyncOperationTaskDefinition: process.env.AsyncOperationTaskDefinition,
    cluster: process.env.EcsCluster,
    callerLambdaName: getFunctionNameFromRequestContext(req),
    lambdaName: process.env.BulkOperationLambda,
    description,
    operationType: 'Bulk Granule Reingest',
    payload: {
      payload,
      type: 'BULK_GRANULE_REINGEST',
      envVars: {
        ES_HOST: process.env.ES_HOST,
        GranulesTable: process.env.GranulesTable,
        granule_sns_topic_arn: process.env.granule_sns_topic_arn,
        system_bucket: process.env.system_bucket,
        stackName: process.env.stackName,
        invoke: process.env.invoke,
        METRICS_ES_HOST: process.env.METRICS_ES_HOST,
        METRICS_ES_USER: process.env.METRICS_ES_USER,
        METRICS_ES_PASS: process.env.METRICS_ES_PASS,
      },
    },
    esHost: process.env.ES_HOST,
    stackName,
    systemBucket,
    dynamoTableName: tableName,
    knexConfig: process.env,
  }, AsyncOperation);

  return res.status(202).send(asyncOperation);
}

router.get('/:granuleName', get);
router.get('/', list);
router.post('/:granuleName/executions', associateExecution);
router.post('/', create);
router.put('/:granuleName', put);

router.post(
  '/bulk',
  validateBulkGranulesRequest,
  bulkOperations,
  asyncOperationEndpointErrorHandler
);
router.post(
  '/bulkDelete',
  validateBulkGranulesRequest,
  bulkDelete,
  asyncOperationEndpointErrorHandler
);
router.post(
  '/bulkReingest',
  validateBulkGranulesRequest,
  bulkReingest,
  asyncOperationEndpointErrorHandler
);
router.delete('/:granuleName', del);

module.exports = {
  bulkOperations,
  bulkReingest,
  bulkDelete,
  put,
  router,
};
