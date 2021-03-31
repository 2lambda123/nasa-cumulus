'use strict';

const fs = require('fs-extra');
const path = require('path');
const test = require('ava');
const { toCamel } = require('snake-camel');
const cryptoRandomString = require('crypto-random-string');
const uuidv4 = require('uuid/v4');

const {
  localStackConnectionEnv,
  getKnexClient,
  ExecutionPgModel,
  GranulePgModel,
  PdrPgModel,
  tableNames,
  doesRecordExist,
} = require('@cumulus/db');
const {
  MissingRequiredEnvVarError,
} = require('@cumulus/errors');
const proxyquire = require('proxyquire');

const { randomString } = require('@cumulus/common/test-utils');
const Execution = require('../../../models/executions');
const Granule = require('../../../models/granules');
const Pdr = require('../../../models/pdrs');

const { migrationDir } = require('../../../../../lambdas/db-migration');

const {
  handler,
  writeRecords,
} = proxyquire('../../../lambdas/sf-event-sqs-to-db-records', {
  '@cumulus/aws-client/SQS': {
    sendSQSMessage: async (queue, message) => [queue, message],
  },
  '@cumulus/aws-client/StepFunctions': {
    describeExecution: async () => ({}),
  },
});

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');

const loadFixture = (filename) =>
  fs.readJson(
    path.join(
      __dirname,
      '..',
      'fixtures',
      'sf-event-sqs-to-db-records',
      filename
    )
  );

let fixture;

const runHandler = async ({
  cumulusMessage = {},
  stateMachineArn,
  executionArn,
  executionName,
  testDbName,
  ...additionalParams
}) => {
  fixture.resources = [executionArn];
  fixture.detail.executionArn = executionArn;
  fixture.detail.stateMachineArn = stateMachineArn;
  fixture.detail.name = executionName;

  fixture.detail.input = JSON.stringify(cumulusMessage);

  const sqsEvent = {
    ...additionalParams,
    Records: [{
      eventSource: 'aws:sqs',
      body: JSON.stringify(fixture),
    }],
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: testDbName,
    },
  };
  const handlerResponse = await handler(sqsEvent);
  return { executionArn, handlerResponse, sqsEvent };
};

const generateRDSCollectionRecord = (params) => ({
  name: `${cryptoRandomString({ length: 10 })}collection`,
  version: '0.0.0',
  duplicate_handling: 'replace',
  granule_id_validation_regex: '^MOD09GQ\\.A[\\d]{7}\.[\\S]{6}\\.006\\.[\\d]{13}$',
  granule_id_extraction_regex: '(MOD09GQ\\.(.*))\\.hdf',
  sample_file_name: 'MOD09GQ.A2017025.h21v00.006.2017034065104.hdf',
  files: JSON.stringify([{ regex: '^.*\\.txt$', sampleFileName: 'file.txt', bucket: 'bucket' }]),
  created_at: new Date(),
  updated_at: new Date(),
  ...params,
});

test.before(async (t) => {
  process.env.ExecutionsTable = randomString();
  process.env.GranulesTable = randomString();
  process.env.PdrsTable = randomString();

  const executionModel = new Execution();
  await executionModel.createTable();
  t.context.executionModel = executionModel;

  const fakeFileUtils = {
    buildDatabaseFiles: async (params) => params.files,
  };
  const fakeStepFunctionUtils = {
    describeExecution: async () => ({}),
  };
  const granuleModel = new Granule({
    fileUtils: fakeFileUtils,
    stepFunctionUtils: fakeStepFunctionUtils,
  });
  await granuleModel.createTable();
  t.context.granuleModel = granuleModel;

  const pdrModel = new Pdr();
  await pdrModel.createTable();
  t.context.pdrModel = pdrModel;

  t.context.testDbName = `sfEventSqsToDbRecords_${cryptoRandomString({ length: 10 })}`;

  t.context.knexAdmin = await getKnexClient({ env: localStackConnectionEnv });
  await t.context.knexAdmin.raw(`create database "${t.context.testDbName}";`);
  await t.context.knexAdmin.raw(`grant all privileges on database "${t.context.testDbName}" to "${localStackConnectionEnv.PG_USER}"`);

  t.context.knex = await getKnexClient({
    env: {
      ...localStackConnectionEnv,
      PG_DATABASE: t.context.testDbName,
      migrationDir,
    },
  });
  await t.context.knex.migrate.latest();

  fixture = await loadFixture('execution-running-event.json');
});

