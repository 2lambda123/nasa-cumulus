'use strict';

const test = require('ava');
const cryptoRandomString = require('crypto-random-string');
const sinon = require('sinon');
const omit = require('lodash/omit');

const { randomId } = require('@cumulus/common/test-utils');
const { constructCollectionId } = require('@cumulus/message/Collections');
const {
  CollectionPgModel,
  ProviderPgModel,
  ExecutionPgModel,
  GranulesExecutionsPgModel,
  GranulePgModel,
  FilePgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  fakeFileRecordFactory,
  fakeGranuleRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  destroyLocalTestDb,
  TableNames,
  translatePostgresGranuleToApiGranule,
  translateApiGranuleToPostgresGranule,
  migrationDir,
  createRejectableTransaction,
} = require('@cumulus/db');
const {
  sns,
  sqs,
} = require('@cumulus/aws-client/services');
const {
  Search,
} = require('@cumulus/es-client/search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');
const {
  getExecutionUrlFromArn,
} = require('@cumulus/message/Executions');

const {
  generateFilePgRecord,
  getGranuleFromQueryResultOrLookup,
  updateGranuleStatusToQueued,
  writeFilesViaTransaction,
  writeGranuleFromApi,
  writeGranulesFromMessage,
  _writeGranule,
} = require('../../../lib/writeRecords/write-granules');

const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');
const Granule = require('../../../models/granules');

test.before(async (t) => {
  process.env.GranulesTable = cryptoRandomString({ length: 10 });

  const fakeFileUtils = {
    buildDatabaseFiles: (params) => Promise.resolve(params.files),
  };
  const fakeStepFunctionUtils = {
    describeExecution: () => Promise.resolve({}),
  };
  const granuleModel = new Granule({
    fileUtils: fakeFileUtils,
    stepFunctionUtils: fakeStepFunctionUtils,
  });
  await granuleModel.createTable();
  t.context.granuleModel = granuleModel;

  t.context.collectionPgModel = new CollectionPgModel();
  t.context.executionPgModel = new ExecutionPgModel();
  t.context.granulePgModel = new GranulePgModel();
  t.context.filePgModel = new FilePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();
  t.context.providerPgModel = new ProviderPgModel();

  t.context.testDbName = `writeGranules_${cryptoRandomString({ length: 10 })}`;

  const { knexAdmin, knex } = await generateLocalTestDb(
    t.context.testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esGranulesClient = new Search(
    {},
    'granule',
    t.context.esIndex
  );
});

test.beforeEach(async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.granule_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = cryptoRandomString({ length: 10 });
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
  t.context.QueueUrl = QueueUrl;
  const getQueueAttributesResponse = await sqs().getQueueAttributes({
    QueueUrl,
    AttributeNames: ['QueueArn'],
  }).promise();
  const QueueArn = getQueueAttributesResponse.Attributes.QueueArn;

  const { SubscriptionArn } = await sns().subscribe({
    TopicArn,
    Protocol: 'sqs',
    Endpoint: QueueArn,
  }).promise();

  await sns().confirmSubscription({
    TopicArn,
    Token: SubscriptionArn,
  }).promise();

  const stateMachineName = cryptoRandomString({ length: 5 });
  t.context.stateMachineArn = `arn:aws:states:us-east-1:12345:stateMachine:${stateMachineName}`;

  t.context.executionName = cryptoRandomString({ length: 5 });
  t.context.executionArn = `arn:aws:states:us-east-1:12345:execution:${stateMachineName}:${t.context.executionName}`;
  t.context.executionUrl = getExecutionUrlFromArn(t.context.executionArn);
  const execution = fakeExecutionRecordFactory({
    arn: t.context.executionArn,
    url: t.context.executionUrl,
  });

  t.context.collection = fakeCollectionRecordFactory();
  t.context.collectionId = constructCollectionId(
    t.context.collection.name,
    t.context.collection.version
  );
  t.context.provider = fakeProviderRecordFactory();

  t.context.granuleId = cryptoRandomString({ length: 10 });
  t.context.files = [
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 5 }),
    fakeFileFactory({ size: 5 }),
  ];
  t.context.granule = fakeGranuleFactoryV2({
    files: t.context.files,
    granuleId: t.context.granuleId,
    collectionId: constructCollectionId(t.context.collection.name, t.context.collection.version),
    execution: execution.url,
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

  const [pgCollection] = await t.context.collectionPgModel.create(
    t.context.knex,
    t.context.collection
  );
  t.context.collectionCumulusId = pgCollection.cumulus_id;

  const [pgExecution] = await t.context.executionPgModel.create(
    t.context.knex,
    execution
  );
  t.context.executionCumulusId = pgExecution.cumulus_id;

  [t.context.providerCumulusId] = await t.context.providerPgModel.create(
    t.context.knex,
    t.context.provider
  );
});

