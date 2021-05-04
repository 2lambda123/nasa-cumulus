const cryptoRandomString = require('crypto-random-string');
const omit = require('lodash/omit');
const sinon = require('sinon');
const test = require('ava');

const Granule = require('@cumulus/api/models/granules');
const s3Utils = require('@cumulus/aws-client/S3');
const Logger = require('@cumulus/logger');

const { dynamodbDocClient } = require('@cumulus/aws-client/services');
const { fakeFileFactory } = require('@cumulus/api/lib/testUtils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  ExecutionPgModel,
  fakeCollectionRecordFactory,
  fakeExecutionRecordFactory,
  FilePgModel,
  generateLocalTestDb,
  GranulesExecutionsPgModel,
  GranulePgModel,
  translateApiGranuleToPostgresGranule,
} = require('@cumulus/db');
const { RecordAlreadyMigrated, PostgresUpdateFailed } = require('@cumulus/errors');
const { s3 } = require('@cumulus/aws-client/services');

// eslint-disable-next-line node/no-unpublished-require
const { migrationDir } = require('../../db-migration');
const {
  migrateGranuleRecord,
  migrateFileRecord,
  migrateGranuleAndFilesViaTransaction,
  queryAndMigrateGranuleDynamoRecords,
  migrateGranulesAndFiles,
} = require('../dist/lambda/granulesAndFiles');

const buildCollectionId = (name, version) => `${name}___${version}`;

const dateString = new Date().toString();
const bucket = cryptoRandomString({ length: 10 });

const fileOmitList = ['granule_cumulus_id', 'cumulus_id', 'created_at', 'updated_at'];
const fakeFile = () => fakeFileFactory({
  bucket,
  key: cryptoRandomString({ length: 10 }),
  size: 1098034,
  fileName: 'MOD09GQ.A4369670.7bAGCH.006.0739896140643.hdf',
  checksum: 'checkSum01',
  checksumType: 'md5',
  type: 'data',
  source: 'source',
});

const generateTestGranule = (params) => ({
  granuleId: cryptoRandomString({ length: 5 }),
  status: 'running',
  cmrLink: cryptoRandomString({ length: 10 }),
  published: false,
  duration: 10,
  files: [
    fakeFile(),
  ],
  error: {},
  productVolume: 1119742,
  timeToPreprocess: 0,
  beginningDateTime: dateString,
  endingDateTime: dateString,
  processingStartDateTime: dateString,
  processingEndDateTime: dateString,
  lastUpdateDateTime: dateString,
  timeToArchive: 0,
  productionDateTime: dateString,
  timestamp: Date.now(),
  createdAt: Date.now() - 200 * 1000,
  updatedAt: Date.now(),
  ...params,
});

let granulesModel;

const testDbName = `data_migration_2_${cryptoRandomString({ length: 10 })}`;

test.before(async (t) => {
  await s3Utils.createBucket(bucket);
  process.env.stackName = cryptoRandomString({ length: 10 });
  process.env.system_bucket = bucket;

  process.env.GranulesTable = cryptoRandomString({ length: 10 });

  granulesModel = new Granule();
  await granulesModel.createTable();

  t.context.granulePgModel = new GranulePgModel();
  t.context.filePgModel = new FilePgModel();
  t.context.granulesExecutionsPgModel = new GranulesExecutionsPgModel();

  const { knexAdmin, knex } = await generateLocalTestDb(
    testDbName,
    migrationDir
  );
  t.context.knexAdmin = knexAdmin;
  t.context.knex = knex;
});

test.beforeEach(async (t) => {
  const collectionPgModel = new CollectionPgModel();
  const testCollection = fakeCollectionRecordFactory();

  const collectionResponse = await collectionPgModel.create(
    t.context.knex,
    testCollection
  );
  t.context.collectionPgModel = collectionPgModel;
  t.context.testCollection = testCollection;
  t.context.collectionCumulusId = collectionResponse[0];

  const executionPgModel = new ExecutionPgModel();
  t.context.executionUrl = cryptoRandomString({ length: 5 });
  const testExecution = fakeExecutionRecordFactory({
    url: t.context.executionUrl,
  });

  [t.context.executionCumulusId] = await executionPgModel.create(
    t.context.knex,
    testExecution
  );
  t.context.testExecution = testExecution;

  t.context.testGranule = generateTestGranule({
    collectionId: buildCollectionId(testCollection.name, testCollection.version),
    execution: t.context.executionUrl,
  });
});

