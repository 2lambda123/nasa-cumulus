const test = require('ava');
const omit = require('lodash/omit');

const sandbox = require('sinon').createSandbox();
const proxyquire = require('proxyquire');

const { ChecksumError, CollectionInvalidRegexpError } = require('../dist/src/errors');

function removeStackObjectFromErrorBody(object) {
  const updateObject = { ...object };
  updateObject.body = JSON.stringify(omit(JSON.parse(updateObject.body), ['stack']));
  return updateObject;
}

function removeBackupResultsObjectErrorStack(object) {
  return object.map((result) => removeStackObjectFromErrorBody(result));
}

const fakePostReturn = {
  body: 'fake body',
  statusCode: 201,
};
const fakeCollection = {
  files: [
    {
      regex: 'foo.jpg',
      lzards: { backup: true },
    },
    {
      regex: 'foo.dat',
      lzards: { backup: false },
    },
  ],
};

const getCollectionStub = sandbox.stub().returns(fakeCollection);
const gotPostStub = sandbox.stub().returns(fakePostReturn);
const index = proxyquire('../dist/src', {
  '@cumulus/api-client/collections': {
    getCollection: getCollectionStub,
  },
  got: {
    default: {
      post: gotPostStub,
    },
  },
});
const env = { ...process.env };
test.beforeEach(() => {
  sandbox.restore();
  gotPostStub.resetHistory();
  getCollectionStub.resetHistory();
  process.env = { ...env };
});

test('shouldBackupFile returns true if the regex matches and the backup option is set on the matching collection file', (t) => {
  const fakeCollectionConfig = {
    files: [
      {
        regex: '^foo.jpg$',
        lzards: { backup: true },
      },
      {
        regex: '^foo.md5$',
        lzards: { backup: false },
      },
    ],
  };
  t.true(index.shouldBackupFile('foo.jpg', fakeCollectionConfig));
});

test('shouldBackupFile throws if multiple files match the collection regexp on the collection files', (t) => {
  const fakeCollectionConfig = {
    files: [
      {
        regex: '^foo.jpg$',
        lzards: { backup: true },
      },
      {
        regex: '^foo.jpg$',
        lzards: { backup: false },
      },
    ],
  };
  t.throws(() => index.shouldBackupFile('foo.jpg', fakeCollectionConfig), { instanceOf: CollectionInvalidRegexpError });
});

test('shouldBackupFile returns false if the regex matches and the backup option is set to false on the matching collection file', (t) => {
  const fakeCollectionConfig = {
    files: [
      {
        regex: '^foo.jpg$',
        lzards: { backup: false },
      },
    ],
  };
  t.false(index.shouldBackupFile('foo.jpg', fakeCollectionConfig));
});

test('shouldBackupFile returns false if the regex matches and the backup option is not set to false on the matching collection file', (t) => {
  const fakeCollectionConfig = {
    files: [
      {
        regex: '^foo.jpg$',
      },
    ],
  };
  t.false(index.shouldBackupFile('foo.jpg', fakeCollectionConfig));
});

test('shouldBackupFile returns false if the regex does not match any file', (t) => {
  const fakeCollectionConfig = {
    files: [
      {
        regex: '^foo.md5$',
        lzards: { backup: true },
      },
    ],
  };
  t.false(index.shouldBackupFile('foo.jpg', fakeCollectionConfig));
});

test('shouldBackupFile returns false if there is no collection file defined', (t) => {
  const fakeCollectionConfig = {};
  t.false(index.shouldBackupFile('foo.jpg', fakeCollectionConfig));
});

test('makeBackupFileRequest returns expected makeBackupFileRequestResult when file.filename is not a s3 URI', async (t) => {
  const lzardsPostMethod = () => Promise.resolve({
    body: 'success body',
    statusCode: 201,
  });
  const roleCreds = { fake: 'creds_object' };
  const name = 'fakeFilename';
  const filepath = 'fakeFilePath';
  const authToken = 'fakeToken';
  const collectionId = 'FAKE_COLLECTION';
  const bucket = 'fakeFileBucket';
  const filename = 'totallynotas3uri';

  const file = {
    name,
    filepath,
    bucket,
    filename,
  };
  const granuleId = 'fakeGranuleId';

  const actual = await index.makeBackupFileRequest({
    authToken,
    collectionId,
    roleCreds,
    file,
    granuleId,
    lzardsPostMethod,
  });

  const expected = {
    filename,
    granuleId: 'fakeGranuleId',
    status: 'FAILED',
  };

  t.deepEqual(omit(actual, 'body'), expected);
  t.is(JSON.parse(actual.body).name, 'TypeError');
});

