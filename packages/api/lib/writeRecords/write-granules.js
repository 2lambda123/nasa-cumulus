'use strict';

const AggregateError = require('aggregate-error');
const isEmpty = require('lodash/isEmpty');
const omit = require('lodash/omit');
const pMap = require('p-map');

const { s3 } = require('@cumulus/aws-client/services');
const cmrUtils = require('@cumulus/cmrjs/cmr-utils');
const { buildURL } = require('@cumulus/common/URLUtils');
const {
  CollectionPgModel,
  createRejectableTransaction,
  FilePgModel,
  GranulePgModel,
  translateApiFiletoPostgresFile,
  translateApiGranuleToPostgresGranule,
  upsertGranuleWithExecutionJoinRecord,
} = require('@cumulus/db');
const {
  upsertGranule,
} = require('@cumulus/es-client/indexer');
const {
  Search,
} = require('@cumulus/es-client/search');
const Logger = require('@cumulus/logger');
const {
  deconstructCollectionId,
  getCollectionIdFromMessage,
} = require('@cumulus/message/Collections');
const {
  getMessageExecutionArn,
  getExecutionUrlFromArn,
} = require('@cumulus/message/Executions');
const {
  generateGranuleApiRecord,
  getGranuleProductVolume,
  getGranuleQueryFields,
  getGranuleStatus,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  getMessageGranules,
  messageHasGranules,
} = require('@cumulus/message/Granules');
const {
  getMessagePdrName,
} = require('@cumulus/message/PDRs');
const {
  getMessageProvider,
} = require('@cumulus/message/Providers');
const {
  getMessageWorkflowStartTime,
  getMetaStatus,
  getWorkflowDuration,
} = require('@cumulus/message/workflows');
const { parseException } = require('@cumulus/message/utils');
const { translatePostgresGranuleToApiGranule } = require('@cumulus/db/dist/translate/granules');

const {
  RecordDoesNotExist,
} = require('@cumulus/errors');
const FileUtils = require('../FileUtils');
const {
  getExecutionProcessingTimeInfo,
} = require('../granules');
const Granule = require('../../models/granules');
const {
  publishGranuleSnsMessageByEventType,
} = require('../publishSnsMessageUtils');
const {
  getExecutionCumulusId,
  isStatusFinalState,
} = require('./utils');

const log = new Logger({ sender: '@cumulus/api/lib/writeRecords/write-granules' });

/**
 * Generate a file record to save to the core database.
 *
 * @param {Object} params
 * @param {Object} params.file - File object
 * @param {number} params.granuleCumulusId
 *   Cumulus ID of the granule for this file
 * @returns {Object} - a file record
 */
const generateFilePgRecord = ({ file, granuleCumulusId }) => ({
  ...translateApiFiletoPostgresFile(file),
  granule_cumulus_id: granuleCumulusId,
});

/**
 * Generate file records to save to the core database.
 *
 * @param {Object} params
 * @param {Object} params.files - File objects
 * @param {number} params.granuleCumulusId
 *   Cumulus ID of the granule for this file
 * @returns {Array<Object>} - file records
 */
const _generateFilePgRecords = ({
  files,
  granuleCumulusId,
}) => files.map((file) => generateFilePgRecord({ file, granuleCumulusId }));

/**
 * Write an array of file records to the database
 *
 * @param {Object} params
 * @param {Object} params.fileRecords - File objects
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {Object} params.filePgModel - Optional File model override
 * @returns {Promise} - Promise resolved once all file upserts resolve
 */
const _writeFiles = async ({
  fileRecords,
  knex,
  filePgModel = new FilePgModel(),
}) => await pMap(
  fileRecords,
  async (fileRecord) => {
    log.info('About to write file record to PostgreSQL: %j', fileRecord);
    const [upsertedRecord] = await filePgModel.upsert(knex, fileRecord);
    log.info('Successfully wrote file record to PostgreSQL: %j', fileRecord);
    return upsertedRecord;
  },
  { stopOnError: false }
);

