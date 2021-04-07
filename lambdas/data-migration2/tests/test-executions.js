const omit = require('lodash/omit');
const test = require('ava');
const cryptoRandomString = require('crypto-random-string');

// Dynamo models
const Execution = require('@cumulus/api/models/executions');
const AsyncOperation = require('@cumulus/api/models/async-operation');
const Collection = require('@cumulus/api/models/collections');
const Rule = require('@cumulus/api/models/rules');

// PG models
const { CollectionPgModel, AsyncOperationPgModel, ExecutionPgModel } = require('@cumulus/db');

const { RecordAlreadyMigrated } = require('@cumulus/errors');
const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { fakeExecutionFactoryV2 } = require('@cumulus/api/lib/testUtils');
const {
  generateLocalTestDb,
  destroyLocalTestDb,
} = require('@cumulus/db');

// PG mock data factories
const {
  fakeCollectionRecordFactory,
  fakeAsyncOperationRecordFactory,
} = require('@cumulus/db/dist/test-utils');

const {
  createBucket,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');

const {
  migrateExecutionRecord,
  migrateExecutions,
} = require('../dist/lambda/executions');

let collectionsModel;
let executionsModel;
let asyncOperationsModel;
let rulesModel;

const executionOmitList = [
  'createdAt', 'updatedAt', 'finalPayload', 'originalPayload', 'parentArn', 'type', 'execution', 'name', 'collectionId', 'asyncOperationId', 'cumulusVersion',
];

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;

const assertPgExecutionMatches = (t, dynamoExecution, pgExecution, overrides = {}) => {
  t.deepEqual(
    omit(pgExecution, ['cumulus_id']),
    omit(
      {
        ...dynamoExecution,
        async_operation_cumulus_id: null,
        collection_cumulus_id: null,
        parent_cumulus_id: null,
        cumulus_version: dynamoExecution.cumulusVersion,
        url: dynamoExecution.execution,
        workflow_name: dynamoExecution.type,
        original_payload: dynamoExecution.originalPayload,
        final_payload: dynamoExecution.finalPayload,
        created_at: new Date(dynamoExecution.createdAt),
        updated_at: new Date(dynamoExecution.updatedAt),
        timestamp: new Date(dynamoExecution.timestamp),
        ...overrides,
      },
      executionOmitList
    )
  );
};

test.before(async (t) => {
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = cryptoRandomString({ length: 10 });
  process.env.ExecutionsTable = cryptoRandomString({ length: 10 });
  process.env.AsyncOperationsTable = cryptoRandomString({ length: 10 });
  process.env.CollectionsTable = cryptoRandomString({ length: 10 });
  process.env.RulesTable = cryptoRandomString({ length: 10 });

  await createBucket(process.env.system_bucket);

  executionsModel = new Execution();
  asyncOperationsModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });
  collectionsModel = new Collection();
  rulesModel = new Rule();

  t.context.executionPgModel = new ExecutionPgModel();

  await executionsModel.createTable();
  await asyncOperationsModel.createTable();
  await collectionsModel.createTable();
  await rulesModel.createTable();

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test.afterEach.always(async (t) => {
  await t.context.knex('executions').del();
  await t.context.knex('collections').del();
  await t.context.knex('async_operations').del();
});

test.after.always(async (t) => {
  await executionsModel.deleteTable();
  await asyncOperationsModel.deleteTable();
  await collectionsModel.deleteTable();
  await rulesModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test.serial('migrateExecutionRecord correctly migrates execution record', async (t) => {
  const { knex, executionPgModel } = t.context;

  // This will be the top-level execution (no parent execution)
  const fakeExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const fakeCollection = fakeCollectionRecordFactory();
  const fakeAsyncOperation = fakeAsyncOperationRecordFactory();
  const existingExecution = await executionsModel.create(fakeExecution);

  const collectionPgModel = new CollectionPgModel();
  const [collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    fakeCollection
  );

  const asyncOperationPgModel = new AsyncOperationPgModel();
  const [asyncOperationCumulusId] = await asyncOperationPgModel.create(
    t.context.knex,
    fakeAsyncOperation
  );

  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: fakeExecution.arn }),
  ]));

  // migrate the existing dynamo execution to postgres so
  // we can use it as the parent for the next execution
  await migrateExecutionRecord(existingExecution, t.context.knex);

  const existingPostgresExecution = await executionPgModel.get(
    knex,
    { arn: existingExecution.arn }
  );

  // Create new Dynamo execution to be migrated to postgres
  const newExecution = fakeExecutionFactoryV2({
    parentArn: existingExecution.arn,
    collectionId: `${fakeCollection.name}___${fakeCollection.version}`,
    asyncOperationId: fakeAsyncOperation.id,
  });

  await migrateExecutionRecord(newExecution, t.context.knex);

  const createdRecord = await executionPgModel.get(
    knex,
    { arn: newExecution.arn }
  );

  assertPgExecutionMatches(t, newExecution, createdRecord, {
    async_operation_cumulus_id: asyncOperationCumulusId,
    collection_cumulus_id: collectionCumulusId,
    parent_cumulus_id: existingPostgresExecution.cumulus_id,
  });
});

