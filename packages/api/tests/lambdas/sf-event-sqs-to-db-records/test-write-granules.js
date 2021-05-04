'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');

const {
  CollectionPgModel,
  ProviderPgModel,
  ExecutionPgModel,
  GranulePgModel,
  FilePgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  tableNames,
} = require('@cumulus/db');

const {
  generateFilePgRecord,
  generateGranuleRecord,
  getGranuleCumulusIdFromQueryResultOrLookup,
  writeFilesViaTransaction,
  writeGranules,
} = require('../../../lambdas/sf-event-sqs-to-db-records/write-granules');

const { migrationDir } = require('../../../../../lambdas/db-migration');

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');
const Granule = require('../../../models/granules');

test.before(async (t) => {
  process.env.GranulesTable = cryptoRandomString({ length: 10 });

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

  t.context.granulePgModel = new GranulePgModel();
  t.context.filePgModel = new FilePgModel();

  t.context.testDbName = `writeGranules_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  t.context.granulePgModel = new GranulePgModel();
});

test.beforeEach(async (t) => {
  const stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:us-east-1:12345:stateMachine:${stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${t.context.executionName}`;

  t.context.collection = fakeCollectionRecordFactory();
  t.context.provider = fakeProviderRecordFactory();

  t.context.granuleId = cryptoRandomString({ length: 10 });
  t.context.files = [fakeFileFactory({ size: 5 })];
  t.context.granule = fakeGranuleFactoryV2({
    files: t.context.files,
    granuleId: t.context.granuleId,
  });

  t.context.workflowStartTime = Date.now();
  t.context.cumulusMessage = {
    cumulus_meta: {
      workflow_start_time: t.context.workflowStartTime,
      state_machine: t.context.stateMachineArn,
      execution_name: t.context.executionName,
    },
    meta: {
      status: 'running',
      collection: t.context.collection,
      provider: t.context.provider,
    },
    payload: {
      granules: [t.context.granule],
    },
  };

  const collectionPgModel = new CollectionPgModel();
  [t.context.collectionCumulusId] = await collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );

  const executionPgModel = new ExecutionPgModel();
  const execution = fakeExecutionRecordFactory({
    arn: t.context.executionArn,
  });
  [t.context.executionCumulusId] = await executionPgModel.create(
    t.context.knex,
    execution
  );

  const providerPgModel = new ProviderPgModel();
  [t.context.providerCumulusId] = await providerPgModel.create(
    t.context.knex,
    t.context.provider
  );
});

test.afterEach.always(async (t) => {
  await t.context.knex(tableNames.files).del();
  await t.context.knex(tableNames.granulesExecutions).del();
  await t.context.knex(tableNames.granules).del();
});

test.after.always(async (t) => {
  const {
    granuleModel,
  } = t.context;
  await granuleModel.deleteTable();
  await destroyLocalTestDb({
    ...t.context,
  });
});

test('generateGranuleRecord() generates the correct granule record', async (t) => {
  const {
    granuleId,
    granule,
    workflowStartTime,
  } = t.context;

  const timestamp = workflowStartTime + 5000;
  const updatedAt = Date.now();
  // Set granule files
  const files = [
    fakeFileFactory({
      size: 10,
    }),
  ];
  granule.sync_granule_duration = 3000;
  granule.post_to_cmr_duration = 7810;
  const queryFields = { foo: 'bar' };

  t.like(
    await generateGranuleRecord({
      granule,
      files,
      workflowStartTime,
      workflowStatus: 'running',
      collectionCumulusId: 1,
      providerCumulusId: 2,
      pdrCumulusId: 4,
      timestamp,
      updatedAt,
      queryFields,
    }),
    {
      granule_id: granuleId,
      status: 'running',
      cmr_link: granule.cmrLink,
      published: granule.published,
      created_at: new Date(workflowStartTime),
      timestamp: new Date(timestamp),
      updated_at: new Date(updatedAt),
      product_volume: 10,
      duration: 5,
      time_to_process: 3,
      time_to_archive: 7.81,
      collection_cumulus_id: 1,
      provider_cumulus_id: 2,
      pdr_cumulus_id: 4,
      query_fields: queryFields,
    }
  );
});