test('makeBackupFileRequest returns expected makeBackupFileRequestResult on LZARDS failure', async (t) => {
  const lzardsPostMethod = () => Promise.resolve({
    body: 'failure body',
    statusCode: 404,
  });
  const roleCreds = { fake: 'creds_object' };
  const name = 'fakeFilename';
  const filepath = 'fakeFilePath';
  const authToken = 'fakeToken';
  const collectionId = 'FAKE_COLLECTION';
  const bucket = 'fakeFileBucket';
  const filename = 's3://fakeFileBucket/fakeFilename';

  const file = {
    name,
    filepath,
    bucket,
    filename,
  };
  const granuleId = 'fakeGranuleId';

  const actual = await index.makeBackupFileRequest({
    authToken,
    collectionId,
    roleCreds,
    file,
    granuleId,
    lzardsPostMethod,
  });

  const expected = {
    body: 'failure body',
    filename,
    granuleId: 'fakeGranuleId',
    status: 'FAILED',
    statusCode: 404,
  };

  t.deepEqual(actual, expected);
});

test('makeBackupFileRequest returns expected makeBackupFileRequestResult on other failure', async (t) => {
  const lzardsPostMethod = () => Promise.reject(new Error('DANGER WILL ROBINSON'));
  const roleCreds = { fake: 'creds_object' };
  const name = 'fakeFilename';
  const filepath = 'fakeFilePath';
  const authToken = 'fakeToken';
  const collectionId = 'FAKE_COLLECTION';
  const bucket = 'fakeFileBucket';
  const filename = 's3://fakeFileBucket/fakeFilename';

  const file = {
    name,
    filepath,
    bucket,
    filename,
  };
  const granuleId = 'fakeGranuleId';

  let actual = await index.makeBackupFileRequest({
    authToken,
    collectionId,
    roleCreds,
    file,
    granuleId,
    lzardsPostMethod,
  });

  const expected = {
    body: '{"name":"Error"}',
    filename,
    granuleId: 'fakeGranuleId',
    status: 'FAILED',
  };

  actual = removeStackObjectFromErrorBody(actual);
  t.deepEqual(actual, expected);
});

test('makeBackupFileRequest returns expected makeBackupFileRequestResult', async (t) => {
  const accessUrl = 'fakeURL';
  const generateAccessUrlMethod = (() => accessUrl);
  const lzardsPostMethod = () => Promise.resolve({
    body: 'fake body',
    statusCode: 201,
  });

  const roleCreds = { fake: 'creds_object' };
  const name = 'fakeFilename';
  const filepath = 'fakeFilePath';
  const authToken = 'fakeToken';
  const collectionId = 'FAKE_COLLECTION';
  const bucket = 'fakeFileBucket';
  const filename = 's3://fakeFileBucket/fakeFileBucket';

  const file = {
    name,
    filepath,
    bucket,
    filename,
  };
  const granuleId = 'fakeGranuleId';

  const actual = await index.makeBackupFileRequest({
    authToken,
    collectionId,
    roleCreds,
    file,
    granuleId,
    generateAccessUrlMethod,
    lzardsPostMethod,
  });

  const expected = {
    body: 'fake body',
    filename,
    granuleId: 'fakeGranuleId',
    status: 'COMPLETED',
    statusCode: 201,
  };

  t.deepEqual(actual, expected);
});

test('getGranuleCollection throws error if no prefix is set', async (t) => {
  const collectionName = 'fakeCollection';
  const collectionVersion = '001';
  await t.throwsAsync(index.getGranuleCollection({
    collectionName,
    collectionVersion,
  }));
});

test('getGranuleCollection throws error if version and name are not defined', async (t) => {
  const stackPrefix = 'fakePrefix';
  await t.throwsAsync(index.getGranuleCollection({
    stackPrefix,
  }));
});

test.serial('postRequestToLzards creates the expected query', async (t) => {
  const accessUrl = 'fakeUrl';
  const authToken = 'fakeToken';
  const collection = 'fakeCollectionString';
  const file = { fake: 'fileObject', filename: 'fakeFilename', checksumType: 'md5', checksum: 'fakeChecksum' };
  const granuleId = 'fakeGranuleId';
  const lzardsApi = 'fakeApi';
  const lzardsProviderName = 'fakeProvider';

  process.env.lzards_provider = lzardsProviderName;
  process.env.lzards_api = lzardsApi;

  const actual = await index.postRequestToLzards({
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
    lzardsApi,
    lzardsProviderName,
  });

  t.is(actual, fakePostReturn);
  t.deepEqual(gotPostStub.getCalls()[0].args, [lzardsApi, {
    json: {
      provider: lzardsProviderName,
      objectUrl: accessUrl,
      expectedMd5Hash: file.checksum,
      metadata: {
        filename: file.filename,
        collection,
        granuleId,
      },
    },
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  }]);
});