/**
 * Get the granule from a query result or look it up in the database.
 *
 * For certain cases, such as an upsert query that matched no rows, an empty
 * database result is returned, so no cumulus ID will be returned. In those
 * cases, this function will lookup the granule cumulus ID from the record.
 *
 * @param {Object} params
 * @param {Object} params.trx - A Knex transaction
 * @param {Object} params.queryResult - Query result
 * @param {Object} params.granuleRecord - A granule record
 * @param {Object} params.granulePgModel - Database model for granule data
 * @returns {Promise<Object|undefined>} - Granule record
 */
const getGranuleFromQueryResultOrLookup = async ({
  queryResult = [],
  granuleRecord,
  trx,
  granulePgModel = new GranulePgModel(),
}) => {
  let granule = queryResult[0];
  if (!granule) {
    granule = await granulePgModel.get(
      trx,
      {
        granule_id: granuleRecord.granule_id,
        collection_cumulus_id: granuleRecord.collection_cumulus_id,
      }
    );
  }
  return granule;
};

/**
 * Write a granule to PostgreSQL
 *
 * @param {Object} params
 * @param {Object} params.granuleRecord - An postgres granule records
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex.transaction} params.trx - Transaction to interact with PostgreSQL database
 * @param {Object} params.granulePgModel - postgreSQL granule model
 *
 * @returns {Promise<number>} - Cumulus ID from PostgreSQL
 * @throws
 */
const _writePostgresGranuleViaTransaction = async ({
  granuleRecord,
  executionCumulusId,
  trx,
  granulePgModel,
}) => {
  const upsertQueryResult = await upsertGranuleWithExecutionJoinRecord(
    trx,
    granuleRecord,
    executionCumulusId,
    granulePgModel
  );
  // Ensure that we get a granule for the files even if the
  // upsert query returned an empty result
  const pgGranule = await getGranuleFromQueryResultOrLookup({
    trx,
    queryResult: upsertQueryResult,
    granuleRecord,
  });

  if (!upsertQueryResult[0]) {
    log.info(`
    Did not update ${granuleRecord.granule_id}, collection_cumulus_id ${granuleRecord.collection_cumulus_id}
    due to granule overwrite constraints, retaining original granule for cumulus_id ${pgGranule.cumulus_id}`);
  } else {
    log.info(`
    Successfully wrote granule with granuleId ${granuleRecord.granule_id}, collection_cumulus_id ${granuleRecord.collection_cumulus_id}
    to granule record with cumulus_id ${pgGranule.cumulus_id} in PostgreSQL
    `);
  }
  return pgGranule;
};
/**
* Removes excess files from the postgres database for a given granule
* @summary Given a list of postgres file objects, remove all other file objects
* from the postgres database for the provided granuleCumulusId
* @param {Object} params - Paramter object
* @param {Object} [params.filePgModel] - @cumulus/db compatible FilePgModel, provided for test/mocks
* @param {number} params.granuleCumulusId - postgres cumulus_id
* identifying the granule to be updated
* @param {Object} params.knex - Instance of a Knex client
* @param {[Object]} params.writtenFiles - List of postgres file objects that should
* not be removed by this method.
* @returns {Promise<Object>} Knex .delete response
*/
const _removeExcessFiles = async ({
  filePgModel = new FilePgModel(),
  granuleCumulusId,
  knex,
  writtenFiles,
}) => {
  if (writtenFiles.length === 0) {
    throw new Error('_removeExcessFiles called with no written files');
  }
  const excludeCumulusIds = writtenFiles.map((file) => file.cumulus_id);
  return await filePgModel.deleteExcluding({
    knexOrTransaction: knex,
    queryParams: { granule_cumulus_id: granuleCumulusId },
    excludeCumulusIds,
  });
};

const _publishPostgresGranuleUpdateToSns = async ({
  snsEventType,
  pgGranule,
  knex,
}) => {
  const granuletoPublish = await translatePostgresGranuleToApiGranule({
    granulePgRecord: pgGranule,
    knexOrTransaction: knex,
  });
  await publishGranuleSnsMessageByEventType(granuletoPublish, snsEventType);
  log.info('Successfully wrote granule %j to SNS topic', granuletoPublish);
};