test.afterEach.always(async (t) => {
  const { QueueUrl, TopicArn } = t.context;

  await sqs().deleteQueue({ QueueUrl }).promise();
  await sns().deleteTopic({ TopicArn }).promise();

  await t.context.knex(TableNames.files).del();
  await t.context.knex(TableNames.granulesExecutions).del();
  await t.context.knex(TableNames.granules).del();
});

test.after.always(async (t) => {
  const {
    granuleModel,
  } = t.context;
  await granuleModel.deleteTable();
  await destroyLocalTestDb({
    ...t.context,
  });
  await cleanupTestIndex(t.context);
});

test('generateFilePgRecord() adds granule cumulus ID', (t) => {
  const file = {
    bucket: cryptoRandomString({ length: 3 }),
    key: cryptoRandomString({ length: 3 }),
  };
  const record = generateFilePgRecord({ file, granuleCumulusId: 1 });
  t.is(record.granule_cumulus_id, 1);
});

test('getGranuleFromQueryResultOrLookup() returns cumulus ID from database if query result is empty', async (t) => {
  const fakeGranuleCumulusId = Math.floor(Math.random() * 1000);
  const granuleRecord = fakeGranuleRecordFactory({ granule_id: fakeGranuleCumulusId });
  const fakeGranulePgModel = {
    get: (_, record) => {
      if (record.granule_id === granuleRecord.granule_id) {
        return Promise.resolve(granuleRecord);
      }
      return Promise.resolve();
    },
  };

  t.is(
    await getGranuleFromQueryResultOrLookup({
      trx: {},
      queryResult: [],
      granuleRecord,
      granulePgModel: fakeGranulePgModel,
    }),
    granuleRecord
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
    createRejectableTransaction(
      knex,
      (trx) =>
        writeFilesViaTransaction({
          fileRecords,
          trx,
          filePgModel: fakeFilePgModel,
        })
    )
  );
});

test.serial('_writeGranule will not allow a running status to replace a completed status for same execution', async (t) => {
  const {
    granule,
    executionCumulusId,
    esClient,
    knex,
    granuleModel,
    granuleId,
    collectionCumulusId,
    executionUrl,
  } = t.context;

  const apiGranuleRecord = {
    ...granule,
    status: 'completed',
  };
  const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
    apiGranuleRecord,
    knex
  );
  await _writeGranule({
    apiGranuleRecord,
    postgresGranuleRecord,
    executionCumulusId,
    granuleModel,
    knex,
    esClient,
    snsEventType: 'Update',
  });

  t.like(
    await granuleModel.get({ granuleId }),
    {
      execution: executionUrl,
      status: 'completed',
    }
  );
  const granulePgRecord = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.like(
    granulePgRecord,
    {
      status: 'completed',
    }
  );
  t.is(
    (await t.context.granulesExecutionsPgModel.search(
      t.context.knex,
      {
        granule_cumulus_id: granulePgRecord.cumulus_id,
      }
    )).length,
    1
  );
  t.like(
    await t.context.esGranulesClient.get(granuleId),
    {
      execution: executionUrl,
      status: 'completed',
    }
  );

  const updatedapiGranuleRecord = {
    ...granule,
    status: 'running',
  };

  let updatedPgGranuleRecord = await translateApiGranuleToPostgresGranule(
    updatedapiGranuleRecord,
    knex
  );

  updatedPgGranuleRecord = {
    ...updatedPgGranuleRecord,
    cumulus_id: granulePgRecord.cumulus_id,
  };

  await _writeGranule({
    apiGranuleRecord: updatedapiGranuleRecord,
    postgresGranuleRecord: updatedPgGranuleRecord,
    executionCumulusId,
    granuleModel,
    knex,
    esClient,
    snsEventType: 'Update',
  });

  t.like(
    await granuleModel.get({ granuleId }),
    {
      execution: executionUrl,
      status: 'completed',
    }
  );
  t.like(
    await t.context.granulePgModel.get(knex, {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }),
    {
      status: 'completed',
    }
  );
  t.like(
    await t.context.esGranulesClient.get(granuleId),
    {
      execution: executionUrl,
      status: 'completed',
    }
  );
});