test.serial('postRequestToLzards creates the expected query with SHA256 checksum', async (t) => {
  const accessUrl = 'fakeUrl';
  const authToken = 'fakeToken';
  const collection = 'fakeCollectionString';
  const file = { fake: 'fileObject', filename: 'fakeFilename', checksumType: 'sha256', checksum: 'fakeChecksum' };
  const granuleId = 'fakeGranuleId';
  const lzardsApi = 'fakeApi';
  const lzardsProviderName = 'fakeProvider';

  process.env.lzards_provider = lzardsProviderName;
  process.env.lzards_api = lzardsApi;

  await index.postRequestToLzards({
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
    lzardsApi,
    lzardsProviderName,
  });

  t.deepEqual(gotPostStub.getCalls()[0].args, [lzardsApi, {
    json: {
      provider: lzardsProviderName,
      objectUrl: accessUrl,
      expectedSha256Hash: file.checksum,
      metadata: {
        filename: file.filename,
        collection,
        granuleId,
      },
    },
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  }]);
});

test.serial('postRequestToLzards throws if lzardsApiUrl is not set', async (t) => {
  const accessUrl = 'fakeUrl';
  const authToken = 'fakeToken';
  const collection = 'fakeCollectionString';
  const file = { fake: 'fileObject', filename: 'fakeFilename', checksumType: 'md5', checksum: 'fakeChecksum' };
  const granuleId = 'fakeGranuleId';
  const lzardsProviderName = 'fakeProvider';

  process.env.lzards_provider = lzardsProviderName;
  await t.throwsAsync(index.postRequestToLzards({
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
  }));
});

test.serial('postRequestToLzards throws if file.checksumType is not set ', async (t) => {
  const accessUrl = 'fakeUrl';
  const authToken = 'fakeToken';
  const collection = 'fakeCollectionString';
  const file = { fake: 'fileObject', filename: 'fakeFilename', checksum: 'fakeChecksum' };
  const granuleId = 'fakeGranuleId';
  const lzardsProviderName = 'fakeProvider';

  process.env.lzards_provider = lzardsProviderName;
  process.env.lzards_api = 'fakeApi';
  await t.throwsAsync(index.postRequestToLzards({
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
  }), { instanceOf: ChecksumError });
});

test.serial('postRequestToLzards throws if provider is not set ', async (t) => {
  const accessUrl = 'fakeUrl';
  const authToken = 'fakeToken';
  const collection = 'fakeCollectionString';
  const file = { fake: 'fileObject', filename: 'fakeFilename', checksum: 'fakeChecksum' };
  const granuleId = 'fakeGranuleId';

  process.env.lzards_api = 'fakeApi';
  await t.throwsAsync(index.postRequestToLzards({
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
  }));
});