/**
 * Update granule record status in DynamoDB, PostgreSQL, Elasticsearch.
 * Publish SNS event for updated granule.
 *
 * @param {Object}  params
 * @param {Object}  params.apiGranule            - API Granule object to write to
 *                                                 the database
 * @param {Object}  params.postgresGranule       - PostgreSQL granule
 * @param {Object}  params.apiFieldUpdates       - API fields to update
 * @param {Object}  params.pgFieldUpdates        - PostgreSQL fields to update
 * @param {Object}  params.apiFieldsToDelete     - API fields to delete
 * @param {Object}  params.granuleModel          - Instance of DynamoDB granule model
 * @param {Object}  params.granulePgModel        - @cumulus/db compatible granule module instance
 * @param {Knex}    params.knex                  - Knex object
 * @param {string}  params.snsEventType          - SNS Event Type, defaults to 'Update'
 * @param {Object}  params.esClient              - Elasticsearch client
 * returns {Promise}
 */
const _updateGranule = async ({
  apiGranule,
  postgresGranule,
  apiFieldUpdates,
  pgFieldUpdates,
  apiFieldsToDelete,
  granuleModel,
  granulePgModel,
  knex,
  snsEventType = 'Update',
  esClient,
}) => {
  const granuleId = apiGranule.granuleId;
  const esGranule = omit(apiGranule, apiFieldsToDelete);

  let updatedPgGranule;
  await createRejectableTransaction(knex, async (trx) => {
    [updatedPgGranule] = await granulePgModel.update(
      trx,
      { cumulus_id: postgresGranule.cumulus_id },
      pgFieldUpdates,
      ['*']
    );
    log.info(`Successfully wrote granule ${granuleId} to PostgreSQL`);
    try {
      await granuleModel.update({ granuleId }, apiFieldUpdates, apiFieldsToDelete);
      log.info(`Successfully wrote granule ${granuleId} to DynamoDB`);
      await upsertGranule({
        esClient,
        updates: {
          ...esGranule,
          ...apiFieldUpdates,
        },
        index: process.env.ES_INDEX,
      });
      log.info(`Successfully wrote granule ${granuleId} to Elasticsearch`);
    } catch (writeError) {
      log.error(`Writes to DynamoDB/Elasticsearch failed, rolling back all writes for granule ${granuleId}`, writeError);
      // On error, recreate the DynamoDB record to revert it back to original
      // status to ensure that all systems stay in sync
      await granuleModel.create(apiGranule);
      throw writeError;
    }
  });

  log.info(
    `
    Successfully wrote granule %j to PostgreSQL. Record cumulus_id in PostgreSQL: ${updatedPgGranule.cumulus_id}.
    `,
    updatedPgGranule
  );
  log.info('Successfully wrote granule %j to DynamoDB', apiGranule);

  await _publishPostgresGranuleUpdateToSns({
    snsEventType,
    pgGranule: updatedPgGranule,
    knex,
  });
};

/**
 * Update granule status to 'failed'
 *
 * @param {Object} params
 * @param {Object} params.granule - Granule from the payload
 * @param {Knex} params.knex - knex Client
 * @param {Object} params.error - error object to be set in the granule
 * @returns {Promise}
 * @throws {Error}
 */
const updateGranuleStatusToFailed = async (params) => {
  const {
    granule,
    knex,
    error = {},
    collectionPgModel = new CollectionPgModel(),
    granuleModel = new Granule(),
    granulePgModel = new GranulePgModel(),
    esClient = await Search.es(),
  } = params;
  const status = 'failed';
  const { granuleId, collectionId } = granule;
  log.info(`updateGranuleStatusToFailed(): granuleId: ${granuleId}, collectionId: ${collectionId}`);

  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
      knex,
      deconstructCollectionId(collectionId)
    );
    const pgGranule = await granulePgModel.get(
      knex,
      {
        granule_id: granuleId,
        collection_cumulus_id: collectionCumulusId,
      }
    );

    await _updateGranule({
      apiGranule: granule,
      postgresGranule: pgGranule,
      apiFieldUpdates: { status, error },
      pgFieldUpdates: { status, error },
      granuleModel,
      granulePgModel,
      knex,
      snsEventType: 'Update',
      esClient,
    });
    log.debug(`Updated granule status to failed, Dynamo granuleId: ${granule.granuleId}, PostgreSQL cumulus_id: ${pgGranule.cumulus_id}`);
  } catch (thrownError) {
    log.error(`Failed to update granule status to failed, granuleId: ${granule.granuleId}, collectionId: ${collectionId}`, thrownError.toString());
    throw thrownError;
  }
};