test.serial('migrateExecutionRecord throws error on invalid source data from Dynamo', async (t) => {
  const newExecution = fakeExecutionFactoryV2();

  // make source record invalid
  delete newExecution.arn;

  await t.throwsAsync(migrateExecutionRecord(newExecution, t.context.knex));
});

test.serial('migrateExecutionRecord handles nullable fields on source execution data', async (t) => {
  const { knex, executionPgModel } = t.context;

  const newExecution = fakeExecutionFactoryV2();

  // // remove nullable fields
  delete newExecution.asyncOperationId;
  delete newExecution.collectionId;
  delete newExecution.tasks;
  delete newExecution.error;
  delete newExecution.duration;
  delete newExecution.originalPayload;
  delete newExecution.finalPayload;
  delete newExecution.timestamp;
  delete newExecution.parentArn;
  delete newExecution.type;
  delete newExecution.cumulusVersion;

  await migrateExecutionRecord(newExecution, t.context.knex);

  const createdRecord = await executionPgModel.get(
    knex,
    { arn: newExecution.arn }
  );

  assertPgExecutionMatches(t, newExecution, createdRecord, {
    duration: null,
    error: null,
    final_payload: null,
    original_payload: null,
    tasks: null,
    timestamp: null,
    workflow_name: null,
    cumulus_version: null,
  });
});

test.serial('migrateExecutionRecord throws RecordAlreadyMigrated error for already migrated record', async (t) => {
  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });

  await migrateExecutionRecord(newExecution, t.context.knex);

  const olderExecution = {
    ...newExecution,
    updatedAt: Date.now() - 1000,
  };

  await t.throwsAsync(
    migrateExecutionRecord(olderExecution, t.context.knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateExecutionRecord updates an already migrated record if the updated date is newer', async (t) => {
  const { knex, executionPgModel } = t.context;

  const fakeExecution = fakeExecutionFactoryV2({
    parentArn: undefined,
    updatedAt: Date.now() - 1000,
  });
  await migrateExecutionRecord(fakeExecution, t.context.knex);

  const newerFakeExecution = {
    ...fakeExecution,
    updatedAt: Date.now(),
  };
  await migrateExecutionRecord(newerFakeExecution, t.context.knex);

  const createdRecord = await executionPgModel.get(
    knex,
    { arn: fakeExecution.arn }
  );

  assertPgExecutionMatches(t, newerFakeExecution, createdRecord);
});

test.serial('migrateExecutions skips already migrated record', async (t) => {
  const { knex, executionPgModel } = t.context;

  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });

  await migrateExecutionRecord(newExecution, t.context.knex);
  await executionsModel.create(newExecution);
  t.teardown(() => executionsModel.delete({ arn: newExecution.arn }));

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 1,
    skipped: 1,
    failed: 0,
    success: 0,
  });

  const records = await executionPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 1);
});

test.serial('migrateExecutionRecord migrates parent execution if not already migrated', async (t) => {
  const { knex, executionPgModel } = t.context;

  // This will be the child execution (no parent execution)
  const fakeExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const fakeExecution2 = fakeExecutionFactoryV2({ parentArn: fakeExecution.arn });

  const [
    parentExecution,
    childExecution,
  ] = await Promise.all([
    executionsModel.create(fakeExecution),
    executionsModel.create(fakeExecution2),
  ]);

  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: fakeExecution.arn }),
    executionsModel.delete({ arn: fakeExecution2.arn }),
  ]));

  // explicitly migrate only the child. This should also find and migrate the parent
  await migrateExecutionRecord(childExecution, t.context.knex);

  const parentPgRecord = await executionPgModel.get(
    knex,
    { arn: parentExecution.arn }
  );

  const childPgRecord = await executionPgModel.get(
    knex,
    { arn: childExecution.arn }
  );

  // Check that the parent execution was correctly migrated to Postgres
  // Check that the original (child) execution was correctly migrated to Postgres
  // The child's parent_cumulus_id should also be set
  assertPgExecutionMatches(t, parentExecution, parentPgRecord);
  assertPgExecutionMatches(
    t,
    childExecution,
    childPgRecord,
    { parent_cumulus_id: parentPgRecord.cumulus_id }
  );
});