test.serial('writeGranulesFromMessage() returns undefined if message has no granules', async (t) => {
  const {
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
  } = t.context;
  const cumulusMessage = {};
  const actual = await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });
  t.is(actual, undefined);
});

test.serial('writeGranulesFromMessage() returns undefined if message has empty granule set', async (t) => {
  const {
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
  } = t.context;
  const cumulusMessage = { granules: [] };
  const actual = await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });
  t.is(actual, undefined);
});

test.serial('writeGranulesFromMessage() saves granule records to DynamoDB/PostgreSQL/Elasticsearch/SNS if PostgreSQL write is enabled', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await t.context.granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
  t.true(await t.context.esGranulesClient.exists(granuleId));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages.length, 1);
});

test.serial('writeGranulesFromMessage() saves the same values to DynamoDB, PostgreSQL and Elasticsearch', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    granuleModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  // Only test fields that are stored in Postgres on the Granule record.
  // The following fields are populated by separate queries during translation
  // or elasticsearch.
  const omitList = ['files', 'execution', 'pdrName', 'provider', '_id'];

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoRecord = await granuleModel.get({ granuleId });
  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  // translate the PG granule to API granule to directly compare to Dynamo
  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });
  t.deepEqual(omit(translatedPgRecord, omitList), omit(dynamoRecord, omitList));

  const esRecord = await t.context.esGranulesClient.get(granuleId);
  t.deepEqual(omit(translatedPgRecord, omitList), omit(esRecord, omitList));
});

test.serial('writeGranulesFromMessage() removes preexisting granule file from postgres on granule update with disjoint files', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    filePgModel,
    granule,
    granuleModel,
    granulePgModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const pgGranule = await translateApiGranuleToPostgresGranule(granule, knex);
  const returnedGranule = await granulePgModel.create(knex, pgGranule, '*');

  const fakeFile = await filePgModel.create(knex, {
    granule_cumulus_id: returnedGranule[0].cumulus_id,
    bucket: 'fake_bucket',
    key: 'fake_key',
  }, '*');

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const granuleRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  const granuleFiles = await filePgModel.search(knex, {
    granule_cumulus_id: granuleRecord.cumulus_id,
  });
  t.deepEqual(granuleFiles.filter((file) => file.bucket === fakeFile.bucket), []);
});

test.serial('writeGranulesFromMessage() saves granule records to Dynamo/PostgreSQL/Elasticsearch with same timestamps', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoRecord = await granuleModel.get({ granuleId });
  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  const esRecord = await t.context.esGranulesClient.get(granuleId);

  t.is(granulePgRecord.created_at.getTime(), dynamoRecord.createdAt);
  t.is(granulePgRecord.updated_at.getTime(), dynamoRecord.updatedAt);

  t.is(granulePgRecord.created_at.getTime(), esRecord.createdAt);
  t.is(granulePgRecord.updated_at.getTime(), esRecord.updatedAt);
});

test.serial('writeGranulesFromMessage() saves the same files to DynamoDB, PostgreSQL and Elasticsearch', async (t) => {
  const {
    collectionCumulusId,
    cumulusMessage,
    granuleModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  // ensure files are written
  cumulusMessage.meta.status = 'completed';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoRecord = await granuleModel.get({ granuleId });
  const granulePgRecord = await t.context.granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  // translate the PG granule to API granule to directly compare to Dynamo
  const translatedPgRecord = await translatePostgresGranuleToApiGranule({
    granulePgRecord,
    knexOrTransaction: knex,
  });
  t.deepEqual(translatedPgRecord.files, dynamoRecord.files);

  const esRecord = await t.context.esGranulesClient.get(granuleId);
  t.deepEqual(translatedPgRecord.files, esRecord.files);
});

test.serial('writeGranulesFromMessage() saves file records to DynamoDB/PostgreSQL if Postgres write is enabled and workflow status is "completed"', async (t) => {
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
    files,
  } = t.context;

  cumulusMessage.meta.status = 'completed';

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoGranule = await granuleModel.get({ granuleId });
  t.deepEqual(dynamoGranule.files, files);

  const granule = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  const pgFiles = await filePgModel.search(knex, { granule_cumulus_id: granule.cumulus_id });
  files.forEach((file) => {
    const matchingPgFile = pgFiles.find(
      (pgFile) => file.bucket === pgFile.bucket && file.key === pgFile.key
    );
    t.like(
      matchingPgFile,
      {
        bucket: file.bucket,
        key: file.key,
        file_size: `${file.size}`,
      }
    );
  });
});

