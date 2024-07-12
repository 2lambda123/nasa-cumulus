const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const awsServices = require('@cumulus/aws-client/services');
const s3Utils = require('@cumulus/aws-client/S3');

const {
  getExecutionProcessingTimeInfo,
  moveGranuleFilesAndUpdateDatastore,
} = require('../../lib/granules');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');

const { fakeFileFactory } = require('../../lib/testUtils');

const { getFilesExistingAtLocation } = require('../../lib/granules');

const sandbox = sinon.createSandbox();
const FakeEsClient = sandbox.stub();
const esSearchStub = sandbox.stub();
const esScrollStub = sandbox.stub();
FakeEsClient.prototype.scroll = esScrollStub;
FakeEsClient.prototype.search = esSearchStub;

const { getGranulesForPayload, translateGranule } = proxyquire(
  '../../lib/granules',
  {
    '@cumulus/es-client/search': {
      getEsClient: () => Promise.resolve({
        initializeEsClient: () => Promise.resolve(),
        client: {
          search: esSearchStub,
          scroll: esScrollStub,
        },
      }),
    },
  }
);

test.afterEach.always(() => {
  sandbox.resetHistory();
});

test.after.always(() => {
  sandbox.restore();
});

test('files existing at location returns empty array if no files exist', async (t) => {
  const filenames = ['granule-file-1.hdf', 'granule-file-2.hdf'];

  const sourceBucket = 'test-bucket';
  const destBucket = 'dest-bucket';

  const sourceFiles = filenames.map((name) =>
    fakeFileFactory({
      name,
      bucket: sourceBucket,
      key: `origin/${name}`,
    }));

  const destinationFilepath = 'destination';

  const destinations = [
    {
      regex: '.*.hdf$',
      bucket: destBucket,
      key: destinationFilepath,
    },
  ];

  const granule = {
    files: sourceFiles,
  };

  const filesExisting = await getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, []);
});

test('files existing at location returns both files if both exist', async (t) => {
  const filenames = ['granule-file-1.hdf', 'granule-file-2.hdf'];

  const sourceBucket = 'test-bucket';
  const destBucket = randomString();

  await awsServices.s3().createBucket({ Bucket: destBucket });

  const sourceFiles = filenames.map((fileName) =>
    fakeFileFactory({ fileName, bucket: sourceBucket }));

  const destinations = [
    {
      regex: '.*.hdf$',
      bucket: destBucket,
    },
  ];

  const dataSetupPromises = filenames.map(async (filename) => {
    const params = {
      Bucket: destBucket,
      Key: filename,
      Body: 'test',
    };
    return await awsServices.s3().putObject(params);
  });

  await Promise.all(dataSetupPromises);

  const granule = {
    files: sourceFiles,
  };

  const filesExisting = await getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, sourceFiles);

  await s3Utils.recursivelyDeleteS3Bucket(destBucket);
});

test('files existing at location returns only file that exists', async (t) => {
  const filenames = ['granule-file-1.hdf', 'granule-file-2.hdf'];

  const sourceBucket = 'test-bucket';
  const destBucket = randomString();

  await awsServices.s3().createBucket({ Bucket: destBucket });

  const sourceFiles = filenames.map((fileName) =>
    fakeFileFactory({ fileName, bucket: sourceBucket }));

  const destinations = [
    {
      regex: '.*.hdf$',
      bucket: destBucket,
      filepath: '',
    },
  ];

  const params = {
    Bucket: destBucket,
    Key: filenames[1],
    Body: 'test',
  };
  await awsServices.s3().putObject(params);

  const granule = {
    files: sourceFiles,
  };

  const filesExisting = await getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, [sourceFiles[1]]);

  await s3Utils.recursivelyDeleteS3Bucket(destBucket);
});