test.beforeEach(async (t) => {
  process.env.RDS_DEPLOYMENT_CUMULUS_VERSION = '3.0.0';
  t.context.postRDSDeploymentVersion = '4.0.0';
  t.context.preRDSDeploymentVersion = '2.9.99';

  t.context.collection = generateRDSCollectionRecord();

  const stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:${fixture.region}:${fixture.account}:stateMachine:${stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:${fixture.region}:${fixture.account}:execution:${stateMachineName}:${t.context.executionName}`;

  t.context.provider = {
    id: `provider${cryptoRandomString({ length: 5 })}`,
    host: 'test-bucket',
    protocol: 's3',
  };

  t.context.pdrName = cryptoRandomString({ length: 10 });
  t.context.pdr = {
    name: t.context.pdrName,
    PANSent: false,
    PANmessage: 'test',
  };

  t.context.granuleId = cryptoRandomString({ length: 10 });
  const files = [fakeFileFactory()];
  const granule = fakeGranuleFactoryV2({ files, granuleId: t.context.granuleId });

  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
      cumulus_version: t.context.postRDSDeploymentVersion,
      state_machine: t.context.stateMachineArn,
      execution_name: t.context.executionName,
    },
    meta: {
      status: 'running',
      collection: toCamel(t.context.collection),
      provider: t.context.provider,
    },
    payload: {
      key: 'my-payload',
      pdr: t.context.pdr,
      granules: [granule],
    },
  };

  const collectionResponse = await t.context.knex(tableNames.collections)
    .insert(t.context.collection)
    .returning('cumulus_id');
  t.context.collectionCumulusId = collectionResponse[0];

  const providerResponse = await t.context.knex(tableNames.providers)
    .insert({
      name: t.context.provider.id,
      host: t.context.provider.host,
      protocol: t.context.provider.protocol,
    })
    .returning('cumulus_id');
  t.context.providerCumulusId = providerResponse[0];
});

test.after.always(async (t) => {
  const {
    executionModel,
    pdrModel,
    granuleModel,
  } = t.context;
  await executionModel.deleteTable();
  await pdrModel.deleteTable();
  await granuleModel.deleteTable();
  await t.context.knex.destroy();
  await t.context.knexAdmin.raw(`drop database if exists "${t.context.testDbName}"`);
  await t.context.knexAdmin.destroy();
});

test('writeRecords() writes records only to Dynamo if message comes from pre-RDS deployment', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionModel,
    pdrModel,
    granuleModel,
    preRDSDeploymentVersion,
    executionArn,
    pdrName,
    granuleId,
  } = t.context;

  cumulusMessage.cumulus_meta.cumulus_version = preRDSDeploymentVersion;

  await writeRecords({
    cumulusMessage,
    knex,
    granuleModel,
  });

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));

  t.false(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
  t.false(
    await doesRecordExist({
      name: pdrName,
    }, knex, tableNames.pdrs)
  );
  t.false(
    await doesRecordExist({
      granule_id: granuleId,
    }, knex, tableNames.granules)
  );
});

test.serial('writeRecords() throws error if RDS_DEPLOYMENT_CUMULUS_VERSION env var is missing', async (t) => {
  delete process.env.RDS_DEPLOYMENT_CUMULUS_VERSION;
  const {
    cumulusMessage,
    knex,
  } = t.context;

  await t.throwsAsync(
    writeRecords({
      cumulusMessage,
      knex,
    }),
    { instanceOf: MissingRequiredEnvVarError }
  );
});

test('writeRecords() writes records only to Dynamo if requirements to write execution to Postgres are not met', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
    knex,
    executionArn,
    pdrName,
    granuleId,
  } = t.context;

  // add reference in message to object that doesn't exist
  cumulusMessage.cumulus_meta.asyncOperationId = uuidv4();

  await writeRecords({
    cumulusMessage,
    knex,
    granuleModel,
  });

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));

  t.false(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
  t.false(
    await doesRecordExist({
      name: pdrName,
    }, knex, tableNames.pdrs)
  );
  t.false(
    await doesRecordExist({
      granule_id: granuleId,
    }, knex, tableNames.granules)
  );
});

test('writeRecords() does not write granules/PDR if writeExecution() throws general error', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
    knex,
    executionArn,
    pdrName,
    granuleId,
  } = t.context;

  delete cumulusMessage.meta.status;

  await t.throwsAsync(writeRecords({
    cumulusMessage,
    knex,
    granuleModel,
  }));

  t.false(await executionModel.exists({ arn: executionArn }));
  t.false(await pdrModel.exists({ pdrName }));
  t.false(await granuleModel.exists({ granuleId }));

  t.false(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
  t.false(
    await doesRecordExist({
      name: pdrName,
    }, knex, tableNames.pdrs)
  );
  t.false(
    await doesRecordExist({
      granule_id: granuleId,
    }, knex, tableNames.granules)
  );
});

test('writeRecords() writes records to Dynamo and RDS', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
    knex,
    executionArn,
    pdrName,
    granuleId,
  } = t.context;

  await writeRecords({ cumulusMessage, knex, granuleModel });

  t.true(await executionModel.exists({ arn: executionArn }));
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await pdrModel.exists({ pdrName }));

  t.true(
    await doesRecordExist({
      arn: executionArn,
    }, knex, tableNames.executions)
  );
  t.true(
    await doesRecordExist({
      name: pdrName,
    }, knex, tableNames.pdrs)
  );
  t.true(
    await doesRecordExist({
      granule_id: granuleId,
    }, knex, tableNames.granules)
  );
});

test('Lambda sends message to DLQ when writeRecords() throws an error', async (t) => {
  // make execution write throw an error
  const fakeExecutionModel = {
    storeExecutionFromCumulusMessage: () => {
      throw new Error('execution Dynamo error');
    },
  };

  const {
    handlerResponse,
    sqsEvent,
  } = await runHandler({
    ...t.context,
    executionModel: fakeExecutionModel,
  });

  t.is(handlerResponse[0][1].body, sqsEvent.Records[0].body);
});

test('writeRecords() discards an out of order message that is older than an existing message without error or write', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    pdrModel,
    knex,
    pdrName,
    granuleId,
  } = t.context;

  const pdrPgModel = new PdrPgModel();
  const granulePgModel = new GranulePgModel();

  const timestamp = Date.now();
  const olderTimestamp = timestamp - 10000;

  cumulusMessage.cumulus_meta.workflow_start_time = timestamp;
  await writeRecords({ cumulusMessage, knex, granuleModel });

  cumulusMessage.cumulus_meta.workflow_start_time = olderTimestamp;
  await t.notThrowsAsync(writeRecords({ cumulusMessage, knex, granuleModel }));

  t.is(timestamp, (await granuleModel.get({ granuleId })).createdAt);
  t.is(timestamp, (await pdrModel.get({ pdrName })).createdAt);

  t.deepEqual(
    new Date(timestamp),
    (await granulePgModel.get(knex, { granule_id: granuleId })).created_at
  );
  t.deepEqual(
    new Date(timestamp),
    (await pdrPgModel.get(knex, { name: pdrName })).created_at
  );
});

test('writeRecords() discards an out of order message that has an older status without error or write', async (t) => {
  const {
    cumulusMessage,
    executionModel,
    granuleModel,
    pdrModel,
    knex,
    executionArn,
    pdrName,
    granuleId,
  } = t.context;

  const executionPgModel = new ExecutionPgModel();
  const pdrPgModel = new PdrPgModel();
  const granulePgModel = new GranulePgModel();

  cumulusMessage.meta.status = 'completed';
  await writeRecords({ cumulusMessage, knex, granuleModel });

  cumulusMessage.meta.status = 'running';
  await t.notThrowsAsync(writeRecords({ cumulusMessage, knex, granuleModel }));

  t.is('completed', (await executionModel.get({ arn: executionArn })).status);
  t.is('completed', (await granuleModel.get({ granuleId })).status);
  t.is('completed', (await pdrModel.get({ pdrName })).status);

  t.is('completed', (await executionPgModel.get(knex, { arn: executionArn })).status);
  t.is('completed', (await granulePgModel.get(knex, { granule_id: granuleId })).status);
  t.is('completed', (await pdrPgModel.get(knex, { name: pdrName })).status);
});
