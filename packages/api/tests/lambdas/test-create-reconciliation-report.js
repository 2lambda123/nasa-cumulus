'use strict';

const pMap = require('p-map');
const test = require('ava');
const moment = require('moment');
const flatten = require('lodash/flatten');
const map = require('lodash/map');
const range = require('lodash/range');
const sample = require('lodash/sample');
const sortBy = require('lodash/sortBy');
const sinon = require('sinon');
const CMR = require('@cumulus/cmr-client/CMR');
const CMRSearchConceptQueue = require('@cumulus/cmr-client/CMRSearchConceptQueue');
const {
  buildS3Uri,
  parseS3Uri,
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const awsServices = require('@cumulus/aws-client/services');
const BucketsConfig = require('@cumulus/common/BucketsConfig');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { randomString, randomId } = require('@cumulus/common/test-utils');
const { getDistributionBucketMapKey } = require('@cumulus/common/stack');
const { bootstrapElasticSearch } = require('../../lambdas/bootstrap');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');
const GranuleFilesCache = require('../../lib/GranuleFilesCache');
const { Search } = require('../../es/search');
const {
  handler, reconciliationReportForGranules, reconciliationReportForGranuleFiles,
} = require('../../lambdas/create-reconciliation-report');

const models = require('../../models');
const indexer = require('../../es/indexer');

let esAlias;
let esIndex;
let esClient;

const createBucket = (Bucket) => awsServices.s3().createBucket({ Bucket }).promise();

function createDistributionBucketMapFromBuckets(buckets) {
  let bucketMap = {};
  Object.keys(buckets).forEach((key) => {
    bucketMap = {
      ...bucketMap, ...{ [buckets[key].name]: buckets[key].name },
    };
  });
  return bucketMap;
}

function createDistributionBucketMap(bucketList) {
  const distributionMap = {};
  bucketList.forEach((bucket) => {
    distributionMap[bucket] = bucket;
  });
  return distributionMap;
}

async function storeBucketsConfigToS3(buckets, systemBucket, stackName) {
  const bucketsConfig = {};
  buckets.forEach((bucket) => {
    bucketsConfig[bucket] = {
      name: bucket,
      type: 'protected',
    };
  });

  const distributionMap = createDistributionBucketMap(buckets);

  await awsServices.s3().putObject({
    Bucket: systemBucket,
    Key: getDistributionBucketMapKey(stackName),
    Body: JSON.stringify(distributionMap),
  }).promise();

  return awsServices.s3().putObject({
    Bucket: systemBucket,
    Key: `${stackName}/workflows/buckets.json`,
    Body: JSON.stringify(bucketsConfig),
  }).promise();
}

// Expect files to have bucket and key properties
function storeFilesToS3(files) {
  const putObjectParams = files.map((file) => ({
    Bucket: file.bucket,
    Key: file.key,
    Body: randomId('Body'),
  }));

  return pMap(
    putObjectParams,
    (params) => awsServices.s3().putObject(params).promise(),
    { concurrency: 10 }
  );
}

/**
 * Index collections to ES for testing
 *
 * @param {Array<Object>} collections - list of collection objects
 * @returns {Promise} - Promise of collections indexed
 */
async function storeCollectionsToElasticsearch(collections) {
  await Promise.all(
    collections.map((collection) => indexer.indexCollection(esClient, collection, esAlias))
  );

  await Promise.all(
    collections.map((collection) => indexer.indexGranule(
      esClient,
      fakeGranuleFactoryV2({
        collectionId: constructCollectionId(collection.name, collection.version),
      }),
      esAlias
    ))
  );
}

/**
 * Index a single collection setting any Date.now() calls to the updatedAt time.
 * @param {Object} collection object
*  @returns {Promise} - promise of indexed collection with active granule.
*/
async function storeDatedCollection(collection) {
  const stub = sinon.stub(Date, 'now').returns(collection.updatedAt);
  try {
    await indexer.indexCollection(esClient, collection, esAlias);
    return indexer.indexGranule(
      esClient,
      fakeGranuleFactoryV2({
        collectionId: constructCollectionId(collection.name, collection.version),
        updatedAt: collection.updatedAt,
      }),
      esAlias
    );
  } finally {
    stub.restore();
  }
}

/**
 * Index Dated collections to ES for testing timeranges.  These need to happen
 * in sequence because of the way we are stubbing Date.now() during indexing.
 *
 * @param {Array<Object>} collections - list of collection objects
 * @returns {Promise} - Promise of collections indexed
 */
async function storeDatedCollectionsToElasticsearch(collections) {
  let result = Promise.resolve();
  collections.forEach((collection) => {
    result = result.then(() => storeDatedCollection(collection));
  });
  return result;
}

/**
 * Index granules to ES for testing
 *
 * @param {Array<Object>} granules - list of granules objects
 * @returns {Promise} - Promise of indexed granules
 */
async function storeGranulesToElasticsearch(granules) {
  await Promise.all(
    granules.map((granule) => indexer.indexGranule(esClient, granule, esAlias))
  );
}

async function fetchCompletedReport(reportRecord) {
  return awsServices.s3()
    .getObject(parseS3Uri(reportRecord.location)).promise()
    .then((response) => response.Body.toString())
    .then(JSON.parse);
}

const randomTimeBetween = (t1, t2) => Math.floor(Math.random() * (t2 - t1 + 1) + t1);

test.before(async () => {
  process.env.cmr_password_secret_name = randomId('cmr-secret-name');
  await awsServices.secretsManager().createSecret({
    Name: process.env.cmr_password_secret_name,
    SecretString: randomId('cmr-password'),
  }).promise();
});

test.beforeEach(async (t) => {
  process.env.CollectionsTable = randomId('collectionTable');
  process.env.GranulesTable = randomId('granulesTable');
  process.env.FilesTable = randomId('filesTable');
  process.env.ReconciliationReportsTable = randomId('reconciliationTable');

  t.context.bucketsToCleanup = [];
  t.context.stackName = randomId('stack');
  t.context.systemBucket = randomId('systembucket');

  await awsServices.s3().createBucket({ Bucket: t.context.systemBucket }).promise()
    .then(() => t.context.bucketsToCleanup.push(t.context.systemBucket));

  await new models.Collection().createTable();
  await new models.Granule().createTable();
  await GranuleFilesCache.createCacheTable();
  await new models.ReconciliationReport().createTable();

  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => []);
  sinon.stub(CMRSearchConceptQueue.prototype, 'peek').callsFake(() => undefined);
  sinon.stub(CMRSearchConceptQueue.prototype, 'shift').callsFake(() => undefined);

  esAlias = randomId('esalias');
  esIndex = randomId('esindex');
  process.env.ES_INDEX = esAlias;
  await bootstrapElasticSearch('fakehost', esIndex, esAlias);
  esClient = await Search.es();
});