test.serial('migrateExecutionRecord recursively migrates grandparent executions', async (t) => {
  const { knex, executionPgModel } = t.context;

  const fakeExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const fakeExecution2 = fakeExecutionFactoryV2({ parentArn: fakeExecution.arn });
  const fakeExecution3 = fakeExecutionFactoryV2({ parentArn: fakeExecution2.arn });

  const [
    grandparentExecution,
    parentExecution,
    childExecution,
  ] = await Promise.all([
    executionsModel.create(fakeExecution),
    executionsModel.create(fakeExecution2),
    executionsModel.create(fakeExecution3),
  ]);

  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: fakeExecution.arn }),
    executionsModel.delete({ arn: fakeExecution2.arn }),
    executionsModel.delete({ arn: fakeExecution3.arn }),
  ]));

  // explicitly migrate only the child. This should also find and migrate the parent and grandparent
  await migrateExecutionRecord(childExecution, t.context.knex);

  const grandparentPgRecord = await executionPgModel.get(
    knex,
    { arn: grandparentExecution.arn }
  );

  const parentPgRecord = await executionPgModel.get(
    knex,
    { arn: parentExecution.arn }
  );

  const childPgRecord = await executionPgModel.get(
    knex,
    { arn: childExecution.arn }
  );

  // Check that the grandparent execution was correctly migrated to Postgres
  // Check that the original (child) and parent executions were correctly migrated to Postgres
  // The child's parent_cumulus_id should be the parent's cumulus_id and the
  // parent's parent_cumulus_id should be the grandparent's cumulus_id
  assertPgExecutionMatches(t, grandparentExecution, grandparentPgRecord);
  assertPgExecutionMatches(
    t,
    parentExecution,
    parentPgRecord,
    { parent_cumulus_id: grandparentPgRecord.cumulus_id }
  );
  assertPgExecutionMatches(
    t,
    childExecution,
    childPgRecord,
    { parent_cumulus_id: parentPgRecord.cumulus_id }
  );
});

test.serial('child execution migration fails if parent execution cannot be migrated', async (t) => {
  const { knex, executionPgModel } = t.context;

  const parentExecution = fakeExecutionFactoryV2({
    parentArn: undefined,
    // make parent record reference to non-existent async operation
    // so that it fails to migrate
    asyncOperationId: cryptoRandomString({ length: 5 }),
  });
  const childExecution = fakeExecutionFactoryV2({ parentArn: parentExecution.arn });

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.ExecutionsTable,
      Item: parentExecution,
    }).promise(),
    executionsModel.create(childExecution),
  ]);
  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: parentExecution.arn }),
    executionsModel.delete({ arn: childExecution.arn }),
  ]));

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 2,
    success: 0,
  });
  const records = await executionPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 0);
});

test.serial('migrateExecutions processes multiple executions', async (t) => {
  const { knex, executionPgModel } = t.context;

  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const newExecution2 = fakeExecutionFactoryV2({ parentArn: undefined });

  await Promise.all([
    executionsModel.create(newExecution),
    executionsModel.create(newExecution2),
  ]);
  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: newExecution.arn }),
    executionsModel.delete({ arn: newExecution2.arn }),
  ]));

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 0,
    success: 2,
  });
  const records = await executionPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 2);
});

test.serial('migrateExecutions processes all non-failing records', async (t) => {
  const { knex, executionPgModel } = t.context;

  const newExecution = fakeExecutionFactoryV2({ parentArn: undefined });
  const newExecution2 = fakeExecutionFactoryV2({
    parentArn: undefined,
    // reference non-existent async operation so migration fails
    asyncOperationId: cryptoRandomString({ length: 5 }),
  });

  await Promise.all([
    // Have to use Dynamo client directly because creating
    // via model won't allow creation of an invalid record
    dynamodbDocClient().put({
      TableName: process.env.ExecutionsTable,
      Item: newExecution,
    }).promise(),
    executionsModel.create(newExecution2),
  ]);
  t.teardown(() => Promise.all([
    executionsModel.delete({ arn: newExecution.arn }),
    executionsModel.delete({ arn: newExecution2.arn }),
  ]));

  const migrationSummary = await migrateExecutions(process.env, t.context.knex);
  t.deepEqual(migrationSummary, {
    dynamoRecords: 2,
    skipped: 0,
    failed: 1,
    success: 1,
  });
  const records = await executionPgModel.search(
    knex,
    {}
  );
  t.is(records.length, 1);
});