test('generateGranuleRecord() includes processing time info, if provided', async (t) => {
  const {
    cumulusMessage,
    granule,
  } = t.context;

  const processingTimeInfo = {
    processingStartDateTime: new Date().toISOString(),
    processingEndDateTime: new Date().toISOString(),
  };

  const record = await generateGranuleRecord({
    cumulusMessage,
    granule,
    processingTimeInfo,
  });
  t.is(record.processing_start_date_time, processingTimeInfo.processingStartDateTime);
  t.is(record.processing_end_date_time, processingTimeInfo.processingEndDateTime);
});

test('generateGranuleRecord() includes temporal info, if any is returned', async (t) => {
  const {
    cumulusMessage,
    granule,
  } = t.context;

  const temporalInfo = {
    beginningDateTime: new Date().toISOString(),
  };

  const fakeCmrUtils = {
    getGranuleTemporalInfo: async () => temporalInfo,
  };

  const record = await generateGranuleRecord({
    cumulusMessage,
    granule,
    cmrUtils: fakeCmrUtils,
  });
  t.is(record.beginning_date_time, temporalInfo.beginningDateTime);
});

test('generateGranuleRecord() includes correct error if cumulus message has an exception', async (t) => {
  const {
    granule,
  } = t.context;

  const exception = {
    Error: new Error('error'),
    Cause: 'an error occurred',
  };

  const record = await generateGranuleRecord({
    granule,
    error: exception,
  });
  t.deepEqual(record.error, exception);
});

test('generateFilePgRecord() adds granule cumulus ID', (t) => {
  const file = {
    bucket: cryptoRandomString({ length: 3 }),
    key: cryptoRandomString({ length: 3 }),
  };
  const record = generateFilePgRecord({ file, granuleCumulusId: 1 });
  t.is(record.granule_cumulus_id, 1);
});

test('getGranuleCumulusIdFromQueryResultOrLookup() returns cumulus ID from database if query result is empty', async (t) => {
  const granuleRecord = fakeGranuleRecordFactory();
  const fakeGranuleCumulusId = Math.floor(Math.random() * 1000);
  const fakeGranulePgModel = {
    getRecordCumulusId: async (_, record) => {
      if (record.granule_id === granuleRecord.granule_id) {
        return fakeGranuleCumulusId;
      }
      return undefined;
    },
  };

  t.is(
    await getGranuleCumulusIdFromQueryResultOrLookup({
      trx: {},
      queryResult: [],
      granuleRecord,
      granulePgModel: fakeGranulePgModel,
    }),
    fakeGranuleCumulusId
  );
});

test('writeFilesViaTransaction() throws error if any writes fail', async (t) => {
  const { knex } = t.context;

  const fileRecords = [
    fakeFileRecordFactory(),
    fakeFileRecordFactory(),
  ];

  const fakeFilePgModel = {
    upsert: sinon.stub()
      .onCall(0)
      .resolves()
      .onCall(1)
      .throws(),
  };

  await t.throwsAsync(
    knex.transaction(
      (trx) =>
        writeFilesViaTransaction({
          fileRecords,
          trx,
          filePgModel: fakeFilePgModel,
        })
    )
  );
});

test.serial('writeGranules() throws an error if collection is not provided', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
  } = t.context;
  await t.throwsAsync(
    writeGranules({
      cumulusMessage,
      collectionCumulusId: undefined,
      executionCumulusId,
      providerCumulusId,
      knex,
      granuleModel,
    })
  );
});

test.serial('writeGranules() saves granule records to Dynamo and Postgres if Postgres write is enabled', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await t.context.granulePgModel.exists(knex, { granule_id: granuleId }));
});

test.serial('writeGranules() saves granule records to Dynamo and Postgres with same timestamps', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoRecord = await granuleModel.get({ granuleId });
  const pgRecord = await t.context.granulePgModel.get(knex, { granule_id: granuleId });
  t.is(pgRecord.created_at.getTime(), dynamoRecord.createdAt);
  t.is(pgRecord.updated_at.getTime(), dynamoRecord.updatedAt);
});

test.serial('writeGranules() saves file records to Postgres if Postgres write is enabled and workflow status is "completed"', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    filePgModel,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
    providerCumulusId,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const granule = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.true(
    await filePgModel.exists(knex, { granule_cumulus_id: granule.cumulus_id })
  );
});

test.serial('writeGranules() does not persist file records to Postgres if the worflow status is "running"', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    executionCumulusId,
    filePgModel,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
    providerCumulusId,
  } = t.context;

  cumulusMessage.meta.status = 'running';

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const granule = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.false(
    await filePgModel.exists(knex, { granule_cumulus_id: granule.cumulus_id })
  );
});