test.afterEach.always(async (t) => {
  await Promise.all(
    flatten([
      t.context.bucketsToCleanup.map(recursivelyDeleteS3Bucket),
      new models.Collection().deleteTable(),
      new models.Granule().deleteTable(),
      GranuleFilesCache.deleteCacheTable(),
      new models.ReconciliationReport().deleteTable(),
    ])
  );
  CMR.prototype.searchCollections.restore();
  CMRSearchConceptQueue.prototype.peek.restore();
  CMRSearchConceptQueue.prototype.shift.restore();
  await esClient.indices.delete({ index: esIndex });
});

test.after.always(async () => {
  await awsServices.secretsManager().deleteSecret({
    SecretId: process.env.cmr_password_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  delete process.env.cmr_password_secret_name;
});

test.serial('A valid reconciliation report is generated for no buckets', async (t) => {
  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    [],
    t.context.systemBucket,
    t.context.stackName
  );

  const startTimestamp = new Date(1970, 0, 1);
  const endTimestamp = moment().add(1, 'hour');

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
    startTimestamp,
    endTimestamp,
  };

  const reportRecord = await handler(event, {});

  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, 0);
  t.is(filesInCumulus.onlyInS3.length, 0);
  t.is(filesInCumulus.onlyInDynamoDb.length, 0);

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
  t.is(report.reportStartTime, (new Date(startTimestamp)).toISOString());
  t.is(report.reportEndTime, (new Date(endTimestamp)).toISOString());
});

