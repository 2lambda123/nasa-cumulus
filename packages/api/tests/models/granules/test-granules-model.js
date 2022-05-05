'use strict';

const test = require('ava');
const sinon = require('sinon');

const awsServices = require('@cumulus/aws-client/services');
const StepFunctions = require('@cumulus/aws-client/StepFunctions');
const launchpad = require('@cumulus/launchpad-auth');
const { randomString } = require('@cumulus/common/test-utils');
const { CMR } = require('@cumulus/cmr-client');
const { DefaultProvider } = require('@cumulus/common/key-pair-provider');

const Granule = require('../../../models/granules');
const { fakeFileFactory, fakeGranuleFactoryV2 } = require('../../../lib/testUtils');

let fakeExecution;
let testCumulusMessage;
let sandbox;

test.before(async () => {
  process.env.GranulesTable = randomString();
  await new Granule().createTable();

  testCumulusMessage = {
    cumulus_meta: {
      execution_name: randomString(),
      state_machine: 'arn:aws:states:us-east-1:123456789012:stateMachine:HelloStateMachine',
      workflow_start_time: Date.now(),
    },
    meta: {
      collection: {
        name: randomString(),
        version: randomString(),
      },
      provider: {
        host: randomString(),
        protocol: 's3',
      },
      status: 'completed',
    },
    payload: {
      granules: [
        {
          granuleId: randomString(),
          sync_granule_duration: 123,
          post_to_cmr_duration: 456,
          files: [],
        },
      ],
    },
  };

  sandbox = sinon.createSandbox();

  fakeExecution = {
    input: JSON.stringify(testCumulusMessage),
    startDate: new Date(Date.UTC(2019, 6, 28)),
    stopDate: new Date(Date.UTC(2019, 6, 28, 1)),
  };
  sandbox.stub(StepFunctions, 'describeExecution').resolves(fakeExecution);

  // Store the CMR password
  process.env.cmr_password_secret_name = randomString();
  await awsServices.secretsManager().createSecret({
    Name: process.env.cmr_password_secret_name,
    SecretString: randomString(),
  }).promise();

  // Store the launchpad passphrase
  process.env.launchpad_passphrase_secret_name = randomString();
  await awsServices.secretsManager().createSecret({
    Name: process.env.launchpad_passphrase_secret_name,
    SecretString: randomString(),
  }).promise();
});

test.beforeEach((t) => {
  t.context.granuleModel = new Granule();
});

test.after.always(async () => {
  await awsServices.secretsManager().deleteSecret({
    SecretId: process.env.cmr_password_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  await awsServices.secretsManager().deleteSecret({
    SecretId: process.env.launchpad_passphrase_secret_name,
    ForceDeleteWithoutRecovery: true,
  }).promise();
  await new Granule().deleteTable();
  sandbox.restore();
});

test('get() will translate an old-style granule file into the new schema', async (t) => {
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

  const granule = fakeGranuleFactoryV2({ files: [oldFile] });

  await awsServices.dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule,
  });

  const granuleModel = new Granule();
  const fetchedGranule = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedGranule.files[0],
    {
      bucket: 'my-bucket',
      key: 'path/to/file.txt',
      fileName: 'file123.txt',
      checksumType: 'my-checksumType',
      checksum: 'my-checksumValue',
      size: 1234,
    }
  );
});

test('get() will correctly return a granule file stored using the new schema', async (t) => {
  const newFile = {
    bucket: 'my-bucket',
    key: 'path/to/file.txt',
    fileName: 'file123.txt',
    checksumType: 'my-checksumType',
    checksum: 'my-checksumValue',
    size: 1234,
  };

  const granule = fakeGranuleFactoryV2({ files: [newFile] });

  await awsServices.dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule,
  });

  const granuleModel = new Granule();
  const fetchedGranule = await granuleModel.get({ granuleId: granule.granuleId });

  t.deepEqual(
    fetchedGranule.files[0],
    {
      bucket: 'my-bucket',
      key: 'path/to/file.txt',
      fileName: 'file123.txt',
      checksumType: 'my-checksumType',
      checksum: 'my-checksumValue',
      size: 1234,
    }
  );
});

test('getRecord() returns a granule record from the database', async (t) => {
  const granule = fakeGranuleFactoryV2();

  await awsServices.dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule,
  });

  const granuleModel = new Granule();

  const fetchedGranule = await granuleModel.getRecord({
    granuleId: granule.granuleId,
  });

  t.is(fetchedGranule.granuleId, granule.granuleId);
});

test('batchGet() will translate old-style granule files into the new schema', async (t) => {
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

  const granule = fakeGranuleFactoryV2({ files: [oldFile] });

  await awsServices.dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule,
  });

  const granuleModel = new Granule();
  const batchGetResponse = await granuleModel.batchGet([
    { granuleId: granule.granuleId },
  ]);

  const fetchedGranule = batchGetResponse.Responses[process.env.GranulesTable][0];

  t.deepEqual(
    fetchedGranule.files[0],
    {
      bucket: 'my-bucket',
      key: 'path/to/file.txt',
      fileName: 'file123.txt',
      checksumType: 'my-checksumType',
      checksum: 'my-checksumValue',
      size: 1234,
    }
  );
});

test('scan() will translate old-style granule files into the new schema', async (t) => {
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

  const granule = fakeGranuleFactoryV2({ files: [oldFile] });

  await awsServices.dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule,
  });

  const granuleModel = new Granule();
  const scanResponse = await granuleModel.scan({
    names: { '#granuleId': 'granuleId' },
    filter: '#granuleId = :granuleId',
    values: { ':granuleId': granule.granuleId },
  });

  t.deepEqual(
    scanResponse.Items[0].files[0],
    {
      bucket: 'my-bucket',
      key: 'path/to/file.txt',
      fileName: 'file123.txt',
      checksumType: 'my-checksumType',
      checksum: 'my-checksumValue',
      size: 1234,
    }
  );
});

