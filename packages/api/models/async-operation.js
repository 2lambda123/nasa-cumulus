'use strict';

const { ecs, s3 } = require('@cumulus/common/aws');
const uuidv4 = require('uuid/v4');
const cloneDeep = require('lodash.clonedeep');
const Manager = require('./base');
const { asyncOperation: asyncOperationSchema } = require('./schemas');

/**
 * A class for tracking AsyncOperations using DynamoDB.
 *
 * @class AsyncOperation
 * @extends {Manager}
 */
class AsyncOperation extends Manager {
  /**
   * Creates an instance of AsyncOperation.
   *
   * @param {Object} params - params
   * @param {string} params.stackName - the Cumulus stack name
   * @param {string} params.systemBucket - the name of the Cumulus system bucket
   * @param {string} params.tableName - the name of the AsyncOperation DynamoDB
   *   table
   * @returns {undefined} creates a new AsyncOperation object
   * @memberof AsyncOperation
   */
  constructor(params) {
    if (!params.stackName) throw new TypeError('stackName is required');
    if (!params.systemBucket) throw new TypeError('systemBucket is required');

    super({
      tableName: params.tableName,
      tableHash: { name: 'id', type: 'S' },
      schema: asyncOperationSchema
    });

    this.systemBucket = params.systemBucket;
    this.stackName = params.stackName;
  }

  /**
   * Creates one or more AsyncOperation records
   *
   * Will assign a randomly-generated ID to the item.
   *
   * @param {Object<Array|Object>} items - the Item/Items to be added to the database
   * @returns {Promise<Array|Object>} an array of created records or a single
   *   created record
   */
  async create(items = {}) {
    // This is confusing because the argument named "items" could either be
    // an Array of items  or a single item.  To make this function a little
    // easier to understand, converting the single item case here to an array
    // containing one item.
    const itemsArray = Array.isArray(items) ? items : [items];

    // Assign IDs to each of the items
    const itemsWithIds = itemsArray.map((item) => {
      const id = uuidv4();

      return Object.assign(
        cloneDeep(item),
        {
          id,
          status: 'CREATED'
        }
      );
    });

    const createdItems = await super.create(itemsWithIds);

    // If the original item was an Array, return an Array.  If the original item
    // was an Object, return an Object.
    return Array.isArray(items) ? createdItems : createdItems[0];
  }

  /**
   * Fetch the AsyncOperation with the given id
   *
   * @param {string} id - an AsyncOperation id
   * @returns {Promise<Object>} - an AsyncOperation record
   * @memberof AsyncOperation
   */
  get(id) {
    return super.get({ id });
  }

  /**
   * Update an AsyncOperation in the database
   *
   * @param {string} id - the ID of the AsyncOperation
   * @param {Object} updates - key / value pairs of fields to be updated
   * @param {Array<string>} keysToDelete - an optional list of keys to remove
   *   from the object
   * @returns {Promise<Object>} - a Promise that resolves to the object after it
   *   is updated
   * @memberof AsyncOperation
   */
  update(id, updates = {}, keysToDelete = []) {
    return super.update({ id }, updates, keysToDelete);
  }

  /**
   * Start an AsyncOperation in ECS and store its associate record to DynamoDB
   *
   * @param {Object} params - params
   * @param {string} params.id - the id of the AsyncOperation to start
   * @param {string} params.asyncOperationTaskDefinition - the name or ARN of the
   *   async-operation ECS task definition
   * @param {string} params.cluster - the name of the ECS cluster
   * @param {string} params.lambdaName - the name of the Lambda task to be run
   * @param {Object|Array} params.payload - the event to be passed to the lambda task.
   *   Must be a simple Object or Array which can be converted to JSON.
   * @returns {Promise<Object>} - an AsyncOperation record
   * @memberof AsyncOperation
   */
  async start(params) {
    const {
      asyncOperationTaskDefinition,
      cluster,
      lambdaName,
      payload
    } = params;

    // Create the record in the database
    const { id } = await this.create();

    // Store the payload to S3
    const payloadBucket = this.systemBucket;
    const payloadKey = `${this.stackName}/async-operation-payloads/${id}.json`;

    await s3().putObject({
      Bucket: payloadBucket,
      Key: payloadKey,
      Body: JSON.stringify(payload)
    }).promise();

    // Start the task in ECS
    const runTaskResponse = await ecs().runTask({
      cluster,
      taskDefinition: asyncOperationTaskDefinition,
      launchType: 'EC2',
      overrides: {
        containerOverrides: [
          {
            name: 'AsyncOperation',
            environment: [
              { name: 'asyncOperationId', value: id },
              { name: 'asyncOperationsTable', value: this.tableName },
              { name: 'lambdaName', value: lambdaName },
              { name: 'payloadUrl', value: `s3://${payloadBucket}/${payloadKey}` }
            ]
          }
        ]
      }
    }).promise();

    // TODO This should update the record in the database
    if (runTaskResponse.failures.length > 0) {
      const err = new Error(`Failed to start AsyncOperation: ${runTaskResponse.failures[0].reason}`);
      err.name = 'EcsStartTaskError';
      throw err;
    }

    // Update the database with the taskArn
    return this.update(
      id,
      {
        status: 'STARTING',
        taskArn: runTaskResponse.tasks[0].taskArn
      }
    );
  }
}
module.exports = AsyncOperation;