test.after.always(async (t) => {
  await granulesModel.deleteTable();

  await s3Utils.recursivelyDeleteS3Bucket(bucket);

  await destroyLocalTestDb({
    ...t.context,
    testDbName,
  });
});

test.serial('migrateGranuleRecord correctly migrates granule record', async (t) => {
  const {
    collectionCumulusId,
    executionCumulusId,
    granulesExecutionsPgModel,
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  const granuleCumulusId = await knex.transaction((trx) => migrateGranuleRecord(testGranule, trx));
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });
  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  t.deepEqual(
    omit(record, ['cumulus_id']),
    {
      granule_id: testGranule.granuleId,
      status: testGranule.status,
      collection_cumulus_id: collectionCumulusId,
      published: testGranule.published,
      duration: testGranule.duration,
      time_to_archive: testGranule.timeToArchive,
      time_to_process: testGranule.timeToPreprocess,
      product_volume: testGranule.productVolume.toString(),
      error: testGranule.error,
      cmr_link: testGranule.cmrLink,
      pdr_cumulus_id: null,
      provider_cumulus_id: null,
      query_fields: null,
      beginning_date_time: new Date(testGranule.beginningDateTime),
      ending_date_time: new Date(testGranule.endingDateTime),
      last_update_date_time: new Date(testGranule.lastUpdateDateTime),
      processing_end_date_time: new Date(testGranule.processingEndDateTime),
      processing_start_date_time: new Date(testGranule.processingStartDateTime),
      production_date_time: new Date(testGranule.productionDateTime),
      timestamp: new Date(testGranule.timestamp),
      created_at: new Date(testGranule.createdAt),
      updated_at: new Date(testGranule.updatedAt),
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});

test.serial('migrateGranuleRecord successfully migrates granule record with missing execution', async (t) => {
  const {
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  // refer to non-existent execution
  testGranule.execution = cryptoRandomString({ length: 10 });

  const granuleCumulusId = await knex.transaction((trx) => migrateGranuleRecord(testGranule, trx));
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  t.true(
    await granulePgModel.exists(knex, {
      cumulus_id: granuleCumulusId,
    })
  );
});

test.serial('migrateFileRecord correctly migrates file record', async (t) => {
  const {
    filePgModel,
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  const testFile = testGranule.files[0];
  const granule = await translateApiGranuleToPostgresGranule(testGranule, knex);
  const [granuleCumulusId] = await granulePgModel.create(knex, granule);
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  await migrateFileRecord(testFile, granuleCumulusId, knex);

  const record = await filePgModel.get(knex, { bucket: testFile.bucket, key: testFile.key });

  t.deepEqual(
    omit(record, fileOmitList),
    {
      bucket: testFile.bucket,
      checksum_value: testFile.checksum,
      checksum_type: testFile.checksumType,
      key: testFile.key,
      path: null,
      file_size: testFile.size.toString(),
      file_name: testFile.fileName,
      source: testFile.source,
    }
  );
});

test.serial('migrateFileRecord correctly migrates file record with filename instead of bucket and key', async (t) => {
  const {
    filePgModel,
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  const testFile = fakeFileFactory({
    bucket: undefined,
    key: undefined,
    filename: 's3://cumulus-test-sandbox-private/someKey',
  });
  testGranule.files = [testFile];

  const granule = await translateApiGranuleToPostgresGranule(testGranule, knex);
  const [granuleCumulusId] = await granulePgModel.create(knex, granule);
  await migrateFileRecord(testFile, granuleCumulusId, knex);

  const record = await filePgModel.get(
    knex,
    { bucket: 'cumulus-test-sandbox-private', key: 'someKey' }
  );

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  t.deepEqual(
    omit(record, fileOmitList),
    {
      bucket: 'cumulus-test-sandbox-private',
      checksum_value: null,
      checksum_type: null,
      key: 'someKey',
      path: null,
      file_size: null,
      file_name: testFile.fileName,
      source: null,
    }
  );
});

test.serial('migrateGranuleRecord handles nullable fields on source granule data', async (t) => {
  const {
    collectionCumulusId,
    executionCumulusId,
    granulePgModel,
    granulesExecutionsPgModel,
    knex,
    testGranule,
  } = t.context;

  delete testGranule.pdrName;
  delete testGranule.cmrLink;
  delete testGranule.published;
  delete testGranule.duration;
  delete testGranule.files;
  delete testGranule.error;
  delete testGranule.productVolume;
  delete testGranule.timeToPreprocess;
  delete testGranule.beginningDateTime;
  delete testGranule.endingDateTime;
  delete testGranule.processingStartDateTime;
  delete testGranule.processingEndDateTime;
  delete testGranule.lastUpdateDateTime;
  delete testGranule.timeToArchive;
  delete testGranule.productionDateTime;
  delete testGranule.timestamp;
  delete testGranule.provider;
  delete testGranule.queryFields;
  delete testGranule.version;

  const granuleCumulusId = await knex.transaction((trx) => migrateGranuleRecord(testGranule, trx));
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  t.deepEqual(
    omit(record, ['cumulus_id']),
    {
      granule_id: testGranule.granuleId,
      status: testGranule.status,
      collection_cumulus_id: collectionCumulusId,
      published: null,
      duration: null,
      time_to_archive: null,
      time_to_process: null,
      product_volume: null,
      error: null,
      cmr_link: null,
      pdr_cumulus_id: null,
      provider_cumulus_id: null,
      query_fields: null,
      beginning_date_time: null,
      ending_date_time: null,
      last_update_date_time: null,
      processing_end_date_time: null,
      processing_start_date_time: null,
      production_date_time: null,
      timestamp: null,
      created_at: new Date(testGranule.createdAt),
      updated_at: new Date(testGranule.updatedAt),
    }
  );
  t.deepEqual(
    await granulesExecutionsPgModel.search(
      knex,
      { granule_cumulus_id: granuleCumulusId }
    ),
    [executionCumulusId].map((executionId) => ({
      granule_cumulus_id: Number(granuleCumulusId),
      execution_cumulus_id: executionId,
    }))
  );
});

test.serial('migrateGranuleRecord throws RecordAlreadyMigrated error if previously migrated record is newer', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  const testGranule1 = testGranule;
  const testGranule2 = {
    ...testGranule1,
    updatedAt: Date.now() - 1000,
  };

  const granuleCumulusId = await knex.transaction((trx) => migrateGranuleRecord(testGranule, trx));
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  await t.throwsAsync(
    migrateGranuleRecord(testGranule2, knex),
    { instanceOf: RecordAlreadyMigrated }
  );
});

test.serial('migrateGranuleRecord throws error if upsert does not return any rows', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
  } = t.context;

  // Create a granule in the "running" status.
  const testGranule = generateTestGranule({
    collectionId: buildCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
    updatedAt: Date.now() - 1000,
    status: 'running',
  });

  const granuleCumulusId = await knex.transaction((trx) => migrateGranuleRecord(testGranule, trx));

  // We do not allow updates on granules where the status is "running"
  // and a GranulesExecutions record has already been created to prevent out-of-order writes.
  // Attempting to migrate this granule will cause the upsert to
  // return 0 rows and the migration will fail
  const newerGranule = {
    ...testGranule,
    updatedAt: Date.now(),
  };

  await t.throwsAsync(
    migrateGranuleRecord(newerGranule, knex),
    { instanceOf: PostgresUpdateFailed }
  );

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });
});