/**
 * Generate file records based on workflow status, write files to
 * the database, and update granule status if file writes fail
 *
 * @param {Object} params
 * @param {Object} [params.files] - File objects
 * @param {number} params.granuleCumulusId - Cumulus ID of the granule for this file
 * @param {string} params.granule - Granule from the payload
 * @param {Object} params.workflowError - Error from the workflow
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {string} params.snsEventType - SNS Event Type
 * @param {Object} [params.granuleModel] - Optional Granule DDB model override
 * @param {Object} [params.granulePgModel] - Optional Granule PG model override
 * @returns {undefined}
 */
const _writeGranuleFiles = async ({
  granuleCumulusId,
  granule,
  knex,
}) => {
  let fileRecords = [];
  const { files, granuleId, status, error: workflowError } = granule;
  if (isStatusFinalState(status)) {
    fileRecords = _generateFilePgRecords({
      files,
      granuleCumulusId,
    });
  }
  try {
    const writtenFiles = await _writeFiles({
      fileRecords,
      knex,
    });
    await _removeExcessFiles({
      writtenFiles,
      granuleCumulusId,
      knex,
    });
  } catch (error) {
    const errors = [];
    if (!isEmpty(workflowError)) {
      log.error(`Logging existing error encountered by granule ${granuleId} before overwrite`, workflowError);
      errors.push(workflowError);
    }
    log.error('Failed writing files to PostgreSQL, updating granule with error', error.toString());
    const errorObject = {
      Error: 'Failed writing files to PostgreSQL.',
      Cause: error.toString(),
    };
    errors.push(errorObject);

    const errorsObject = {
      errors: JSON.stringify(errors),
    };

    await updateGranuleStatusToFailed({
      granule,
      knex,
      error: errorsObject,
    });
  }
};

/**
 * Transform granule files to latest file API structure
 *
 * @param {Object} params
 * @param {Object} params.granule - An API granule object
 * @param {Object} params.provider - An API provider object
 *
* @returns {Promise<Array>} - A list of file objects once resolved
 */
const _generateFilesFromGranule = async ({
  granule,
  provider,
}) => {
  const { files = [] } = granule;
  // This is necessary to set properties like
  // `key`, which is required for the PostgreSQL schema. And
  // `size` which is used to calculate the granule product
  // volume
  return await FileUtils.buildDatabaseFiles({
    s3: s3(),
    providerURL: buildURL(provider),
    files,
  });
};