test.serial('A valid reconciliation report is generated when everything is in sync', async (t) => {
  const dataBuckets = range(2).map(() => randomId('bucket'));
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create random files
  const files = range(10).map((i) => ({
    bucket: dataBuckets[i % dataBuckets.length],
    key: randomId('key'),
    granuleId: randomId('granuleId'),
  }));

  // Store the files to S3 and DynamoDB
  await Promise.all([
    storeFilesToS3(files),
    GranuleFilesCache.batchUpdate({ puts: files }),
  ]);

  // Create collections that are in sync
  const matchingColls = range(10).map(() => ({
    name: randomId('name'),
    version: randomId('vers'),
  }));

  const cmrCollections = sortBy(matchingColls, ['name', 'version'])
    .map((collection) => ({
      umm: { ShortName: collection.name, Version: collection.version },
    }));

  CMR.prototype.searchCollections.restore();
  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => cmrCollections);

  await storeCollectionsToElasticsearch(matchingColls);

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
  t.is(report.status, 'SUCCESS');

  const granuleIds = Object.keys(filesInCumulus.okCountByGranule);
  granuleIds.forEach((granuleId) => {
    const okCountForGranule = filesInCumulus.okCountByGranule[granuleId];
    t.is(okCountForGranule, 1);
  });

  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, files.length);
  t.is(filesInCumulus.onlyInS3.length, 0);
  t.is(filesInCumulus.onlyInDynamoDb.length, 0);
  t.is(collectionsInCumulusCmr.okCount, matchingColls.length);
  t.is(collectionsInCumulusCmr.onlyInCumulus.length, 0);
  t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial('A valid reconciliation report is generated when there are extra internal S3 objects', async (t) => {
  const dataBuckets = range(2).map(() => randomId('bucket'));
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create files that are in sync
  const matchingFiles = range(10).map(() => ({
    bucket: sample(dataBuckets),
    key: randomId('key'),
    granuleId: randomId('granuleId'),
  }));

  const extraS3File1 = { bucket: sample(dataBuckets), key: randomId('key') };
  const extraS3File2 = { bucket: sample(dataBuckets), key: randomId('key') };

  // Store the files to S3 and Elasticsearch
  await storeFilesToS3(matchingFiles.concat([extraS3File1, extraS3File2]));
  await GranuleFilesCache.batchUpdate({ puts: matchingFiles });

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, matchingFiles.length);

  const granuleIds = Object.keys(filesInCumulus.okCountByGranule);
  granuleIds.forEach((granuleId) => {
    const okCountForGranule = filesInCumulus.okCountByGranule[granuleId];
    t.is(okCountForGranule, 1);
  });

  t.is(filesInCumulus.onlyInS3.length, 2);
  t.true(filesInCumulus.onlyInS3.includes(buildS3Uri(extraS3File1.bucket, extraS3File1.key)));
  t.true(filesInCumulus.onlyInS3.includes(buildS3Uri(extraS3File2.bucket, extraS3File2.key)));

  t.is(filesInCumulus.onlyInDynamoDb.length, 0);

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial('A valid reconciliation report is generated when there are extra internal DynamoDB objects', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create files that are in sync
  const matchingFiles = range(10).map(() => ({
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString(),
  }));

  const extraDbFile1 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString(),
  };
  const extraDbFile2 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString(),
  };

  // Store the files to S3 and DynamoDB
  await storeFilesToS3(matchingFiles);
  await GranuleFilesCache.batchUpdate({
    puts: matchingFiles.concat([extraDbFile1, extraDbFile2]),
  });

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, matchingFiles.length);
  t.is(filesInCumulus.onlyInS3.length, 0);

  const totalOkCount = Object.values(filesInCumulus.okCountByGranule).reduce(
    (total, currentOkCount) => total + currentOkCount
  );
  t.is(totalOkCount, filesInCumulus.okCount);

  t.is(filesInCumulus.onlyInDynamoDb.length, 2);
  t.truthy(filesInCumulus.onlyInDynamoDb.find((f) =>
    f.uri === buildS3Uri(extraDbFile1.bucket, extraDbFile1.key)
    && f.granuleId === extraDbFile1.granuleId));
  t.truthy(filesInCumulus.onlyInDynamoDb.find((f) =>
    f.uri === buildS3Uri(extraDbFile2.bucket, extraDbFile2.key)
    && f.granuleId === extraDbFile2.granuleId));

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial('A valid reconciliation report is generated when internally, there are both extra DynamoDB and extra S3 files', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create files that are in sync
  const matchingFiles = range(10).map(() => ({
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString(),
  }));

  const extraS3File1 = { bucket: sample(dataBuckets), key: randomString() };
  const extraS3File2 = { bucket: sample(dataBuckets), key: randomString() };
  const extraDbFile1 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString(),
  };
  const extraDbFile2 = {
    bucket: sample(dataBuckets),
    key: randomString(),
    granuleId: randomString(),
  };

  // Store the files to S3 and DynamoDB
  await storeFilesToS3(matchingFiles.concat([extraS3File1, extraS3File2]));
  await GranuleFilesCache.batchUpdate({
    puts: matchingFiles.concat([extraDbFile1, extraDbFile2]),
  });

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const filesInCumulus = report.filesInCumulus;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(filesInCumulus.okCount, matchingFiles.length);

  const totalOkCount = Object.values(filesInCumulus.okCountByGranule).reduce(
    (total, currentOkCount) => total + currentOkCount
  );
  t.is(totalOkCount, filesInCumulus.okCount);

  t.is(filesInCumulus.onlyInS3.length, 2);
  t.true(filesInCumulus.onlyInS3.includes(buildS3Uri(extraS3File1.bucket, extraS3File1.key)));
  t.true(filesInCumulus.onlyInS3.includes(buildS3Uri(extraS3File2.bucket, extraS3File2.key)));

  t.is(filesInCumulus.onlyInDynamoDb.length, 2);
  t.truthy(filesInCumulus.onlyInDynamoDb.find((f) =>
    f.uri === buildS3Uri(extraDbFile1.bucket, extraDbFile1.key)
    && f.granuleId === extraDbFile1.granuleId));
  t.truthy(filesInCumulus.onlyInDynamoDb.find((f) =>
    f.uri === buildS3Uri(extraDbFile2.bucket, extraDbFile2.key)
    && f.granuleId === extraDbFile2.granuleId));

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial('A valid reconciliation report is generated when there are both extra ES and CMR collections', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // Create collections that are in sync
  const matchingCollLength = 35;
  const matchingColls = range(matchingCollLength).map((r) => ({
    name: randomId(`name${r}-`),
    version: randomId('vers'),
  }));

  const onlyInDbLength = 5;
  const extraDbColls = range(onlyInDbLength).map((r) => ({
    name: randomId(`extraDb${r}-`),
    version: randomId('vers'),
  }));
  const onlyInCmrLength = 25;
  const extraCmrColls = range(onlyInCmrLength).map((r) => ({
    name: randomId(`extraCmr${r}-`),
    version: randomId('vers'),
  }));

  const cmrCollections = sortBy(matchingColls.concat(extraCmrColls), ['name', 'version'])
    .map((collection) => ({
      umm: { ShortName: collection.name, Version: collection.version },
    }));

  CMR.prototype.searchCollections.restore();
  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => cmrCollections);

  await storeCollectionsToElasticsearch(matchingColls.concat(extraDbColls));

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Generated');

  const report = await fetchCompletedReport(reportRecord);
  const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
  t.is(report.status, 'SUCCESS');
  t.is(report.error, undefined);
  t.is(collectionsInCumulusCmr.okCount, matchingColls.length);

  t.is(collectionsInCumulusCmr.onlyInCumulus.length, onlyInDbLength);
  extraDbColls.map((collection) =>
    t.true(collectionsInCumulusCmr.onlyInCumulus
      .includes(constructCollectionId(collection.name, collection.version))));

  t.is(collectionsInCumulusCmr.onlyInCmr.length, onlyInCmrLength);
  extraCmrColls.map((collection) =>
    t.true(collectionsInCumulusCmr.onlyInCmr
      .includes(constructCollectionId(collection.name, collection.version))));

  const createStartTime = moment(report.createStartTime);
  const createEndTime = moment(report.createEndTime);
  t.true(createStartTime <= createEndTime);
});