test.serial('migrateGranuleRecord updates an already migrated record if the updated date is newer', async (t) => {
  const {
    knex,
    granulePgModel,
    testCollection,
    testExecution,
  } = t.context;

  const testGranule = generateTestGranule({
    collectionId: buildCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
    status: 'completed',
    updatedAt: Date.now() - 1000,
  });

  await knex.transaction((trx) => migrateGranuleRecord(testGranule, trx));

  const newerGranule = {
    ...testGranule,
    updatedAt: Date.now(),
  };

  const granuleCumulusId = await knex.transaction((trx) => migrateGranuleRecord(newerGranule, trx));
  const record = await granulePgModel.get(knex, {
    cumulus_id: granuleCumulusId,
  });

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: record.cumulus_id });
  });

  t.deepEqual(record.updated_at, new Date(newerGranule.updatedAt));
});

test.serial('migrateFileRecord handles nullable fields on source file data', async (t) => {
  const {
    filePgModel,
    granulePgModel,
    knex,
    testGranule,
  } = t.context;

  const testFile = testGranule.files[0];

  delete testFile.checksum;
  delete testFile.checksumType;
  delete testFile.fileName;
  delete testFile.path;
  delete testFile.size;
  delete testFile.source;

  const granule = await translateApiGranuleToPostgresGranule(testGranule, knex);
  const [granuleCumulusId] = await granulePgModel.create(knex, granule);
  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: granuleCumulusId });
  });

  await migrateFileRecord(testFile, granuleCumulusId, knex);

  const record = await filePgModel.get(knex, { bucket: testFile.bucket, key: testFile.key });

  t.deepEqual(
    omit(record, fileOmitList),
    {
      bucket: testFile.bucket,
      key: testFile.key,
      checksum_value: null,
      checksum_type: null,
      file_size: null,
      file_name: null,
      source: null,
      path: null,
    }
  );
});