test.serial('writeGranulesFromMessage() does not persist file records to Postgres if the workflow status is "running"', async (t) => {
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

  await writeGranulesFromMessage({
    cumulusMessage,
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

test.serial('writeGranulesFromMessage() handles successful and failing writes independently', async (t) => {
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

  await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));

  t.true(await granuleModel.exists({ granuleId }));
  t.true(
    await t.context.granulePgModel.exists(
      knex,
      { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
    )
  );
});

test.serial('writeGranulesFromMessage() throws error if any granule writes fail', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
  } = t.context;

  cumulusMessage.payload.granules = [
    ...cumulusMessage.payload.granules,
    // this object is not a valid granule, so its write should fail
    {},
  ];

  await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  }));
});

test.serial('writeGranulesFromMessage() does not write to DynamoDB/PostgreSQL/Elasticsearch/SNS if Dynamo write fails', async (t) => {
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
    generateGranuleRecord: () => t.context.granule,
    storeGranule: () => {
      throw new Error('Granules dynamo error');
    },
    describeGranuleExecution: () => Promise.resolve({}),
    delete: () => Promise.resolve(),
  };

  const [error] = await t.throwsAsync(
    writeGranulesFromMessage({
      cumulusMessage,
      executionCumulusId,
      providerCumulusId,
      knex,
      granuleModel: fakeGranuleModel,
    })
  );

  t.true(error.message.includes('Granules dynamo error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await t.context.granulePgModel.exists(
      knex,
      { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
    )
  );
  t.false(await t.context.esGranulesClient.exists(granuleId));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('writeGranulesFromMessage() does not write to DynamoDB/PostgreSQL/Elasticsearch/SNS if Postgres write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleId,
    collectionCumulusId,
  } = t.context;

  const testGranulePgModel = {
    upsert: () => {
      throw new Error('Granules PostgreSQL error');
    },
  };

  const [error] = await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
    granulePgModel: testGranulePgModel,
  }));

  t.true(error.message.includes('Granules PostgreSQL error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await t.context.granulePgModel.exists(knex, {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    })
  );
  t.false(await t.context.esGranulesClient.exists(granuleId));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('writeGranulesFromMessage() does not persist records to DynamoDB/PostgreSQL/Elasticsearch/SNS if Elasticsearch write fails', async (t) => {
  const {
    cumulusMessage,
    granuleModel,
    knex,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    granuleId,
  } = t.context;

  const fakeEsClient = {
    update: () => {
      throw new Error('Granules ES error');
    },
    delete: () => Promise.resolve(),
  };

  const [error] = await t.throwsAsync(writeGranulesFromMessage({
    cumulusMessage,
    collectionCumulusId,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
    esClient: fakeEsClient,
  }));

  t.true(error.message.includes('Granules ES error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await t.context.granulePgModel.exists(
      knex,
      { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
    )
  );
  t.false(await t.context.esGranulesClient.exists(granuleId));

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages, undefined);
});

test.serial('writeGranulesFromMessage() writes a granule and marks as failed if any file writes fail', async (t) => {
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

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const dynamoGranule = await granuleModel.get({ granuleId });
  t.is(dynamoGranule.status, 'failed');
  t.deepEqual(dynamoGranule.error.Error, 'Failed writing files to PostgreSQL.');

  const pgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: collectionCumulusId,
  });
  t.is(pgGranule.status, 'failed');
  t.deepEqual(pgGranule.error.Error, 'Failed writing files to PostgreSQL.');
});