test.serial(
  'A valid reconciliation report is generated with input TimeParams and there are extra cumulus/ES and CMR collections',
  async (t) => {
    const dataBuckets = range(2).map(() => randomString());
    await Promise.all(
      dataBuckets.map((bucket) =>
        createBucket(bucket)
          .then(() => t.context.bucketsToCleanup.push(bucket)))
    );
    // Write the buckets config to S3
    await storeBucketsConfigToS3(
      dataBuckets,
      t.context.systemBucket,
      t.context.stackName
    );

    const startTimestamp = new Date('2020-06-01T00:00:00.000Z').getTime();
    const monthEarlier = moment(startTimestamp).subtract(1, 'month').valueOf();
    const endTimestamp = new Date('2020-07-01T00:00:00.000Z').getTime();
    const monthLater = moment(endTimestamp).add(1, 'month').valueOf();

    // Create collections that are in sync during the time period
    const matchingCollsLength = 15;
    const matchingColls = range(matchingCollsLength).map((r) => ({
      name: randomId(`name${r}-`),
      version: randomId('vers'),
      updatedAt: randomTimeBetween(startTimestamp, endTimestamp),
    }));

    const matchingCollOutsideRangeLength = 19;
    const matchingCollsOutsideRange = range(matchingCollOutsideRangeLength).map((r) => ({
      name: randomId(`name${r}-`),
      version: randomId('vers'),
      updatedAt: randomTimeBetween(monthEarlier, startTimestamp - 1),
    }));

    const onlyInDbLength = 11;
    const extraDbColls = range(onlyInDbLength).map((r) => ({
      name: randomId(`extraDb${r}-`),
      version: randomId('vers'),
      updatedAt: randomTimeBetween(startTimestamp, endTimestamp),
    }));

    const onlyInDbOutOfRangeLength = 14;
    const extraDbCollsOutOfRange = range(onlyInDbOutOfRangeLength).map((r) => ({
      name: randomId(`extraDb${r}-`),
      version: randomId('vers'),
      updatedAt: randomTimeBetween(endTimestamp + 1, monthLater),
    }));

    const onlyInCmrLength = 18;
    const extraCmrColls = range(onlyInCmrLength).map((r) => ({
      name: randomId(`extraCmr${r}-`),
      version: randomId('vers'),
      updatedAt: randomTimeBetween(startTimestamp, endTimestamp),
    }));

    const cmrCollections = sortBy(matchingColls.concat(matchingCollsOutsideRange).concat(extraCmrColls), ['name', 'version'])
      .map((collection) => ({
        umm: { ShortName: collection.name, Version: collection.version },
      }));

    CMR.prototype.searchCollections.restore();
    sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => cmrCollections);

    await storeDatedCollectionsToElasticsearch(
      matchingColls
        .concat(matchingCollsOutsideRange)
        .concat(extraDbColls)
        .concat(extraDbCollsOutOfRange)
    );

    const event = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
      startTimestamp,
      endTimestamp,
    };

    const reportRecord = await handler(event);
    t.is(reportRecord.status, 'Generated');

    const report = await fetchCompletedReport(reportRecord);
    const collectionsInCumulusCmr = report.collectionsInCumulusCmr;
    t.is(report.status, 'SUCCESS');
    t.is(report.error, undefined);
    t.is(collectionsInCumulusCmr.okCount, matchingCollsLength);

    t.is(collectionsInCumulusCmr.onlyInCumulus.length, onlyInDbLength);
    extraDbColls.map((collection) =>
      t.true(collectionsInCumulusCmr.onlyInCumulus
        .includes(constructCollectionId(collection.name, collection.version))));

    extraDbCollsOutOfRange.map((collection) =>
      t.false(collectionsInCumulusCmr.onlyInCumulus
        .includes(constructCollectionId(collection.name, collection.version))));

    // One Way only comparison
    t.is(collectionsInCumulusCmr.onlyInCmr.length, 0);
    extraCmrColls.map((collection) =>
      t.false(collectionsInCumulusCmr.onlyInCmr
        .includes(constructCollectionId(collection.name, collection.version))));

    const createStartTime = moment(report.createStartTime);
    const createEndTime = moment(report.createEndTime);
    t.true(createStartTime <= createEndTime);

    const reportStartTime = report.reportStartTime;
    const reportEndTime = report.reportEndTime;
    t.is(
      (new Date(reportStartTime)).valueOf(),
      startTimestamp
    );
    t.is(
      (new Date(reportEndTime)).valueOf(),
      endTimestamp
    );

    // Since we already have all of the ES and CMR Seeded, verify that running
    // without timeRanges provides the expected data as well.
    const eventNoTimeStamps = {
      systemBucket: t.context.systemBucket,
      stackName: t.context.stackName,
    };

    const reportNoTimeRecord = await handler(eventNoTimeStamps);
    t.is(reportNoTimeRecord.status, 'Generated');

    const newReport = await fetchCompletedReport(reportNoTimeRecord);
    const newCollectionsInCumulusCmr = newReport.collectionsInCumulusCmr;
    t.is(newReport.status, 'SUCCESS');
    t.is(newReport.error, undefined);
    t.is(
      newCollectionsInCumulusCmr.okCount, matchingCollsLength + matchingCollOutsideRangeLength
    );
    t.is(
      newCollectionsInCumulusCmr.onlyInCumulus.length, onlyInDbLength + onlyInDbOutOfRangeLength
    );
    extraDbColls.map((collection) =>
      t.true(newCollectionsInCumulusCmr.onlyInCumulus
        .includes(constructCollectionId(collection.name, collection.version))));

    extraDbCollsOutOfRange.map((collection) =>
      t.true(newCollectionsInCumulusCmr.onlyInCumulus
        .includes(constructCollectionId(collection.name, collection.version))));

    t.is(newCollectionsInCumulusCmr.onlyInCmr.length, onlyInCmrLength);
    extraCmrColls.map((collection) =>
      t.true(newCollectionsInCumulusCmr.onlyInCmr
        .includes(constructCollectionId(collection.name, collection.version))));

    const newCreateStartTime = moment(newReport.createStartTime);
    const newCreateEndTime = moment(newReport.createEndTime);
    t.true(newCreateStartTime <= newCreateEndTime);

    t.is(newReport.reportEndTime, undefined);
    t.is(newReport.reportStartTime, undefined);
  }
);