test.serial('migrateGranuleAndFilesViaTransaction skips already migrated granule record', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  t.teardown(() => {
    granulesModel.delete(testGranule);
  });

  const result = await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  t.deepEqual(result, {
    filesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 1,
      migrated: 0,
    },
    granulesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 1,
      migrated: 0,
    },
  });

  const records = await t.context.granulePgModel.search(t.context.knex, {});
  t.is(records.length, 1);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranuleAndFilesViaTransaction processes granule with no files', async (t) => {
  const {
    knex,
    testGranule,
  } = t.context;

  delete testGranule.files;

  await migrateGranuleAndFilesViaTransaction({
    dynamoRecord: testGranule,
    knex,
    loggingInterval: 1,
  });

  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 0);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('queryAndMigrateGranuleDynamoRecords only processes records for specified collection', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const collectionIdFilter = buildCollectionId(testCollection.name, testCollection.version);

  const testGranule2 = generateTestGranule({
    collectionId: buildCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  // this record should not be migrated
  const testGranule3 = generateTestGranule({
    collectionId: buildCollectionId(cryptoRandomString({ length: 3 }), testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
    granulesModel.create(testGranule3),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
      granulesModel.delete({ granuleId: testGranule3.granuleId }),
    ]);
  });

  const migrationResult = await queryAndMigrateGranuleDynamoRecords({
    granulesTable: process.env.GranulesTable,
    knex,
    granuleMigrationParams: {
      collectionId: collectionIdFilter,
    },
    loggingInterval: 1,
  });
  t.deepEqual(migrationResult, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      filters: {
        collectionId: collectionIdFilter,
      },
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  t.is(records.length, 2);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[1].cumulus_id });
  });
});