const _writeGranuleRecords = async (params) => {
  const {
    postgresGranuleRecord,
    apiGranuleRecord,
    knex,
    esClient = await Search.es(),
    granuleModel,
    executionCumulusId,
    granulePgModel,
  } = params;
  let pgGranule;
  log.info('About to write granule record %j to PostgreSQL', postgresGranuleRecord);
  log.info('About to write granule record %j to DynamoDB', apiGranuleRecord);

  try {
    await createRejectableTransaction(knex, async (trx) => {
      pgGranule = await _writePostgresGranuleViaTransaction({
        granuleRecord: postgresGranuleRecord,
        executionCumulusId,
        trx,
        granulePgModel,
      });
      await granuleModel.storeGranule(apiGranuleRecord);
      await upsertGranule({
        esClient,
        updates: apiGranuleRecord,
        index: process.env.ES_INDEX,
      });
    });
    log.info(
      `Completed write operation to PostgreSQL for granule %j. Record cumulus_id in PostgreSQL: ${pgGranule.cumulus_id}.`,
      postgresGranuleRecord
    );
    log.info(
      'Completed write operation to DynamoDb for granule %j',
      apiGranuleRecord
    );
    return pgGranule;
  } catch (thrownError) {
    log.error(`Write Granule failed: ${JSON.stringify(thrownError)}`);

    // If a postgres record was provided
    // attempt to ensure alignment between postgress/dynamo/es
    if (pgGranule) {
      // Align dynamo granule record with postgres record
      // Retrieve the granule from postgres
      let pgGranuleExists;
      let latestPgGranule;
      try {
        latestPgGranule = await granulePgModel.get(knex, {
          granule_id: pgGranule.granule_id,
          collection_cumulus_id: pgGranule.collection_cumulus_id,
        });
        pgGranuleExists = true;
      } catch (getPgGranuleError) {
        log.error(`Could not retrieve latest postgres record for granule_id ${pgGranule.granule_id} because ${JSON.stringify(getPgGranuleError)}`);
        if (getPgGranuleError instanceof RecordDoesNotExist) {
          pgGranuleExists = false;
        }
      }

      // Delete the dynamo record (stays deleted if postgres record does not exist)
      await granuleModel.delete({
        granuleId: apiGranuleRecord.granuleId,
        collectionId: apiGranuleRecord.collectionId,
      });
      // Recreate the dynamo record in alignment with postgres if the postgres record exists
      if (pgGranuleExists) {
        const alignedDynamoRecord = await translatePostgresGranuleToApiGranule(
          {
            granulePgRecord: latestPgGranule,
            knexOrTransaction: knex,
          }
        );
        await granuleModel.storeGranule(alignedDynamoRecord);
      }

      // If granule is in a final state and the error thrown
      // is a SchemaValidationError then update the granule
      // status to failed
      if (isStatusFinalState(apiGranuleRecord.status)
        && thrownError.name === 'SchemaValidationError') {
        const originalError = apiGranuleRecord.error;

        const errors = [];
        if (originalError) {
          errors.push(originalError);
        }
        const errorObject = {
          Error: 'Failed writing dynamoGranule due to SchemaValdationError.',
          Cause: thrownError,
        };
        errors.push(errorObject);
        const errorsObject = {
          errors: JSON.stringify(errors),
        };

        await updateGranuleStatusToFailed({
          granule: apiGranuleRecord,
          knex,
          error: errorsObject,
        });
      }
    }
    throw thrownError;
  }
};

const _writePostgresFilesFromApiGranuleFiles = async ({
  apiGranuleRecord,
  granuleCumulusId,
  knex,
  snsEventType,
}) => {
  const { files, status } = apiGranuleRecord;
  if (isStatusFinalState(status) && files.length > 0) {
    await _writeGranuleFiles({
      granuleCumulusId: granuleCumulusId,
      granule: apiGranuleRecord,
      knex,
      snsEventType,
      granuleModel: new Granule(),
    });
  }
};

/**
 * Write a granule record to DynamoDB and PostgreSQL
 *
 * @param {Object}          params
 * @param {Object}          params.apiGranuleRecord - Api Granule object to write to the database
 * @param {number}          params.executionCumulusId - Execution ID the granule was written from
 * @param {Object}          params.esClient - Elasticsearch client
 * @param {Object}          params.granuleModel - Instance of DynamoDB granule model
 * @param {Object}          params.granulePgModel - @cumulus/db compatible granule module instance
 * @param {Knex}            params.knex - Knex object
 * @param {Object}          params.postgresGranuleRecord - PostgreSQL granule record to write
 *                                                         to database
 * @param {string}          params.snsEventType - SNS Event Type
 * returns {Promise}
 */
const _writeGranule = async ({
  postgresGranuleRecord,
  apiGranuleRecord,
  esClient,
  executionCumulusId,
  granuleModel,
  granulePgModel,
  knex,
  snsEventType,
}) => {
  const pgGranule = await _writeGranuleRecords({
    postgresGranuleRecord,
    apiGranuleRecord,
    knex,
    esClient,
    granuleModel,
    executionCumulusId,
    granulePgModel,
  });
  await _writePostgresFilesFromApiGranuleFiles({
    apiGranuleRecord,
    granuleCumulusId: pgGranule.cumulus_id,
    knex,
    snsEventType,
  });

  await _publishPostgresGranuleUpdateToSns({
    snsEventType,
    pgGranule,
    knex,
  });
};

