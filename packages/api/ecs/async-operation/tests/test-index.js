'use strict';

const test = require('ava');
const uuidv4 = require('uuid/v4');
const cryptoRandomString = require('crypto-random-string');
const DynamoDb = require('@cumulus/aws-client/DynamoDb');
const awsServices = require('@cumulus/aws-client/services');
const {
  localStackConnectionEnv,
  destroyLocalTestDb,
  generateLocalTestDb,
  AsyncOperationPgModel,
  translateApiAsyncOperationToPostgresAsyncOperation,
  migrationDir,
} = require('@cumulus/db');
// eslint-disable-next-line unicorn/import-index
const { updateAsyncOperation } = require('../index');

const testDbName = `async_operation_model_test_db_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  t.context.dynamoTableName = cryptoRandomString({ length: 10 });

  const tableHash = { name: 'id', type: 'S' };
  await DynamoDb.createAndWaitForDynamoDbTable({
    TableName: t.context.dynamoTableName,
    AttributeDefinitions: [{
      AttributeName: tableHash.name,
      AttributeType: tableHash.type,
    }],
    KeySchema: [{
      AttributeName: tableHash.name,
      KeyType: 'HASH',
    }],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  });

  process.env = { ...process.env, ...localStackConnectionEnv, PG_DATABASE: testDbName };
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  t.context.asyncOperationPgModel = new AsyncOperationPgModel();

  const dynamodbDocClient = awsServices.dynamodbDocClient({ convertEmptyValues: true });
  t.context.dynamodbDocClient = dynamodbDocClient;
});

test.beforeEach(async (t) => {
  t.context.asyncOperationId = uuidv4();

  t.context.testAsyncOperation = {
    id: t.context.asyncOperationId,
    description: 'test description',
    operationType: 'ES Index',
    status: 'RUNNING',
    createdAt: Date.now(),
  };
  t.context.testAsyncOperationPgRecord = translateApiAsyncOperationToPostgresAsyncOperation(
    t.context.testAsyncOperation
  );

  await t.context.dynamodbDocClient.put({
    TableName: t.context.dynamoTableName,
    Item: t.context.testAsyncOperation,
  }).promise();
  await t.context.asyncOperationPgModel.create(
    t.context.testKnex,
    t.context.testAsyncOperationPgRecord
  );
});

test.after.always(async (t) => {
  await DynamoDb.deleteAndWaitForDynamoDbTableNotExists({
    TableName: t.context.dynamoTableName,
  });
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('updateAsyncOperation updates databases as expected', async (t) => {
  const status = 'SUCCEEDED';
  const output = { foo: 'bar' };
  const updateTime = (Number(Date.now())).toString();
  const result = await updateAsyncOperation(
    status,
    output,
    {
      asyncOperationsTable: t.context.dynamoTableName,
      asyncOperationId: t.context.asyncOperationId,
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      updateTime,
    }
  );

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel
    .get(
      t.context.testKnex,
      {
        id: t.context.asyncOperationId,
      }
    );
  const dynamoResponse = await DynamoDb.get({
    tableName: t.context.dynamoTableName,
    item: { id: t.context.asyncOperationId },
    client: t.context.dynamodbDocClient,
    getParams: { ConsistentRead: true },
  });

  t.is(result.$response.httpResponse.statusCode, 200);
  t.like(asyncOperationPgRecord, {
    ...t.context.testAsyncOperationPgRecord,
    id: t.context.asyncOperationId,
    status,
    output,
    updated_at: new Date(Number(updateTime)),
  });
  t.deepEqual(dynamoResponse, {
    ...t.context.testAsyncOperation,
    status,
    output: JSON.stringify(output),
    updatedAt: Number(updateTime),
  });
});

test('updateAsyncOperation updates records correctly when output is undefined', async (t) => {
  const status = 'SUCCEEDED';
  const output = undefined;
  const updateTime = (Number(Date.now())).toString();
  const result = await updateAsyncOperation(
    status,
    output,
    {
      asyncOperationsTable: t.context.dynamoTableName,
      asyncOperationId: t.context.asyncOperationId,
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      updateTime,
    }
  );

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel
    .get(
      t.context.testKnex,
      {
        id: t.context.asyncOperationId,
      }
    );
  const dynamoResponse = await DynamoDb.get({
    tableName: t.context.dynamoTableName,
    item: { id: t.context.asyncOperationId },
    client: t.context.dynamodbDocClient,
    getParams: { ConsistentRead: true },
  });

  t.is(result.$response.httpResponse.statusCode, 200);
  t.like(asyncOperationPgRecord, {
    ...t.context.testAsyncOperationPgRecord,
    id: t.context.asyncOperationId,
    status,
    output: null,
    updated_at: new Date(Number(updateTime)),
  });
  t.deepEqual(dynamoResponse, {
    ...t.context.testAsyncOperation,
    status,
    updatedAt: Number(updateTime),
  });
});

test('updateAsyncOperation updates databases with correct timestamps', async (t) => {
  const status = 'SUCCEEDED';
  const output = { foo: 'bar' };
  const updateTime = (Number(Date.now())).toString();
  await updateAsyncOperation(
    status,
    output,
    {
      asyncOperationsTable: t.context.dynamoTableName,
      asyncOperationId: t.context.asyncOperationId,
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
      updateTime,
    }
  );

  const asyncOperationPgRecord = await t.context.asyncOperationPgModel
    .get(
      t.context.testKnex,
      {
        id: t.context.asyncOperationId,
      }
    );
  const dynamoResponse = await DynamoDb.get({
    tableName: t.context.dynamoTableName,
    item: { id: t.context.asyncOperationId },
    client: t.context.dynamodbDocClient,
    getParams: { ConsistentRead: true },
  });

  t.is(asyncOperationPgRecord.updated_at.getTime(), dynamoResponse.updatedAt);
  t.is(asyncOperationPgRecord.created_at.getTime(), dynamoResponse.createdAt);
});