test.serial('queryAndMigrateGranuleDynamoRecords only processes records for specified granuleId', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const testGranule2 = generateTestGranule({
    collectionId: buildCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  // this record should not be migrated
  const testGranule3 = generateTestGranule({
    collectionId: buildCollectionId(cryptoRandomString({ length: 3 }), testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
    granulesModel.create(testGranule3),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
      granulesModel.delete({ granuleId: testGranule3.granuleId }),
    ]);
  });

  const migrationResult = await queryAndMigrateGranuleDynamoRecords({
    granulesTable: process.env.GranulesTable,
    knex,
    granuleMigrationParams: {
      granuleId: testGranule.granuleId,
    },
    loggingInterval: 1,
  });
  t.deepEqual(migrationResult, {
    filesResult: {
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
    granulesResult: {
      filters: {
        granuleId: testGranule.granuleId,
      },
      total_dynamo_db_records: 1,
      failed: 0,
      skipped: 0,
      migrated: 1,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  t.is(records.length, 1);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles processes multiple granules and files', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule({
    collectionId: buildCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule1),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex);
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 2);
  t.is(fileRecords.length, 2);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[1].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles processes multiple granules when a filter is applied', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const collectionId = buildCollectionId(testCollection.name, testCollection.version);

  const testGranule1 = testGranule;
  const testGranule2 = generateTestGranule({
    collectionId,
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule1),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(
    process.env,
    knex,
    {
      collectionId,
    }
  );
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
    granulesResult: {
      filters: {
        collectionId,
      },
      total_dynamo_db_records: 2,
      failed: 0,
      skipped: 0,
      migrated: 2,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 2);
  t.is(fileRecords.length, 2);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[1].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles processes all non-failing granule records and does not process files of failing granule records', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const testGranule2 = generateTestGranule({
    collectionId: buildCollectionId(testCollection.name, testCollection.version),
    execution: testExecution.url,
  });

  // remove required field so record will fail
  delete testGranule.collectionId;

  await Promise.all([
    dynamodbDocClient().put({
      TableName: process.env.GranulesTable,
      Item: testGranule,
    }).promise(),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(process.env, knex);
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 1,
      skipped: 0,
      migrated: 1,
    },
    granulesResult: {
      total_dynamo_db_records: 2,
      failed: 1,
      skipped: 0,
      migrated: 1,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 1);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles processes all non-failing granule records when a filter is applied', async (t) => {
  const {
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;

  const collectionId = buildCollectionId(testCollection.name, testCollection.version);
  const testGranule2 = generateTestGranule({
    collectionId,
    execution: testExecution.url,
  });
  // refer to non-existent provider to cause failure
  testGranule2.provider = cryptoRandomString({ length: 3 });

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    await Promise.all([
      granulesModel.delete({ granuleId: testGranule.granuleId }),
      granulesModel.delete({ granuleId: testGranule2.granuleId }),
    ]);
  });

  const migrationSummary = await migrateGranulesAndFiles(
    process.env,
    knex,
    {
      collectionId,
    }
  );
  t.deepEqual(migrationSummary, {
    filesResult: {
      total_dynamo_db_records: 2,
      failed: 1,
      skipped: 0,
      migrated: 1,
    },
    granulesResult: {
      filters: {
        collectionId,
      },
      total_dynamo_db_records: 2,
      failed: 1,
      skipped: 0,
      migrated: 1,
    },
  });
  const records = await t.context.granulePgModel.search(t.context.knex, {});
  const fileRecords = await t.context.filePgModel.search(t.context.knex, {});
  t.is(records.length, 1);
  t.is(fileRecords.length, 1);

  t.teardown(async () => {
    await t.context.granulePgModel.delete(t.context.knex, { cumulus_id: records[0].cumulus_id });
  });
});

test.serial('migrateGranulesAndFiles writes errors to S3 object', async (t) => {
  const {
    collectionPgModel,
    knex,
    testCollection,
    testExecution,
    testGranule,
  } = t.context;
  const key = `${process.env.stackName}/data-migration2-granulesAndFiles-errors-123.json`;

  const testCollection2 = fakeCollectionRecordFactory();
  const testGranule2 = generateTestGranule({
    collectionId: buildCollectionId(testCollection2.name, testCollection2.version),
    execution: testExecution.url,
  });

  // remove collection record references so migration will fail
  await collectionPgModel.delete(
    t.context.knex,
    testCollection
  );

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
  ]);

  t.teardown(async () => {
    granulesModel.delete({ granuleId: testGranule.granuleId });
    granulesModel.delete({ granuleId: testGranule2.granuleId });
  });

  await migrateGranulesAndFiles(process.env, knex, {}, '123');
  // Check that error file exists in S3
  const item = await s3().getObject({
    Bucket: process.env.system_bucket,
    Key: key,
  }).promise();

  console.log(item.Body.toString());
  const errors = JSON.parse(item.Body.toString()).errors;
  const expectedResult = /RecordDoesNotExist/;

  t.is(errors.length, 2);
  t.true(expectedResult.test(errors[0]));
  t.true(expectedResult.test(errors[1]));
});