test('files existing at location returns only file that exists with multiple destinations', async (t) => {
  const filenames = ['granule-file-1.txt', 'granule-file-2.hdf'];

  const sourceBucket = 'test-bucket';
  const destBucket1 = randomString();
  const destBucket2 = randomString();

  await Promise.all([
    awsServices.s3().createBucket({ Bucket: destBucket1 }),
    awsServices.s3().createBucket({ Bucket: destBucket2 }),
  ]);

  const sourceFiles = filenames.map((fileName) =>
    fakeFileFactory({ fileName, bucket: sourceBucket }));

  const destinations = [
    {
      regex: '.*.txt$',
      bucket: destBucket1,
      filepath: '',
    },
    {
      regex: '.*.hdf$',
      bucket: destBucket2,
      filepath: '',
    },
  ];

  let params = {
    Bucket: destBucket1,
    Key: filenames[0],
    Body: 'test',
  };
  await awsServices.s3().putObject(params);

  params = {
    Bucket: destBucket2,
    Key: filenames[1],
    Body: 'test',
  };
  await awsServices.s3().putObject(params);

  const granule = {
    files: sourceFiles,
  };

  const filesExisting = await getFilesExistingAtLocation(granule, destinations);

  t.deepEqual(filesExisting, sourceFiles);

  await Promise.all([
    s3Utils.recursivelyDeleteS3Bucket(destBucket1),
    s3Utils.recursivelyDeleteS3Bucket(destBucket2),
  ]);
});

test('getExecutionProcessingTimeInfo() returns empty object if startDate is not provided', (t) => {
  t.deepEqual(getExecutionProcessingTimeInfo({}), {});
});

test('getExecutionProcessingTimeInfo() returns correct object if stopDate is provided', (t) => {
  const startDate = new Date();
  const stopDate = new Date();
  t.deepEqual(
    getExecutionProcessingTimeInfo({
      startDate,
      stopDate,
    }),
    {
      processingStartDateTime: startDate.toISOString(),
      processingEndDateTime: stopDate.toISOString(),
    }
  );
});

test('getExecutionProcessingTimeInfo() returns correct object if stopDate is not provided', (t) => {
  const startDate = new Date();
  const now = new Date();
  t.deepEqual(
    getExecutionProcessingTimeInfo({
      startDate,
      now,
    }),
    {
      processingStartDateTime: startDate.toISOString(),
      processingEndDateTime: now.toISOString(),
    }
  );
});

test('moveGranuleFilesAndUpdateDatastore throws if granulePgModel.getRecordCumulusId throws unexpected error', async (t) => {
  const updateStub = sinon.stub().returns(Promise.resolve());
  const granulesModel = {
    update: updateStub,
  };

  const granulePgModel = {
    getRecordCumulusId: () => {
      const thrownError = new Error('Test error');
      thrownError.name = 'TestError';
      return Promise.reject(thrownError);
    },
  };

  const collectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(1),
  };

  await t.throwsAsync(
    moveGranuleFilesAndUpdateDatastore({
      apiGranule: {},
      granulesModel,
      destinations: undefined,
      granulePgModel,
      collectionPgModel,
      dbClient: {},
    })
  );
});

test('getGranulesForPayload returns unique granules from payload', async (t) => {
  const granuleId1 = randomId('granule');
  const granuleId2 = randomId('granule');
  const collectionId1 = randomId('collection');
  const collectionId2 = randomId('collection');
  const granules = [
    { granuleId: granuleId1, collectionId: collectionId1 },
    { granuleId: granuleId1, collectionId: collectionId1 },
    { granuleId: granuleId1, collectionId: collectionId2 },
    { granuleId: granuleId2, collectionId: collectionId2 },
  ];
  const returnedGranules = await getGranulesForPayload({
    granules,
  });
  t.deepEqual(
    returnedGranules.sort(),
    [
      { granuleId: granuleId1, collectionId: collectionId1 },
      { granuleId: granuleId1, collectionId: collectionId2 },
      { granuleId: granuleId2, collectionId: collectionId2 },
    ].sort()
  );
});

test('translateGranule() will translate an old-style granule file and numeric productVolume into the new schema', async (t) => {
  const oldFile = {
    bucket: 'my-bucket',
    filename: 's3://my-bucket/path/to/file.txt',
    filepath: 'path/to/file.txt',
    name: 'file123.txt',
    path: 'source/path',
    checksumType: 'my-checksumType',
    checksumValue: 'my-checksumValue',
    url_path: 'some-url-path',
    fileSize: 1234,
  };

  const oldProductVolume = 20;
  const granule = fakeGranuleFactoryV2({ files: [oldFile], productVolume: oldProductVolume });
  const translatedGranule = await translateGranule(granule);

  t.deepEqual(translatedGranule.files[0], {
    bucket: 'my-bucket',
    key: 'path/to/file.txt',
    fileName: 'file123.txt',
    checksumType: 'my-checksumType',
    checksum: 'my-checksumValue',
    size: 1234,
  });
  t.is(translatedGranule.productVolume, oldProductVolume.toString());
});
