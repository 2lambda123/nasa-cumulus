'use strict';

const cloneDeep = require('lodash.clonedeep');
const get = require('lodash.get');
const isString = require('lodash.isstring');
const partial = require('lodash.partial');
const path = require('path');

const aws = require('@cumulus/ingest/aws');
const commonAws = require('@cumulus/common/aws');
const StepFunctions = require('@cumulus/common/StepFunctions');
const { CMR } = require('@cumulus/cmr-client');
const cmrjs = require('@cumulus/cmrjs');
const log = require('@cumulus/common/log');
const launchpad = require('@cumulus/common/launchpad');
const { DefaultProvider } = require('@cumulus/common/key-pair-provider');
const { buildURL } = require('@cumulus/common/URLUtils');
const { deprecate, removeNilProperties } = require('@cumulus/common/util');
const {
  generateMoveFileParams,
  moveGranuleFiles
} = require('@cumulus/ingest/granule');
const { constructCollectionId } = require('@cumulus/common');
const { isNil, renameProperty } = require('@cumulus/common/util');

const Manager = require('./base');

const { buildDatabaseFiles } = require('../lib/FileUtils');

const {
  parseException,
  deconstructCollectionId,
  getGranuleProductVolume
} = require('../lib/utils');
const Rule = require('./rules');
const granuleSchema = require('./schemas').granule;

const translateGranule = async (granule) => {
  if (isNil(granule.files)) return granule;

  return {
    ...granule,
    files: await buildDatabaseFiles({ files: granule.files })
  };
};

class GranuleSearchQueue extends commonAws.DynamoDbSearchQueue {
  peek() {
    return super.peek().then((g) => (isNil(g) ? g : translateGranule(g)));
  }

  shift() {
    return super.shift().then((g) => (isNil(g) ? g : translateGranule(g)));
  }
}

class Granule extends Manager {
  constructor() {
    const globalSecondaryIndexes = [{
      IndexName: 'collectionId-granuleId-index',
      KeySchema: [
        {
          AttributeName: 'collectionId',
          KeyType: 'HASH'
        },
        {
          AttributeName: 'granuleId',
          KeyType: 'RANGE'
        }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 10
      }
    }];

    super({
      tableName: process.env.GranulesTable,
      tableHash: { name: 'granuleId', type: 'S' },
      tableAttributes: [{ name: 'collectionId', type: 'S' }],
      tableIndexes: { GlobalSecondaryIndexes: globalSecondaryIndexes },
      schema: granuleSchema
    });
  }

  async get(...args) {
    return translateGranule(await super.get(...args));
  }

  async batchGet(...args) {
    const result = cloneDeep(await super.batchGet(...args));

    result.Responses[this.tableName] = await Promise.all(
      result.Responses[this.tableName].map(translateGranule)
    );

    return result;
  }

  async scan(...args) {
    const scanResponse = await super.scan(...args);

    if (scanResponse.Items) {
      return {
        ...scanResponse,
        Items: await Promise.all(scanResponse.Items.map(translateGranule))
      };
    }

    return scanResponse;
  }

  async removeGranuleFromCmrByGranule(granule) {
    log.info(`granules.removeGranuleFromCmrByGranule ${granule.granuleId}`);

    if (!granule.published || !granule.cmrLink) {
      throw new Error(`Granule ${granule.granuleId} is not published to CMR, so cannot be removed from CMR`);
    }

    const params = {
      provider: process.env.cmr_provider,
      clientId: process.env.cmr_client_id
    };

    if (process.env.cmr_oauth_provider === 'launchpad') {
      const config = {
        api: process.env.launchpad_api,
        passphrase: process.env.launchpad_passphrase,
        certificate: process.env.launchpad_certificate
      };
      const token = await launchpad.getLaunchpadToken(config);
      params.token = token;
    } else {
      const password = await DefaultProvider.decrypt(process.env.cmr_password);
      params.username = process.env.cmr_username;
      params.password = password;
    }

    const cmr = new CMR(params);
    const metadata = await cmrjs.getMetadata(granule.cmrLink);

    // Use granule UR to delete from CMR
    await cmr.deleteGranule(metadata.title, granule.collectionId);
    await this.update({ granuleId: granule.granuleId }, { published: false }, ['cmrLink']);
  }