test.serial('writeGranules() handles successful and failing writes independently', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const granule2 = {
    // no granule ID should cause failure
  };
  cumulusMessage.payload.granules = [
    ...cumulusMessage.payload.granules,
    granule2,
  ];

  await t.throwsAsync(writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));

  t.true(await granuleModel.exists({ granuleId }));
  t.true(
    await t.context.granulePgModel.exists(knex, { granule_id: granuleId })
  );
});

test.serial('writeGranules() throws error if any granule writes fail', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
  } = t.context;

  cumulusMessage.payload.granules = [
    ...cumulusMessage.payload.granules,
    // this object is not a valid granule, so its write should fail
    {},
  ];

  await t.throwsAsync(writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));
});

test.serial('writeGranules() does not persist records to Dynamo or Postgres if Dynamo write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const fakeGranuleModel = {
    storeGranuleFromCumulusMessage: () => {
      throw new Error('Granules dynamo error');
    },
    describeGranuleExecution: async () => ({}),
  };

  const [error] = await t.throwsAsync(
    writeGranules({
      cumulusMessage,
      collectionCumulusId,
      executionCumulusId,
      providerCumulusId,
      knex,
      granuleModel: fakeGranuleModel,
    })
  );

  t.true(error.message.includes('Granules dynamo error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await t.context.granulePgModel.exists(knex, { granule_id: granuleId })
  );
});

test.serial('writeGranules() does not persist records to Dynamo or Postgres if Postgres write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const fakeTrxCallback = (cb) => {
    const fakeTrx = sinon.stub().returns({
      insert: () => {
        throw new Error('Granules Postgres error');
      },
    });
    return cb(fakeTrx);
  };
  const trxStub = sinon.stub(knex, 'transaction').callsFake(fakeTrxCallback);
  t.teardown(() => trxStub.restore());

  const [error] = await t.throwsAsync(writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));

  t.true(error.message.includes('Granules Postgres error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await t.context.granulePgModel.exists(knex, { granule_id: granuleId })
  );
});

test.serial('writeGranules() writes a granule and marks as failed if any file writes fail', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
    granuleId,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  cumulusMessage.payload.granules[0].files[0].bucket = undefined;
  cumulusMessage.payload.granules[0].files[0].key = undefined;

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoGranule = await granuleModel.get({ granuleId });
  t.is(dynamoGranule.status, 'failed');
  t.deepEqual(dynamoGranule.error.Error, 'Failed writing files to Postgres.');

  const pgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(pgGranule.status, 'failed');
  t.deepEqual(pgGranule.error.Error, 'Failed writing files to Postgres.');
});

test.serial('writeGranules() writes all valid files if any non-valid file fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
    filePgModel,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  const invalidFiles = [
    fakeFileFactory({ bucket: undefined }),
    fakeFileFactory({ bucket: undefined }),
  ];

  const existingFiles = cumulusMessage.payload.granules[0].files;
  cumulusMessage.payload.granules[0].files = existingFiles.concat(invalidFiles);

  const validFiles = 10;
  for (let i = 0; i < validFiles; i += 1) {
    cumulusMessage.payload.granules[0].files.push(fakeFileFactory());
  }
  const validFileCount = cumulusMessage.payload.granules[0].files.length - invalidFiles.length;

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  t.false(await filePgModel.exists(knex, { key: invalidFiles[0].key }));
  t.false(await filePgModel.exists(knex, { key: invalidFiles[1].key }));

  const fileRecords = await filePgModel.search(knex, {});
  t.is(fileRecords.length, validFileCount);
});

test.serial('writeGranules() stores error on granule if any file fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    granuleModel,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  const invalidFiles = [
    fakeFileFactory({ bucket: undefined }),
    fakeFileFactory({ bucket: undefined }),
  ];

  const existingFiles = cumulusMessage.payload.granules[0].files;
  cumulusMessage.payload.granules[0].files = existingFiles.concat(invalidFiles);

  const validFiles = 10;
  for (let i = 0; i < validFiles; i += 1) {
    cumulusMessage.payload.granules[0].files.push(fakeFileFactory());
  }

  await writeGranules({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const pgGranule = await t.context.granulePgModel.get(knex, { granule_id: granuleId });
  t.is(pgGranule.error.Error, 'Failed writing files to Postgres.');
  t.is(pgGranule.error.Cause.name, 'AggregateError');
});