test('granuleAttributeScan() returns granules filtered by search params', async (t) => {
  const { granuleModel } = t.context;

  const collectionId = randomString();
  const provider = randomString();
  const status = 'running';
  const granules = [
    fakeGranuleFactoryV2({ collectionId, status }),
    fakeGranuleFactoryV2({ collectionId, status, provider }),
    fakeGranuleFactoryV2({ granuleId: 'test123', collectionId, status }),
    fakeGranuleFactoryV2({ collectionId, status: 'completed' }),
    fakeGranuleFactoryV2({ collectionId: randomString(), status: 'completed' }),
  ];
  await granuleModel.create(granules);

  const searchParams = {
    collectionId,
    status,
    updatedAt__from: Date.now() - 1000 * 30,
    updatedAt__to: Date.now(),
  };
  let granulesQueue = await granuleModel.granuleAttributeScan(searchParams);

  let fetchedGranules = await granulesQueue.empty();
  t.is(fetchedGranules.length, 3);
  t.deepEqual(
    fetchedGranules.map((g) => g.granuleId).sort(),
    granules.slice(0, 3).map((g) => g.granuleId).sort()
  );

  const searchWithGranId = {
    ...searchParams,
    granuleId: 'test',
  };

  granulesQueue = await granuleModel.granuleAttributeScan(searchWithGranId);
  fetchedGranules = await granulesQueue.empty();
  t.is(fetchedGranules.length, 1);

  const searchWithProvider = {
    ...searchParams,
    provider,
  };
  granulesQueue = await granuleModel.granuleAttributeScan(searchWithProvider);
  fetchedGranules = await granulesQueue.empty();
  t.is(fetchedGranules.length, 1);
});

test('removing a granule from CMR fails if the granule is not in CMR', async (t) => {
  const granule = fakeGranuleFactoryV2({ published: false });

  await awsServices.dynamodbDocClient().put({
    TableName: process.env.GranulesTable,
    Item: granule,
  });

  const granuleModel = new Granule();

  try {
    await granuleModel.removeGranuleFromCmrByGranule(granule);
  } catch (error) {
    t.is(error.message, `Granule ${granule.granuleId} is not published to CMR, so cannot be removed from CMR`);
  }
});

test.serial('removing a granule from CMR passes the granule UR to the cmr delete function', async (t) => {
  sinon.stub(
    DefaultProvider,
    'decrypt'
  ).callsFake(() => Promise.resolve('fakePassword'));

  sinon.stub(
    CMR.prototype,
    'deleteGranule'
  ).callsFake((granuleUr) => Promise.resolve(t.is(granuleUr, 'granule-ur')));

  sinon.stub(
    CMR.prototype,
    'getGranuleMetadata'
  ).callsFake(() => Promise.resolve({ title: 'granule-ur' }));

  try {
    const granule = fakeGranuleFactoryV2();

    await awsServices.dynamodbDocClient().put({
      TableName: process.env.GranulesTable,
      Item: granule,
    });

    const granuleModel = new Granule();

    await granuleModel.removeGranuleFromCmrByGranule(granule);
  } finally {
    CMR.prototype.deleteGranule.restore();
    DefaultProvider.decrypt.restore();
    CMR.prototype.getGranuleMetadata.restore();
  }
});

test.serial('removing a granule from CMR succeeds with Launchpad authentication', async (t) => {
  process.env.cmr_oauth_provider = 'launchpad';
  const launchpadStub = sinon.stub(launchpad, 'getLaunchpadToken').callsFake(() => randomString());

  sinon.stub(
    DefaultProvider,
    'decrypt'
  ).callsFake(() => Promise.resolve('fakePassword'));

  sinon.stub(
    CMR.prototype,
    'deleteGranule'
  ).callsFake((granuleUr) => Promise.resolve(t.is(granuleUr, 'granule-ur')));

  sinon.stub(
    CMR.prototype,
    'getGranuleMetadata'
  ).callsFake(() => Promise.resolve({ title: 'granule-ur' }));

  try {
    const granule = fakeGranuleFactoryV2();

    await awsServices.dynamodbDocClient().put({
      TableName: process.env.GranulesTable,
      Item: granule,
    });

    const granuleModel = new Granule();

    await granuleModel.removeGranuleFromCmrByGranule(granule);

    t.is(launchpadStub.calledOnce, true);
  } finally {
    process.env.cmr_oauth_provider = 'earthdata';
    launchpadStub.restore();
    CMR.prototype.deleteGranule.restore();
    DefaultProvider.decrypt.restore();
    CMR.prototype.getGranuleMetadata.restore();
  }
});

test('_getMutableFieldNames() returns correct fields for running status', (t) => {
  const { granuleModel } = t.context;

  const updatedItem = {
    granuleId: randomString(),
    status: 'running',
  };

  const updateFields = granuleModel._getMutableFieldNames(updatedItem);

  t.deepEqual(updateFields, [
    'createdAt', 'updatedAt', 'timestamp', 'status', 'execution',
  ]);
});

test('_getMutableFieldNames() returns correct fields for completed status', (t) => {
  const { granuleModel } = t.context;

  const item = {
    granuleId: randomString(),
    status: 'completed',
    pdrName: 'pdr',
    files: [],
    createdAt: Date.now(),
  };

  const updateFields = granuleModel._getMutableFieldNames(item);

  t.deepEqual(updateFields, Object.keys(item));
});