test.serial('migrateGranulesAndFiles correctly delimits errors written to S3 object', async (t) => {
  const {
    knex,
    testExecution,
    testGranule,
  } = t.context;
  const key = `${process.env.stackName}/data-migration2-granulesAndFiles-errors-123.json`;

  const testCollection2 = fakeCollectionRecordFactory();
  const testGranule2 = generateTestGranule({
    collectionId: buildCollectionId(testCollection2.name, testCollection2.version),
    execution: testExecution.url,
  });

  await Promise.all([
    granulesModel.create(testGranule),
    granulesModel.create(testGranule2),
  ]);

  // Prematurely migrate granule, will be skipped and exluded from error file
  await migrateGranuleRecord(testGranule, knex);

  t.teardown(async () => {
    granulesModel.delete({ granuleId: testGranule.granuleId });
    granulesModel.delete({ granuleId: testGranule2.granuleId });
  });

  await migrateGranulesAndFiles(process.env, knex, {}, '123');
  // Check that error file exists in S3
  const item = await s3().getObject({
    Bucket: process.env.system_bucket,
    Key: key,
  }).promise();
  console.log(item.Body.toString());

  const errors = JSON.parse(item.Body.toString()).errors;
  const expectedResult = /RecordDoesNotExist/;

  t.is(errors.length, 1);
  t.true(expectedResult.test(errors[0]));
});

test.serial('migrateGranulesAndFiles logs summary of migration for a specified loggingInterval', async (t) => {
  const logSpy = sinon.spy(Logger.prototype, 'info');
  const {
    knex,
    testGranule,
    testCollection,
  } = t.context;

  const testGranule2 = generateTestGranule({
    collectionId: buildCollectionId(testCollection.name, testCollection.version),
    execution: t.context.executionUrl,
  });

  await granulesModel.create(testGranule);
  await granulesModel.create(testGranule2);

  t.teardown(async () => {
    logSpy.restore();
    await granulesModel.delete(testGranule);
    await granulesModel.delete(testGranule2);
  });

  await migrateGranulesAndFiles(
    process.env,
    knex,
    {
      loggingInterval: 1,
      parallelScanLimit: 1,
    }
  );
  t.true(logSpy.calledWith('Batch of 1 granule records processed, 1 total'));
  t.true(logSpy.calledWith('Batch of 1 granule records processed, 2 total'));
});

test.serial('migrateGranulesAndFiles logs summary of migration for a specified loggingInterval with filters applied', async (t) => {
  const logSpy = sinon.spy(Logger.prototype, 'info');
  const {
    knex,
    testGranule,
    testCollection,
  } = t.context;

  const collectionId = buildCollectionId(testCollection.name, testCollection.version);
  const testGranule2 = generateTestGranule({
    collectionId,
    execution: t.context.executionUrl,
  });

  await granulesModel.create(testGranule);
  await granulesModel.create(testGranule2);

  t.teardown(async () => {
    logSpy.restore();
    await granulesModel.delete(testGranule);
    await granulesModel.delete(testGranule2);
  });

  await migrateGranulesAndFiles(
    process.env,
    knex,
    {
      collectionId,
      loggingInterval: 1,
      parallelScanLimit: 1,
    }
  );
  t.true(logSpy.calledWith('Batch of 1 granule records processed, 1 total'));
  t.true(logSpy.calledWith('Batch of 1 granule records processed, 2 total'));
});