  /**
   * Removes a given granule from CMR
   *
   * @param {string} granuleId - the granule ID
   * @param {string} collectionId - the collection ID
   * @returns {Promise<undefined>} - undefined
   */
  // eslint-disable-next-line no-unused-vars
  async removeGranuleFromCmr(granuleId, collectionId) {
    deprecate('@cumulus/api/Granule.removeGranuleFromCmr', '1.11.3', '@cumulus/api/Granule.removeGranuleFromCmrByGranule');

    const granule = await this.get({ granuleId });

    return this.removeGranuleFromCmrByGranule(granule);
  }

  /**
   * start the re-ingest of a given granule object
   *
   * @param {Object} granule - the granule object
   * @returns {Promise<undefined>} - undefined
   */
  async reingest(granule) {
    const executionArn = path.basename(granule.execution);

    const executionDescription = await StepFunctions.describeExecution({ executionArn });
    const originalMessage = JSON.parse(executionDescription.input);

    const { name, version } = deconstructCollectionId(granule.collectionId);

    const lambdaPayload = await Rule.buildPayload({
      workflow: originalMessage.meta.workflow_name,
      meta: originalMessage.meta,
      cumulus_meta: {
        cumulus_context: {
          reingestGranule: true,
          forceDuplicateOverwrite: true
        }
      },
      payload: originalMessage.payload,
      provider: granule.provider,
      collection: {
        name,
        version
      },
      queueName: granule.queueName
    });

    await this.updateStatus({ granuleId: granule.granuleId }, 'running');

    return aws.invoke(process.env.invoke, lambdaPayload);
  }

  /**
   * apply a workflow to a given granule object
   *
   * @param {Object} g - the granule object
   * @param {string} workflow - the workflow name
   * @returns {Promise<undefined>} undefined
   */
  async applyWorkflow(g, workflow) {
    const { name, version } = deconstructCollectionId(g.collectionId);

    const lambdaPayload = await Rule.buildPayload({
      workflow,
      payload: {
        granules: [g]
      },
      provider: g.provider,
      collection: {
        name,
        version
      }
    });

    await this.updateStatus({ granuleId: g.granuleId }, 'running');

    await aws.invoke(process.env.invoke, lambdaPayload);
  }

  /**
   * Move a granule's files to destinations specified
   *
   * @param {Object} g - the granule record object
   * @param {Array<{regex: string, bucket: string, filepath: string}>} destinations
   *    - list of destinations specified
   *    regex - regex for matching filepath of file to new destination
   *    bucket - aws bucket of the destination
   *    filepath - file path/directory on the bucket for the destination
   * @param {string} distEndpoint - distribution endpoint URL
   * @returns {Promise<undefined>} undefined
   */
  async move(g, destinations, distEndpoint) {
    log.info(`granules.move ${g.granuleId}`);

    const updatedFiles = await moveGranuleFiles(g.files, destinations);

    await cmrjs.reconcileCMRMetadata({
      granuleId: g.granuleId,
      updatedFiles,
      distEndpoint,
      published: g.published
    });

    return this.update(
      { granuleId: g.granuleId },
      {
        files: updatedFiles.map(partial(renameProperty, 'name', 'fileName'))
      }
    );
  }

  /**
   * With the params for moving a granule, return the files that already exist at
   * the move location
   *
   * @param {Object} granule - the granule object
   * @param {Array<{regex: string, bucket: string, filepath: string}>} destinations
   * - list of destinations specified
   *    regex - regex for matching filepath of file to new destination
   *    bucket - aws bucket of the destination
   *    filepath - file path/directory on the bucket for the destination
   * @returns {Promise<Array<Object>>} - promise that resolves to a list of files
   * that already exist at the destination that they would be written to if they
   * were to be moved via the move granules call
   */
  async getFilesExistingAtLocation(granule, destinations) {
    const moveFileParams = generateMoveFileParams(granule.files, destinations);

    const fileExistsPromises = moveFileParams.map(async (moveFileParam) => {
      const { target, file } = moveFileParam;
      if (target) {
        const exists = await commonAws.fileExists(target.Bucket, target.Key);

        if (exists) {
          return Promise.resolve(file);
        }
      }

      return Promise.resolve();
    });

    const existingFiles = await Promise.all(fileExistsPromises);

    return existingFiles.filter((file) => file);
  }