test.serial('writeGranulesFromMessage() writes all valid files if any non-valid file fails', async (t) => {
  const {
    cumulusMessage,
    knex,
    executionCumulusId,
    providerCumulusId,
    granuleModel,
    filePgModel,
    granulePgModel,
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

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  t.false(await filePgModel.exists(knex, { key: invalidFiles[0].key }));
  t.false(await filePgModel.exists(knex, { key: invalidFiles[1].key }));

  const granuleCumulusId = await granulePgModel.getRecordCumulusId(
    knex,
    { granule_id: cumulusMessage.payload.granules[0].granuleId }
  );
  const fileRecords = await filePgModel.search(knex, { granule_cumulus_id: granuleCumulusId });
  t.is(fileRecords.length, validFileCount);
});

test.serial('writeGranulesFromMessage() stores error on granule if any file fails', async (t) => {
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

  await writeGranulesFromMessage({
    cumulusMessage,
    executionCumulusId,
    providerCumulusId,
    knex,
    granuleModel,
  });

  const pgGranule = await t.context.granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.is(pgGranule.error.Error, 'Failed writing files to PostgreSQL.');
  t.true(pgGranule.error.Cause.includes('AggregateError'));
});

test.serial('writeGranuleFromApi() removes preexisting granule file from postgres on granule update with disjoint files', async (t) => {
  const {
    collectionCumulusId,
    filePgModel,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  const pgGranule = await translateApiGranuleToPostgresGranule(granule, knex);
  const returnedGranule = await granulePgModel.create(knex, pgGranule, '*');

  const fakeFile = await filePgModel.create(knex, {
    granule_cumulus_id: returnedGranule[0].cumulus_id,
    bucket: 'fake_bucket',
    key: 'fake_key',
  }, '*');

  await writeGranuleFromApi({ ...granule, status: 'completed' }, knex);

  const granuleRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  const granuleFiles = await filePgModel.search(knex, {
    granule_cumulus_id: granuleRecord.cumulus_id,
  });
  t.deepEqual(granuleFiles.filter((file) => file.bucket === fakeFile.bucket), []);
});

test.serial('writeGranuleFromApi() throws for a granule with no granuleId provided', async (t) => {
  const {
    knex,
    granule,
  } = t.context;

  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, granuleId: undefined }, knex),
    { message: 'Could not create granule record, invalid granuleId: undefined' }
  );
});

test.serial('writeGranuleFromApi() throws for a granule with an invalid collectionId', async (t) => {
  const {
    granule,
    knex,
  } = t.context;

  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, collectionId: 'wrong___collection' }, knex),
    { message: 'Record in collections with identifiers {"name":"wrong","version":"collection"} does not exist.' }
  );
});

test.serial('writeGranuleFromApi() throws for a granule with no collectionId provided', async (t) => {
  const {
    knex,
    granule,
  } = t.context;

  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, collectionId: undefined }, knex),
    { message: 'collectionId required to generate a granule record' }
  );
});

test.serial('writeGranuleFromApi() throws for a granule with an invalid collectionId provided', async (t) => {
  const {
    knex,
    granule,
  } = t.context;
  const badCollectionId = `collectionId${cryptoRandomString({ length: 5 })}`;
  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, collectionId: badCollectionId }, knex),
    { message: `invalid collectionId: ${badCollectionId}` }
  );
});

test.serial('writeGranuleFromApi() writes a granule to PostgreSQL and DynamoDB.', async (t) => {
  const {
    collectionCumulusId,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
  } = t.context;

  const result = await writeGranuleFromApi({ ...granule }, knex);

  t.is(result, `Wrote Granule ${granuleId}`);

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
});

test.serial('writeGranuleFromApi() writes a granule without an execution to PostgreSQL and DynamoDB.', async (t) => {
  const {
    collectionCumulusId,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule, execution: undefined }, knex);

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
});

test.serial('writeGranuleFromApi() can write a granule with no files associated with it', async (t) => {
  const {
    knex,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
    collectionCumulusId,
  } = t.context;

  await writeGranuleFromApi({ ...granule, files: [] }, knex);
  t.true(await granuleModel.exists({ granuleId }));
  t.true(await granulePgModel.exists(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  ));
});