/**
* Method to facilitate parital granule record updates
* @summary In cases where a full API record is not passed, but partial/tangential updates to granule
*          records are called for, updates to files records are not required and pre-write
*          calculation in methods like write/update GranulesFromApi result in unneded
*          evaluation/database writes /etc. This method updates the postgres/Dynamo/ES datastore and
*          publishes the SNS update event without incurring unneded overhead.
* @param {Object}          params
* @param {Object}          params.apiGranuleRecord - Api Granule object to write to the database
* @param {number}          params.executionCumulusId - Execution ID the granule was written from
* @param {Object}          params.esClient - Elasticsearch client
* @param {Object}          params.granuleModel - Instance of DynamoDB granule model
* @param {Object}          params.granulePgModel - @cumulus/db compatible granule module instance
* @param {Knex}            params.knex - Knex object
* @param {Object}          params.postgresGranuleRecord - PostgreSQL granule record to write
*                                                         to database
* @param {string}          params.snsEventType - SNS Event Type
* @returns {Promise}
*/
const writeGranuleRecordAndPublishSns = async ({
  postgresGranuleRecord,
  apiGranuleRecord,
  esClient,
  executionCumulusId,
  granuleModel,
  granulePgModel,
  knex,
  snsEventType = 'Update',
}) => {
  const pgGranule = await _writeGranuleRecords({
    postgresGranuleRecord,
    apiGranuleRecord,
    knex,
    esClient,
    granuleModel,
    executionCumulusId,
    granulePgModel,
  });
  await _publishPostgresGranuleUpdateToSns({
    snsEventType,
    pgGranule,
    knex,
  });
};

/**
 * Thin wrapper to _writeGranule used by endpoints/granule to create a granule
 * directly.
 *
 * @param {Object} granule -- API Granule object
 * @param {string} granule.granuleId - granule's id
 * @param {string} granule.collectionId - granule's collection id
 * @param {GranuleStatus} granule.status - ['running','failed','completed', 'queued']
 * @param {string} [granule.execution] - Execution URL to associate with this granule
 *                               must already exist in database.
 * @param {string} [granule.cmrLink] - url to CMR information for this granule.
 * @param {boolean} [granule.published] - published to cmr
 * @param {string} [granule.pdrName] - pdr name
 * @param {string} [granule.provider] - provider
 * @param {Object} [granule.error = {}] - workflow errors
 * @param {string} [granule.createdAt = new Date().valueOf()] - time value
 * @param {string} [granule.timestamp] - timestamp
 * @param {string} [granule.updatedAt = new Date().valueOf()] - time value
 * @param {number} [granule.duration] - seconds
 * @param {string} [granule.productVolume] - sum of the files sizes in bytes
 * @param {integer} [granule.timeToPreprocess] -  seconds
 * @param {integer} [granule.timeToArchive] - seconds
 * @param {Array<ApiFile>} granule.files - files associated with the granule.
 * @param {string} [granule.beginningDateTime] - CMR Echo10:
 *                                               Temporal.RangeDateTime.BeginningDateTime
 * @param {string} [granule.endingDateTime] - CMR Echo10: Temporal.RangeDateTime.EndingDateTime
 * @param {string} [granule.productionDateTime] - CMR Echo10: DataGranule.ProductionDateTime
 * @param {string} [granule.lastUpdateDateTime] - CMR Echo10: LastUpdate || InsertTime
 * @param {string} [granule.processingStartDateTime] - execution startDate
 * @param {string} [granule.processingEndDateTime] - execution StopDate
 * @param {Object} [granule.queryFields] - query fields
 * @param {Object} [granule.granuleModel] - only for testing.
 * @param {Object} [granule.granulePgModel] - only for testing.
 * @param {Knex} knex - knex Client
 * @param {Object} esClient - Elasticsearch client
 * @param {string} snsEventType - SNS Event Type
 * @returns {Promise}
 */