  /**
   * Create new granule records from incoming sns messages
   *
   * @param {Object} cumulusMessage - a Cumulus Message
   * @returns {Promise<Array>} granule records
   */
  async createGranulesFromSns(cumulusMessage) {
    const granules = get(cumulusMessage, 'payload.granules')
      || get(cumulusMessage, 'meta.input_granules');

    if (!granules) return null;

    const executionName = get(cumulusMessage, 'cumulus_meta.execution_name');
    if (!isString(executionName)) return null;

    const stateMachine = get(cumulusMessage, 'cumulus_meta.state_machine');
    if (!isString(stateMachine)) return null;

    const executionArn = commonAws.getExecutionArn(stateMachine, executionName);
    const executionUrl = aws.getExecutionUrl(executionArn);
    const executionDescription = await StepFunctions.describeExecution({ executionArn });

    const collection = get(cumulusMessage, 'meta.collection');

    return Promise.all(
      granules
        .filter((g) => g.granuleId)
        .map(async (granule) => {
          const granuleFiles = await buildDatabaseFiles({
            providerURL: buildURL({
              protocol: cumulusMessage.meta.provider.protocol,
              host: cumulusMessage.meta.provider.host,
              port: cumulusMessage.meta.provider.port
            }),
            files: granule.files
          });

          const temporalInfo = await cmrjs.getGranuleTemporalInfo(granule);

          const doc = {
            granuleId: granule.granuleId,
            pdrName: get(cumulusMessage, 'meta.pdr.name'),
            collectionId: constructCollectionId(collection.name, collection.version),
            status: get(cumulusMessage, 'meta.status', get(granule, 'status')),
            provider: get(cumulusMessage, 'meta.provider.id'),
            execution: executionUrl,
            cmrLink: granule.cmrLink,
            files: granuleFiles,
            error: parseException(cumulusMessage.exception),
            createdAt: get(cumulusMessage, 'cumulus_meta.workflow_start_time'),
            timestamp: Date.now(),
            productVolume: getGranuleProductVolume(granuleFiles),
            timeToPreprocess: get(granule, 'sync_granule_duration', 0) / 1000,
            timeToArchive: get(granule, 'post_to_cmr_duration', 0) / 1000,
            processingStartDateTime: executionDescription.startDate.toISOString(),
            processingEndDateTime: executionDescription.stopDate
              ? executionDescription.stopDate.toISOString() : new Date().toISOString(),
            ...temporalInfo
          };

          doc.published = get(granule, 'published', false);
          // Duration is also used as timeToXfer for the EMS report
          doc.duration = (doc.timestamp - doc.createdAt) / 1000;

          return this.create(removeNilProperties(doc));
        })
    );
  }

  /**
   * return the queue of the granules for a given collection,
   * the items are ordered by granuleId
   *
   * @param {string} collectionId - collection id
   * @param {string} status - granule status, optional
   * @returns {Array<Object>} the granules' queue for a given collection
   */
  getGranulesForCollection(collectionId, status) {
    const params = {
      TableName: this.tableName,
      IndexName: 'collectionId-granuleId-index',
      ExpressionAttributeNames: {
        '#collectionId': 'collectionId',
        '#granuleId': 'granuleId',
        '#files': 'files',
        '#published': 'published',
        '#createdAt': 'createdAt'
      },
      ExpressionAttributeValues: { ':collectionId': collectionId },
      KeyConditionExpression: '#collectionId = :collectionId',
      ProjectionExpression: '#granuleId, #collectionId, #files, #published, #createdAt'
    };

    // add status filter
    if (status) {
      params.ExpressionAttributeNames['#status'] = 'status';
      params.ExpressionAttributeValues[':status'] = status;
      params.FilterExpression = '#status = :status';
    }

    return new GranuleSearchQueue(params, 'query');
  }

  granuleAttributeScan() {
    const params = {
      TableName: this.tableName,
      ExpressionAttributeNames:
        {
          '#granuleId': 'granuleId',
          '#collectionId': 'collectionId',
          '#beginningDateTime': 'beginningDateTime',
          '#endingDateTime': 'endingDateTime',
          '#createdAt': 'createdAt'
        },
      ProjectionExpression: '#granuleId, #collectionId, #createdAt, #beginningDateTime, #endingDateTime'
    };

    return new GranuleSearchQueue(params);
  }

  /**
   * Only used for tests
   */
  async deleteGranules() {
    const granules = await this.scan();
    return Promise.all(granules.Items.map((granule) =>
      super.delete({ granuleId: granule.granuleId })));
  }
}

module.exports = Granule;