test.serial('writeGranuleFromApi() throws with granule with an execution url that does not exist.', async (t) => {
  const {
    knex,
    granule,
  } = t.context;
  const execution = `execution${cryptoRandomString({ length: 5 })}`;
  await t.throwsAsync(
    writeGranuleFromApi({ ...granule, execution }, knex),
    { message: `Could not find execution in PostgreSQL database with url ${execution}` }
  );
});

test.serial('writeGranuleFromApi() saves granule records to Dynamo and Postgres with same timestamps.', async (t) => {
  const {
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
  } = t.context;

  const result = await writeGranuleFromApi({ ...granule }, knex);

  t.is(result, `Wrote Granule ${granuleId}`);

  const dynamoRecord = await granuleModel.get({ granuleId });
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.is(postgresRecord.created_at.getTime(), dynamoRecord.createdAt);
  t.is(postgresRecord.updated_at.getTime(), dynamoRecord.updatedAt);
});

test.serial('writeGranuleFromApi() saves file records to Postgres if Postgres write is enabled and workflow status is "completed"', async (t) => {
  const {
    collectionCumulusId,
    filePgModel,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule, status: 'completed' }, knex);

  const granuleRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.true(
    await filePgModel.exists(knex, { granule_cumulus_id: granuleRecord.cumulus_id })
  );
});

test.serial('writeGranuleFromApi() does not persist file records to Postgres if workflow status is "running"', async (t) => {
  const {
    collectionCumulusId,
    filePgModel,
    granule,
    granuleId,
    granulePgModel,
    knex,
  } = t.context;

  await writeGranuleFromApi({ ...granule, status: 'running' }, knex);

  const granuleRecord = await granulePgModel.get(
    knex,
    {
      granule_id: granuleId,
      collection_cumulus_id: collectionCumulusId,
    }
  );

  t.false(
    await filePgModel.exists(knex, { granule_cumulus_id: granuleRecord.cumulus_id })
  );
});