const writeGranuleFromApi = async (
  {
    granuleId,
    collectionId,
    status,
    execution,
    cmrLink,
    published,
    pdrName,
    provider,
    error = {},
    createdAt = new Date().valueOf(),
    updatedAt,
    duration,
    productVolume,
    timeToPreprocess,
    timeToArchive,
    timestamp,
    files = [],
    beginningDateTime,
    endingDateTime,
    productionDateTime,
    lastUpdateDateTime,
    processingStartDateTime,
    processingEndDateTime,
    queryFields,
    granuleModel = new Granule(),
    granulePgModel = new GranulePgModel(),
  },
  knex,
  esClient,
  snsEventType
) => {
  try {
    const granule = { granuleId, cmrLink, published, files };
    const processingTimeInfo = {
      processingStartDateTime,
      processingEndDateTime,
    };
    const cmrTemporalInfo = {
      beginningDateTime,
      endingDateTime,
      productionDateTime,
      lastUpdateDateTime,
    };

    let executionCumulusId;
    if (execution) {
      executionCumulusId = await getExecutionCumulusId(execution, knex);
      if (executionCumulusId === undefined) {
        throw new Error(`Could not find execution in PostgreSQL database with url ${execution}`);
      }
    }

    const apiGranuleRecord = await generateGranuleApiRecord({
      granule,
      executionUrl: execution,
      collectionId,
      provider,
      timeToArchive,
      timeToPreprocess,
      timestamp,
      productVolume,
      duration,
      status,
      workflowStartTime: createdAt,
      files,
      error,
      pdrName,
      queryFields,
      processingTimeInfo,
      updatedAt,
      cmrTemporalInfo,
      cmrUtils,
    });

    const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
      apiGranuleRecord,
      knex
    );

    await _writeGranule({
      postgresGranuleRecord,
      apiGranuleRecord,
      executionCumulusId,
      knex,
      granuleModel,
      granulePgModel,
      esClient,
      snsEventType,
    });
    return `Wrote Granule ${granule.granuleId}`;
  } catch (thrownError) {
    log.error('Failed to write granule', thrownError);
    throw thrownError;
  }
};

const createGranuleFromApi = async (granule, knex, esClient) => {
  await writeGranuleFromApi(granule, knex, esClient, 'Create');
};

const updateGranuleFromApi = async (granule, knex, esClient) => {
  await writeGranuleFromApi(granule, knex, esClient, 'Update');
};

/**
 * Write granules from a cumulus message to DynamoDB and PostgreSQL
 *
 * @param {Object} params
 * @param {Object} params.cumulusMessage - A workflow message
 * @param {string} params.executionCumulusId
 *   Cumulus ID for execution referenced in workflow message, if any
 * @param {Knex} params.knex - Client to interact with PostgreSQL database
 * @param {Object} [params.granuleModel]
 *   Optional override for the granule model writing to DynamoDB
 * @param {Object} [params.granulePgModel]
 *   Optional override for the granule model writing to PostgreSQL database
 * @returns {Promise<Object[]>}
 *  true if there are no granules on the message, otherwise
 *  results from Promise.allSettled for all granules
 * @throws {Error}
 */