test.serial('reconciliationReportForGranules reports discrepancy of granule holdings in CUMULUS and CMR', async (t) => {
  const shortName = randomString();
  const version = randomString();
  const collectionId = constructCollectionId(shortName, version);

  // create granules that are in sync
  const matchingGrans = range(10).map(() =>
    fakeGranuleFactoryV2({ collectionId: collectionId, status: 'completed', files: [] }));

  const extraDbGrans = range(2).map(() =>
    fakeGranuleFactoryV2({ collectionId: collectionId, status: 'completed', files: [] }));

  const extraCmrGrans = range(2).map(() => ({
    granuleId: randomString(),
    collectionId: collectionId,
  }));

  const cmrGranules = sortBy(matchingGrans.concat(extraCmrGrans), ['granuleId']).map((granule) => ({
    umm: {
      GranuleUR: granule.granuleId,
      CollectionReference: { ShortName: shortName, Version: version },
      RelatedUrls: [],
    },
  }));

  CMRSearchConceptQueue.prototype.peek.restore();
  CMRSearchConceptQueue.prototype.shift.restore();
  sinon.stub(CMRSearchConceptQueue.prototype, 'peek').callsFake(() => cmrGranules[0]);
  sinon.stub(CMRSearchConceptQueue.prototype, 'shift').callsFake(() => cmrGranules.shift());

  await storeGranulesToElasticsearch(matchingGrans.concat(extraDbGrans));

  const { granulesReport, filesReport } = await reconciliationReportForGranules({
    collectionId,
    bucketsConfig: new BucketsConfig({}),
    distributionBucketMap: {},
    recReportParams: {},
  });

  t.is(granulesReport.okCount, 10);

  const expectedOnlyInCumulus = sortBy(extraDbGrans, ['granuleId']).map((gran) =>
    ({ granuleId: gran.granuleId, collectionId: gran.collectionId }));
  t.deepEqual(granulesReport.onlyInCumulus, expectedOnlyInCumulus);

  t.deepEqual(granulesReport.onlyInCmr.map((gran) => gran.GranuleUR),
    extraCmrGrans.map((gran) => gran.granuleId).sort());

  t.is(filesReport.okCount, 0);
  t.is(filesReport.onlyInCumulus.length, 0);
  t.is(filesReport.onlyInCmr.length, 0);
});