test.serial('writeGranuleFromApi() does not persist records to Dynamo or Postgres if Dynamo write fails', async (t) => {
  const {
    collectionCumulusId,
    granule,
    granuleId,
    granuleModel,
    knex,
  } = t.context;

  const fakeGranuleModel = {
    storeGranule: () => {
      throw new Error('Granules dynamo error');
    },
    delete: () => Promise.resolve({}),
  };

  const error = await t.throwsAsync(
    writeGranuleFromApi({ ...granule, granuleModel: fakeGranuleModel }, knex)
  );

  t.true(error.message.includes('Granules dynamo error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await t.context.granulePgModel.exists(
      knex,
      { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
    )
  );
});

test.serial('writeGranuleFromApi() does not persist records to Dynamo or Postgres if Postgres write fails', async (t) => {
  const {
    collectionCumulusId,
    granule,
    granuleModel,
    knex,
    granuleId,
  } = t.context;

  const testGranulePgModel = {
    upsert: () => {
      throw new Error('Granules Postgres error');
    },
  };

  const error = await t.throwsAsync(writeGranuleFromApi(
    { ...granule, granulePgModel: testGranulePgModel },
    knex
  ));

  t.true(error.message.includes('Granules Postgres error'));
  t.false(await granuleModel.exists({ granuleId }));
  t.false(
    await t.context.granulePgModel.exists(
      knex,
      { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
    )
  );
});

test.serial('writeGranuleFromApi() writes all valid files if any non-valid file fails', async (t) => {
  const {
    filePgModel,
    granulePgModel,
    granule,
    knex,
  } = t.context;

  const invalidFiles = [
    fakeFileFactory({ bucket: undefined }),
    fakeFileFactory({ bucket: undefined }),
  ];
  const allfiles = [...t.context.files].concat(invalidFiles);

  const validFiles = 10;
  for (let i = 0; i < validFiles; i += 1) {
    allfiles.push(fakeFileFactory());
  }
  const validFileCount = allfiles.length - invalidFiles.length;

  await writeGranuleFromApi({ ...granule, files: allfiles }, knex);

  t.false(await filePgModel.exists(knex, { key: invalidFiles[0].key }));
  t.false(await filePgModel.exists(knex, { key: invalidFiles[1].key }));

  const granuleCumulusId = await granulePgModel.getRecordCumulusId(
    knex,
    { granule_id: granule.granuleId }
  );
  const fileRecords = await filePgModel.search(knex, { granule_cumulus_id: granuleCumulusId });
  t.is(fileRecords.length, validFileCount);
});

test.serial('writeGranuleFromApi() stores error on granule if any file fails', async (t) => {
  const {
    collectionCumulusId,
    granule,
    knex,
    granuleId,
  } = t.context;

  const invalidFiles = [
    fakeFileFactory({ bucket: undefined }),
    fakeFileFactory({ bucket: undefined }),
  ];

  const existingFiles = [...t.context.files];
  const files = existingFiles.concat(invalidFiles);

  const validFiles = 10;
  for (let i = 0; i < validFiles; i += 1) {
    files.push(fakeFileFactory());
  }

  await writeGranuleFromApi(
    { ...granule, status: 'completed', files },
    knex
  );

  const pgGranule = await t.context.granulePgModel.get(
    knex, { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  t.is(pgGranule.error.Error, 'Failed writing files to PostgreSQL.');
  t.true(pgGranule.error.Cause.includes('AggregateError'));
});

test.serial('updateGranuleStatusToQueued() updates granule status in the database', async (t) => {
  const {
    knex,
    collectionCumulusId,
    granule,
    granuleId,
    granuleModel,
    granulePgModel,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex);
  const dynamoRecord = await granuleModel.get({ granuleId });
  const postgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );

  await updateGranuleStatusToQueued({ granule: dynamoRecord, knex });
  const updatedDynamoRecord = await granuleModel.get({ granuleId });
  const updatedPostgresRecord = await granulePgModel.get(
    knex,
    { granule_id: granuleId, collection_cumulus_id: collectionCumulusId }
  );
  const omitList = ['execution', 'status', 'updatedAt', 'updated_at'];
  t.falsy(updatedDynamoRecord.execution);
  t.is(updatedDynamoRecord.status, 'queued');
  t.is(updatedPostgresRecord.status, 'queued');
  t.deepEqual(omit(dynamoRecord, omitList), omit(updatedDynamoRecord, omitList));
  t.deepEqual(omit(postgresRecord, omitList), omit(updatedPostgresRecord, omitList));
});

test.serial('updateGranuleStatusToQueued() throws error if record does not exist in pg', async (t) => {
  const {
    knex,
    granule,
    granuleId,
  } = t.context;

  await writeGranuleFromApi({ ...granule }, knex);

  const name = randomId('name');
  const version = randomId('version');
  const badGranule = fakeGranuleFactoryV2({
    granuleId,
    collectionId: constructCollectionId(name, version),
  });
  await t.throwsAsync(
    updateGranuleStatusToQueued({ granule: badGranule, knex }),
    {
      name: 'RecordDoesNotExist',
      message: `Record in collections with identifiers {"name":"${name}","version":"${version}"} does not exist.`,
    }
  );
});

test.serial('_writeGranule() successfully publishes an SNS message', async (t) => {
  const {
    granule,
    executionCumulusId,
    esClient,
    knex,
    granuleModel,
    granuleId,
    QueueUrl,
  } = t.context;

  const apiGranuleRecord = {
    ...granule,
    status: 'completed',
  };
  const postgresGranuleRecord = await translateApiGranuleToPostgresGranule(
    apiGranuleRecord,
    knex
  );

  await _writeGranule({
    apiGranuleRecord,
    postgresGranuleRecord,
    executionCumulusId,
    granuleModel,
    knex,
    esClient,
    snsEventType: 'Update',
  });

  t.true(await granuleModel.exists({ granuleId }));
  t.true(await t.context.esGranulesClient.exists(granuleId));

  const retrievedPgGranule = await t.context.granulePgModel.get(knex, {
    granule_id: granuleId,
    collection_cumulus_id: postgresGranuleRecord.collection_cumulus_id,
  });
  const translatedGranule = await translatePostgresGranuleToApiGranule({
    granulePgRecord: retrievedPgGranule,
    knexOrTransaction: knex,
  });

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages.length, 1);

  const snsMessageBody = JSON.parse(Messages[0].Body);
  const publishedMessage = JSON.parse(snsMessageBody.Message);

  t.deepEqual(publishedMessage.record, translatedGranule);
  t.is(publishedMessage.event, 'Update');
});