const writeGranulesFromMessage = async ({
  cumulusMessage,
  executionCumulusId,
  knex,
  granuleModel = new Granule(),
  granulePgModel = new GranulePgModel(),
  esClient,
}) => {
  if (!messageHasGranules(cumulusMessage)) {
    log.info('No granules to write, skipping writeGranulesFromMessage');
    return undefined;
  }

  const granules = getMessageGranules(cumulusMessage);
  const granuleIds = granules.map((granule) => granule.granuleId);
  log.info(`process granule IDs ${granuleIds.join(',')}`);

  const executionArn = getMessageExecutionArn(cumulusMessage);
  const executionUrl = getExecutionUrlFromArn(executionArn);
  const executionDescription = await granuleModel.describeGranuleExecution(executionArn);
  const processingTimeInfo = getExecutionProcessingTimeInfo(executionDescription);
  const provider = getMessageProvider(cumulusMessage);
  const workflowStartTime = getMessageWorkflowStartTime(cumulusMessage);
  const error = parseException(cumulusMessage.exception);
  const workflowStatus = getMetaStatus(cumulusMessage);
  const collectionId = getCollectionIdFromMessage(cumulusMessage);
  const pdrName = getMessagePdrName(cumulusMessage);
  const queryFields = getGranuleQueryFields(cumulusMessage);

  // Process each granule in a separate transaction via Promise.allSettled
  // so that they can succeed/fail independently
  const results = await Promise.allSettled(granules.map(
    async (granule) => {
      // compute granule specific data.
      const files = await _generateFilesFromGranule({ granule, provider });
      const timeToArchive = getGranuleTimeToArchive(granule);
      const timeToPreprocess = getGranuleTimeToPreprocess(granule);
      const productVolume = getGranuleProductVolume(files);
      const now = Date.now();
      const duration = getWorkflowDuration(workflowStartTime, now);
      const status = getGranuleStatus(workflowStatus, granule);
      const updatedAt = now;
      const timestamp = now;

      const apiGranuleRecord = await generateGranuleApiRecord({
        granule,
        executionUrl,
        collectionId,
        provider: provider.id,
        workflowStartTime,
        files,
        error,
        pdrName,
        workflowStatus,
        timestamp,
        timeToArchive,
        timeToPreprocess,
        productVolume,
        duration,
        status,
        processingTimeInfo,
        queryFields,
        updatedAt,
        cmrUtils,
      });

      const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
        apiGranuleRecord,
        knex
      );

      return _writeGranule({
        postgresGranuleRecord,
        apiGranuleRecord,
        executionCumulusId,
        knex,
        granuleModel,
        granulePgModel,
        esClient,
        snsEventType: 'Update',
      });
    }
  ));
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    const allFailures = failures.map((failure) => failure.reason);
    const aggregateError = new AggregateError(allFailures);
    log.error('Failed writing some granules to Dynamo', aggregateError);
    throw aggregateError;
  }
  return results;
};

/**
 * Update granule status to 'queued'
 *
 * @param {Object} params
 * @param {Object} params.granule - dynamo granule object
 * @param {Knex} params.knex - knex Client
 * @returns {Promise}
 * @throws {Error}
 */
const updateGranuleStatusToQueued = async (params) => {
  const {
    granule,
    knex,
    collectionPgModel = new CollectionPgModel(),
    granuleModel = new Granule(),
    granulePgModel = new GranulePgModel(),
    esClient = await Search.es(),
  } = params;
  const status = 'queued';
  const { granuleId, collectionId } = granule;
  log.info(`updateGranuleStatusToQueued granuleId: ${granuleId}, collectionId: ${collectionId}`);

  try {
    const collectionCumulusId = await collectionPgModel.getRecordCumulusId(
      knex,
      deconstructCollectionId(collectionId)
    );
    const pgGranule = await granulePgModel.get(
      knex,
      {
        granule_id: granuleId,
        collection_cumulus_id: collectionCumulusId,
      }
    );

    await _updateGranule({
      apiGranule: granule,
      postgresGranule: pgGranule,
      apiFieldUpdates: { status },
      pgFieldUpdates: { status },
      apiFieldsToDelete: ['execution'],
      granuleModel,
      granulePgModel,
      knex,
      snsEventType: 'Update',
      esClient,
    });

    log.debug(`Updated granule status to queued, Dynamo granuleId: ${granule.granuleId}, PostgreSQL cumulus_id: ${pgGranule.cumulus_id}`);
  } catch (thrownError) {
    log.error(`Failed to update granule status to queued, granuleId: ${granule.granuleId}, collectionId: ${collectionId}`, thrownError);
    throw thrownError;
  }
};

module.exports = {
  _writeGranule,
  createGranuleFromApi,
  generateFilePgRecord,
  getGranuleFromQueryResultOrLookup,
  updateGranuleFromApi,
  updateGranuleStatusToQueued,
  updateGranuleStatusToFailed,
  writeGranuleFromApi,
  writeGranulesFromMessage,
  writeGranuleRecordAndPublishSns,
};