test.serial('reconciliationReportForGranuleFiles reports discrepancy of granule file holdings in CUMULUS and CMR', async (t) => {
  process.env.DISTRIBUTION_ENDPOINT = 'https://example.com/';
  const buckets = {
    internal: { name: 'cumulus-test-sandbox-internal', type: 'internal' },
    private: { name: 'testbucket-private', type: 'private' },
    protected: { name: 'testbucket-protected', type: 'protected' },
    public: { name: 'testbucket-public', type: 'public' },
    'protected-2': { name: 'testbucket-protected-2', type: 'protected' },
  };
  const bucketsConfig = new BucketsConfig(buckets);
  const distributionBucketMap = createDistributionBucketMapFromBuckets(buckets);

  const matchingFilesInDb = [{
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    size: 17865615,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
  },
  {
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
  },
  {
    bucket: 'testbucket-protected-2',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    size: 2708,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
  }];

  const privateFilesInDb = [{
    bucket: 'testbucket-private',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
  }];

  const filesOnlyInDb = [{
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/extra123.jpg',
    size: 44118,
    fileName: 'extra123.jpg',
  },
  {
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/MOD/extra456.jpg',
    size: 44118,
    fileName: 'extra456.jpg',
  }];

  const granuleInDb = {
    granuleId: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    collectionId: 'MOD09GQ___006',
    files: matchingFilesInDb.concat(privateFilesInDb).concat(filesOnlyInDb),
  };

  const matchingFilesInCmr = [{
    URL: `${process.env.DISTRIBUTION_ENDPOINT}testbucket-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf`,
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: `${process.env.DISTRIBUTION_ENDPOINT}testbucket-public/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg`,
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: `${process.env.DISTRIBUTION_ENDPOINT}testbucket-protected-2/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml`,
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const filesOnlyInCmr = [{
    URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const urlsShouldOnlyInCmr = [{
    URL: `${process.env.DISTRIBUTION_ENDPOINT}s3credentials`,
    Type: 'VIEW RELATED INFORMATION',
    Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
  }];

  const granuleInCmr = {
    GranuleUR: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    ShortName: 'MOD09GQ',
    Version: '006',
    RelatedUrls: matchingFilesInCmr.concat(filesOnlyInCmr).concat(urlsShouldOnlyInCmr),
  };
  const report = await reconciliationReportForGranuleFiles({
    granuleInDb,
    granuleInCmr,
    bucketsConfig,
    distributionBucketMap,
  });
  t.is(report.okCount, matchingFilesInDb.length + privateFilesInDb.length);

  t.is(report.onlyInCumulus.length, filesOnlyInDb.length);
  t.deepEqual(map(report.onlyInCumulus, 'fileName').sort(), map(filesOnlyInDb, 'fileName').sort());

  t.is(report.onlyInCmr.length, filesOnlyInCmr.length);
  t.deepEqual(map(report.onlyInCmr, 'URL').sort(), map(filesOnlyInCmr, 'URL').sort());
});

test.serial('reconciliationReportForGranuleFiles reports discrepancy of granule file holdings in CUMULUS and CMR that have S3 links', async (t) => {
  process.env.DISTRIBUTION_ENDPOINT = 'https://example.com/';
  const buckets = {
    internal: { name: 'cumulus-test-sandbox-internal', type: 'internal' },
    private: { name: 'testbucket-private', type: 'private' },
    protected: { name: 'testbucket-protected', type: 'protected' },
    public: { name: 'testbucket-public', type: 'public' },
    'protected-2': { name: 'testbucket-protected-2', type: 'protected' },
  };
  const bucketsConfig = new BucketsConfig(buckets);
  const distributionBucketMap = createDistributionBucketMapFromBuckets(buckets);
  const matchingFilesInDb = [{
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    size: 17865615,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
  },
  {
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
  },
  {
    bucket: 'testbucket-protected-2',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    size: 2708,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
  }];

  const privateFilesInDb = [{
    bucket: 'testbucket-private',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
  }];

  const filesOnlyInDb = [{
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/extra123.jpg',
    size: 44118,
    fileName: 'extra123.jpg',
  },
  {
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/MOD/extra456.jpg',
    size: 44118,
    fileName: 'extra456.jpg',
  }];

  const granuleInDb = {
    granuleId: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    collectionId: 'MOD09GQ___006',
    files: matchingFilesInDb.concat(privateFilesInDb).concat(filesOnlyInDb),
  };

  const matchingFilesInCmr = [{
    URL: 's3://testbucket-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: 's3://testbucket-public/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: `${process.env.DISTRIBUTION_ENDPOINT}testbucket-protected-2/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml`,
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const filesOnlyInCmr = [{
    URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const urlsShouldOnlyInCmr = [{
    URL: `${process.env.DISTRIBUTION_ENDPOINT}s3credentials`,
    Type: 'VIEW RELATED INFORMATION',
    Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
  }];

  const granuleInCmr = {
    GranuleUR: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    ShortName: 'MOD09GQ',
    Version: '006',
    RelatedUrls: matchingFilesInCmr.concat(filesOnlyInCmr).concat(urlsShouldOnlyInCmr),
  };

  const report = await reconciliationReportForGranuleFiles({
    granuleInDb,
    granuleInCmr,
    bucketsConfig,
    distributionBucketMap,
  });

  t.is(report.okCount, matchingFilesInDb.length + privateFilesInDb.length);

  t.is(report.onlyInCumulus.length, filesOnlyInDb.length);
  t.deepEqual(map(report.onlyInCumulus, 'fileName').sort(), map(filesOnlyInDb, 'fileName').sort());

  t.is(report.onlyInCmr.length, filesOnlyInCmr.length);
  t.deepEqual(map(report.onlyInCmr, 'URL').sort(), map(filesOnlyInCmr, 'URL').sort());
});

test.serial('reconciliationReportForGranuleFiles does not fail if no distribution endpoint is defined', async (t) => {
  const buckets = {
    internal: { name: 'cumulus-test-sandbox-internal', type: 'internal' },
    private: { name: 'testbucket-private', type: 'private' },
    protected: { name: 'testbucket-protected', type: 'protected' },
    public: { name: 'testbucket-public', type: 'public' },
    'protected-2': { name: 'testbucket-protected-2', type: 'protected' },
  };
  const bucketsConfig = new BucketsConfig(buckets);
  const distributionBucketMap = createDistributionBucketMapFromBuckets(buckets);

  const matchingFilesInDb = [{
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    size: 17865615,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
  },
  {
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
  },
  {
    bucket: 'testbucket-protected-2',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    size: 2708,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
  }];

  const privateFilesInDb = [{
    bucket: 'testbucket-private',
    key: 'MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
    size: 44118,
    fileName: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf.met',
  }];

  const filesOnlyInDb = [{
    bucket: 'testbucket-public',
    key: 'MOD09GQ___006/MOD/extra123.jpg',
    size: 44118,
    fileName: 'extra123.jpg',
  },
  {
    bucket: 'testbucket-protected',
    key: 'MOD09GQ___006/MOD/extra456.jpg',
    size: 44118,
    fileName: 'extra456.jpg',
  }];

  const granuleInDb = {
    granuleId: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    collectionId: 'MOD09GQ___006',
    files: matchingFilesInDb.concat(privateFilesInDb).concat(filesOnlyInDb),
  };

  const matchingFilesInCmr = [{
    URL: 's3://testbucket-protected/MOD09GQ___006/2017/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: 's3://testbucket-public/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190_ndvi.jpg',
    Type: 'GET DATA',
    Description: 'File to download',
  },
  {
    URL: 's3://testbucket-protected-2/MOD09GQ___006/MOD/MOD09GQ.A4675287.SWPE5_.006.7310007729190.cmr.xml',
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const filesOnlyInCmr = [{
    URL: 'https://enjo7p7os7.execute-api.us-east-1.amazonaws.com/dev/MYD13Q1.A2017297.h19v10.006.2017313221202.hdf',
    Type: 'GET DATA',
    Description: 'File to download',
  }];

  const urlsShouldOnlyInCmr = [{
    URL: `${process.env.DISTRIBUTION_ENDPOINT}s3credentials`,
    Type: 'VIEW RELATED INFORMATION',
    Description: 'api endpoint to retrieve temporary credentials valid for same-region direct s3 access',
  }];

  const granuleInCmr = {
    GranuleUR: 'MOD09GQ.A4675287.SWPE5_.006.7310007729190',
    ShortName: 'MOD09GQ',
    Version: '006',
    RelatedUrls: matchingFilesInCmr.concat(filesOnlyInCmr).concat(urlsShouldOnlyInCmr),
  };

  const report = await reconciliationReportForGranuleFiles({
    granuleInDb, granuleInCmr, bucketsConfig, distributionBucketMap,
  });
  t.is(report.okCount, matchingFilesInDb.length + privateFilesInDb.length);

  t.is(report.onlyInCumulus.length, filesOnlyInDb.length);
  t.deepEqual(map(report.onlyInCumulus, 'fileName').sort(), map(filesOnlyInDb, 'fileName').sort());

  t.is(report.onlyInCmr.length, filesOnlyInCmr.length);
  t.deepEqual(map(report.onlyInCmr, 'URL').sort(), map(filesOnlyInCmr, 'URL').sort());
});

test.serial('When report creation fails, reconciliation report status is set to Failed with error', async (t) => {
  const dataBuckets = range(2).map(() => randomString());
  await Promise.all(dataBuckets.map((bucket) =>
    createBucket(bucket)
      .then(() => t.context.bucketsToCleanup.push(bucket))));

  // Write the buckets config to S3
  await storeBucketsConfigToS3(
    dataBuckets,
    t.context.systemBucket,
    t.context.stackName
  );

  // create an error case
  CMR.prototype.searchCollections.restore();
  sinon.stub(CMR.prototype, 'searchCollections').callsFake(() => {
    throw new Error('test error');
  });

  const event = {
    systemBucket: t.context.systemBucket,
    stackName: t.context.stackName,
  };

  const reportRecord = await handler(event);
  t.is(reportRecord.status, 'Failed');
  t.truthy(reportRecord.error);
});