test('generateAccessUrl generates an v4 accessURL', async (t) => {
  const actual = await index.generateAccessUrl({
    Bucket: 'foo',
    Key: 'bar',
  });
  t.regex(actual, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
});

test('generateAccessUrl generates a signed URL using passed credentials', async (t) => {
  const actual = await index.generateAccessUrl({
    usePassedCredentials: true,
    roleCreds: {
      Credentials: {
        SecretAccessKey: 'FAKEKey',
        AccessKeyId: 'FAKEId',
        SessionToken: 'FAKEToken',
      },
    },
    Bucket: 'foo',
    Key: 'bar',
  });
  t.regex(actual, /X-Amz-Credential=FAKEId/);
});

test.serial('backupGranulesToLzards returns the expected payload', async (t) => {
  sandbox.stub(index, 'generateAccessCredentials').returns({
    Credentials: {
      SecretAccessKey: 'FAKEKey',
      AccessKeyId: 'FAKEId',
      SessionToken: 'FAKEToken',
    },
  });
  sandbox.stub(index, 'getAuthToken').returns('fakeAuthToken');
  const fakePayload = {
    input: {
      granules: [
        {
          granuleId: 'FakeGranule1',
          dataType: 'FakeGranuleType',
          version: '000',
          files: [
            {
              name: 'foo.jpg',
              checksumType: 'md5',
              checksum: 'fakehash',
              filename: 's3://fakeBucket1//path/to/granule1/foo.jpg',
            },
            {
              name: 'foo.dat',
              checksumType: 'md5',
              checksum: 'fakehash',
              filename: 's3://fakeBucket1//path/to/granule1/foo.dat',
            },
          ],
        },
        {
          granuleId: 'FakeGranule2',
          dataType: 'FakeGranuleType',
          version: '000',
          files: [
            {
              name: 'foo.jpg',
              filename: 's3://fakeBucket2//path/to/granule1/foo.jpg',
              checksumType: 'md5',
              checksum: 'fakehash',
            },
            {
              name: 'foo.dat',
              filename: 's3://fakeBucket2//path/to/granule1/foo.dat',
              checksumType: 'md5',
              checksum: 'fakehash',
            },
          ],
        },
      ],
    },
  };

  process.env.lzards_api = 'fakeApi';
  process.env.lzards_provider = 'fakeProvider';
  process.env.stackName = 'fakeStack';

  const actual = await index.backupGranulesToLzards(fakePayload);
  const expected = {
    backupResults: [
      {
        body: 'fake body',
        filename: 's3://fakeBucket1//path/to/granule1/foo.jpg',
        status: 'COMPLETED',
        granuleId: 'FakeGranule1',
        statusCode: 201,
      },
      {
        body: 'fake body',
        filename: 's3://fakeBucket2//path/to/granule1/foo.jpg',
        status: 'COMPLETED',
        granuleId: 'FakeGranule2',
        statusCode: 201,
      },
    ],
    granules: fakePayload.input.granules,
  };
  t.deepEqual(actual, expected);
});

test.serial('backupGranulesToLzards returns empty record if no files to archive', async (t) => {
  sandbox.stub(index, 'generateAccessCredentials').returns({
    Credentials: {
      SecretAccessKey: 'FAKEKey',
      AccessKeyId: 'FAKEId',
      SessionToken: 'FAKEToken',
    },
  });
  sandbox.stub(index, 'getAuthToken').returns('fakeAuthToken');
  const fakePayload = {
    input: {
      granules: [
        {
          granuleId: 'FakeGranule1',
          dataType: 'FakeGranuleType',
          Version: '000',
          files: [
            {
              bucket: 'fakeBucket1',
              name: 'bar.jpg',
              filepath: '/path/to/granule1/bar.jpg',
            },
          ],
        },
      ],
    },
  };

  process.env.lzards_api = 'fakeApi';
  process.env.lzards_provider = 'fakeProvider';
  process.env.stackName = 'fakeStack';

  const actual = await index.backupGranulesToLzards(fakePayload);
  const expected = {
    backupResults: [],
    granules: fakePayload.input.granules,
  };
  t.deepEqual(actual, expected);
});

test.serial('backupGranulesToLzards returns failed record if missing archive checksum', async (t) => {
  sandbox.stub(index, 'generateAccessCredentials').returns({
    Credentials: {
      SecretAccessKey: 'FAKEKey',
      AccessKeyId: 'FAKEId',
      SessionToken: 'FAKEToken',
    },
  });
  sandbox.stub(index, 'getAuthToken').returns('fakeAuthToken');
  const fakePayload = {
    input: {
      granules: [
        {
          granuleId: 'FakeGranule1',
          dataType: 'FakeGranuleType',
          Version: '000',
          files: [
            {
              name: 'foo.jpg',
              filename: 's3://fakeBucket1//path/to/granule1/foo.jpg',
            },
            {
              name: 'foo.dat',
              filename: 's3://fakeBucket1//path/to/granule1/foo.dat',
            },
          ],
        },
      ],
    },
  };

  process.env.lzards_api = 'fakeApi';
  process.env.lzards_provider = 'fakeProvider';
  process.env.stackName = 'fakeStack';

  const actual = await index.backupGranulesToLzards(fakePayload);
  const expected = {
    backupResults: [
      {
        body: '{"name":"ChecksumError"}',
        filename: 's3://fakeBucket1//path/to/granule1/foo.jpg',
        status: 'FAILED',
        granuleId: 'FakeGranule1',
      },
    ],
    granules: fakePayload.input.granules,
  };

  actual.backupResults = removeBackupResultsObjectErrorStack(actual.backupResults);
  t.deepEqual(actual, expected);
});

test.serial('backupGranulesToLzards throws an error with a granule missing collection information', async (t) => {
  sandbox.stub(index, 'generateAccessCredentials').returns({
    Credentials: {
      SecretAccessKey: 'FAKEKey',
      AccessKeyId: 'FAKEId',
      SessionToken: 'FAKEToken',
    },
  });
  sandbox.stub(index, 'getAuthToken').returns('fakeAuthToken');

  getCollectionStub.returns(fakeCollection);
  const fakePayload = {
    input: {
      granules: [
        {
          granuleId: 'FakeGranule1',
          files: [
            {
              name: 'foo.jpg',
              checksumType: 'md5',
              checksum: 'fakehash',
              filename: 's3://fakeBucket1//path/to/granule1/foo.jpg',
            },
            {
              name: 'foo.dat',
              checksumType: 'md5',
              checksum: 'fakehash',
              filename: 's3://fakeBucket1//path/to/granule1/foo.dat',
            },
          ],
        },
      ],
    },
  };

  process.env.lzards_api = 'fakeApi';
  process.env.lzards_provider = 'fakeProvider';
  process.env.stackName = 'fakeStack';
  await t.throwsAsync(index.backupGranulesToLzards(fakePayload));
});
