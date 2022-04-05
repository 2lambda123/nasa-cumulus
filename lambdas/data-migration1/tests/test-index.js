const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const uuid = require('uuid/v4');

const AsyncOperation = require('@cumulus/api/models/async-operation');
const {
  CollectionPgModel,
  fakeCollectionRecordFactory,
} = require('@cumulus/db');
const Provider = require('@cumulus/api/models/providers');
const Rule = require('@cumulus/api/models/rules');
const KMS = require('@cumulus/aws-client/KMS');

const {
  createBucket,
  putJsonS3Object,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');

const {
  generateLocalTestDb,
  destroyLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
} = require('@cumulus/db');

const { handler } = require('../dist/lambda');
const testDbName = `data_migration_1_${cryptoRandomString({ length: 10 })}`;
const workflow = cryptoRandomString({ length: 10 });

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
    stackName: cryptoRandomString({ length: 10 }),
    system_bucket: cryptoRandomString({ length: 10 }),
    AsyncOperationsTable: cryptoRandomString({ length: 10 }),
    ProvidersTable: cryptoRandomString({ length: 10 }),
    RulesTable: cryptoRandomString({ length: 10 }),
  };

  await createBucket(process.env.system_bucket);

  const workflowfile = `${process.env.stackName}/workflows/${workflow}.json`;
  const messageTemplateKey = `${process.env.stackName}/workflow_template.json`;

  const createKeyResponse = await KMS.createKey();
  process.env.provider_kms_key_id = createKeyResponse.KeyMetadata.KeyId;

  t.context.asyncOperationsModel = new AsyncOperation({
    stackName: process.env.stackName,
    systemBucket: process.env.system_bucket,
  });
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.providersModel = new Provider();
  t.context.rulesModel = new Rule();

  await Promise.all([
    t.context.asyncOperationsModel.createTable(),
    t.context.providersModel.createTable(),
    t.context.rulesModel.createTable(),
  ]);

  await Promise.all([
    putJsonS3Object(
      process.env.system_bucket,
      messageTemplateKey,
      { meta: 'meta' }
    ),
    putJsonS3Object(
      process.env.system_bucket,
      workflowfile,
      { testworkflow: 'workflow-config' }
    ),
  ]);
  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.knex = knex;
  t.context.knexAdmin = knexAdmin;
});

test.after.always(async (t) => {
  await t.context.rulesModel.deleteTable();
  await t.context.providersModel.deleteTable();
  await t.context.asyncOperationsModel.deleteTable();

  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  await destroyLocalTestDb({
    knex: t.context.knex,
    knexAdmin: t.context.knexAdmin,
    testDbName,
  });
});

test('handler migrates async operations, providers, rules', async (t) => {
  const {
    asyncOperationsModel,
    collectionPgModel,
    providersModel,
    rulesModel,
  } = t.context;

  const fakePgCollection = fakeCollectionRecordFactory({
    name: 'fakeCollection',
    version: 'v1',
  });

  await collectionPgModel.create(
    t.context.knex,
    fakePgCollection
  );
  const fakeAsyncOperation = {
    id: uuid(),
    description: 'unittest async operation',
    operationType: 'ES Index',
    output: '{ "output": "test" }',
    status: 'SUCCEEDED',
    taskArn: 'arn:aws:ecs:task:1234',
    createdAt: (Date.now() - 1000),
    updatedAt: Date.now(),
  };

  const fakeProvider = {
    id: cryptoRandomString({ length: 10 }),
    globalConnectionLimit: 1,
    protocol: 'http',
    host: `${cryptoRandomString({ length: 10 })}host`,
    port: 80,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    username: `${cryptoRandomString({ length: 5 })}user`,
    password: `${cryptoRandomString({ length: 5 })}pass`,
    encrypted: false,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
  };

  const fakeRule = {
    name: cryptoRandomString({ length: 10 }),
    workflow: workflow,
    provider: undefined,
    state: 'DISABLED',
    collection: {
      name: fakePgCollection.name,
      version: fakePgCollection.version,
    },
    rule: { type: 'onetime', value: cryptoRandomString({ length: 10 }), arn: cryptoRandomString({ length: 10 }), logEventArn: cryptoRandomString({ length: 10 }) },
    executionNamePrefix: cryptoRandomString({ length: 10 }),
    meta: { key: 'value' },
    queueUrl: cryptoRandomString({ length: 10 }),
    payload: { result: { key: 'value' } },
    tags: ['tag1', 'tag2'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const ruleWithTrigger = await rulesModel.createRuleTrigger(fakeRule);
  await Promise.all([
    asyncOperationsModel.create(fakeAsyncOperation),
    providersModel.create(fakeProvider),
    rulesModel.create(ruleWithTrigger),
  ]);

  t.teardown(() => Promise.all([
    rulesModel.delete(fakeRule),
    providersModel.delete(fakeProvider),
    asyncOperationsModel.delete({ id: fakeAsyncOperation.id }),
  ]));

  const call = await handler({});
  const expected = {
    MigrationSummary: {
      async_operations: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
      providers: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
      rules: {
        failed: 0,
        migrated: 1,
        skipped: 0,
        total_dynamo_db_records: 1,
      },
    },
  };
  t.deepEqual(call, expected);
});
