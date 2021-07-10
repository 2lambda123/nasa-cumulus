'use strict';

const test = require('ava');
const request = require('supertest');
const cryptoRandomString = require('crypto-random-string');
const jsyaml = require('js-yaml');
const sinon = require('sinon');
const { Cookie } = require('tough-cookie');
const { URL } = require('url');
const moment = require('moment');

const { createBucket, s3PutObject, recursivelyDeleteS3Bucket } = require('@cumulus/aws-client/S3');
const { RecordDoesNotExist } = require('@cumulus/errors');
const { s3 } = require('@cumulus/aws-client/services');
const { getLocalstackEndpoint } = require('@cumulus/aws-client/test-utils');
const { randomId } = require('@cumulus/common/test-utils');
const { OAuthClient, CognitoClient } = require('@cumulus/oauth-client');

const { AccessToken } = require('../../models');
const { fakeAccessTokenFactory } = require('../../lib/testUtils');

process.env.OAUTH_CLIENT_ID = randomId('edlId');
process.env.OAUTH_CLIENT_PASSWORD = randomId('edlPw');
process.env.DISTRIBUTION_REDIRECT_ENDPOINT = 'http://example.com';
process.env.DISTRIBUTION_ENDPOINT = `https://${randomId('host')}/${randomId('path')}`;
process.env.OAUTH_HOST_URL = `https://${randomId('host')}/${randomId('path')}`;
process.env.AccessTokensTable = randomId('tokenTable');
process.env.stackName = cryptoRandomString({ length: 10 });
process.env.system_bucket = cryptoRandomString({ length: 10 });
process.env.BUCKET_MAP_FILE = `${process.env.stackName}/cumulus_distribution/bucket_map.yaml`;

let headObjectStub;

// import the express app after setting the env variables
const { distributionApp } = require('../../app/distribution');

const publicBucket = randomId('publicbucket');
const publicBucketPath = randomId('publicpath');
const protectedBucket = randomId('protectedbucket');

const bucketMap = {
  MAP: {
    path1: {
      bucket: 'bucket-path-1',
      headers: {
        'Content-Type': 'text/plain',
      },
    },
    [protectedBucket]: protectedBucket,
    [publicBucketPath]: publicBucket,
    [publicBucket]: publicBucket,
  },
  PUBLIC_BUCKETS: {
    [publicBucket]: 'public bucket',
  },
};

const invalidToken = randomId('invalidToken');

let context;

function headerIs(headers, name, value) {
  return headers[name.toLowerCase()] === value;
}

function validateDefaultHeaders(t, response) {
  t.true(headerIs(response.headers, 'Access-Control-Allow-Origin', '*'));
  t.true(headerIs(response.headers, 'Strict-Transport-Security', 'max-age=31536000; includeSubDomains'));
}

function validateRedirectToGetAuthorizationCode(t, response) {
  const { authorizationUrl } = context;

  t.is(response.status, 307);
  validateDefaultHeaders(t, response);
  t.true(headerIs(response.headers, 'Location', authorizationUrl));
}

function stubHeadObject() {
  headObjectStub = sinon.stub(s3(), 'headObject').returns({ promise: () => Promise.resolve() });
}

function restoreHeadObjectStub() {
  headObjectStub.restore();
}

test.before(async () => {
  await createBucket(process.env.system_bucket);
  await s3PutObject({
    Bucket: process.env.system_bucket,
    Key: process.env.BUCKET_MAP_FILE,
    Body: jsyaml.dump(bucketMap),
  });

  const accessTokenModel = new AccessToken({ tableName: process.env.AccessTokensTable });
  await accessTokenModel.createTable();

  const authorizationUrl = `https://${randomId('host')}.com/${randomId('path')}`;
  const fileKey = randomId('key');

  const fileLocation = `${protectedBucket}/${fileKey}`;
  const s3Endpoint = getLocalstackEndpoint('s3');

  const getAccessTokenResponse = fakeAccessTokenFactory();
  const getUserInfoResponse = { foo: 'bar', username: getAccessTokenResponse.username };

  sinon.stub(
    OAuthClient.prototype,
    'getAccessToken'
  ).callsFake(() => getAccessTokenResponse);

  sinon.stub(
    OAuthClient.prototype,
    'getAuthorizationUrl'
  ).callsFake(() => authorizationUrl);

  sinon.stub(
    CognitoClient.prototype,
    'getUserInfo'
  ).callsFake(({ token }) => {
    if (token === invalidToken) throw new Error('Invalid token');
    return getUserInfoResponse;
  });

  const accessTokenRecord = fakeAccessTokenFactory({ tokenInfo: { anykey: randomId('tokenInfo') } });
  await accessTokenModel.create(accessTokenRecord);

  context = {
    accessTokenModel,
    accessTokenRecord,
    accessTokenCookie: accessTokenRecord.accessToken,
    getAccessTokenResponse,
    getUserInfoResponse,
    fileKey,
    fileLocation,
    authorizationUrl,
    authorizationCode: randomId('code'),
    distributionUrl: process.env.DISTRIBUTION_ENDPOINT,
    s3Endpoint,
  };
});

test.after.always(async () => {
  await recursivelyDeleteS3Bucket(process.env.system_bucket);

  const { accessTokenModel } = context;
  await accessTokenModel.deleteTable();
  sinon.reset();
});

test.serial('A request for a file without an access token returns a redirect to an OAuth2 provider', async (t) => {
  const { fileLocation } = context;
  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .expect(307);

  validateRedirectToGetAuthorizationCode(t, response);
});

test.serial('A request for a file using a non-existent access token returns a redirect to an OAuth2 provider', async (t) => {
  const { fileLocation } = context;
  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${randomId('cookie')}`])
    .expect(307);

  validateRedirectToGetAuthorizationCode(t, response);
});

test.serial('A request for a file using an expired access token returns a redirect to an OAuth2 provider', async (t) => {
  const { accessTokenModel, fileLocation } = context;

  const accessTokenRecord = fakeAccessTokenFactory({
    expirationTime: moment().unix(),
  });
  await accessTokenModel.create(accessTokenRecord);

  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(307);

  validateRedirectToGetAuthorizationCode(t, response);
});

test.serial('An authenticated request for a file that cannot be parsed returns a 404', async (t) => {
  const { accessTokenCookie } = context;
  const response = await request(distributionApp)
    .get('/invalid')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .expect(404);

  t.is(response.statusCode, 404);
});

test.serial('An authenticated request for a file returns a redirect to S3', async (t) => {
  stubHeadObject();

  const {
    accessTokenCookie,
    accessTokenRecord,
    fileLocation,
    s3Endpoint,
  } = context;

  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .expect(307);

  restoreHeadObjectStub();

  t.is(response.status, 307);
  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);

  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), accessTokenRecord.username);
});

test.serial('A request for a file with a valid bearer token returns a redirect to S3', async (t) => {
  stubHeadObject();

  const {
    fileLocation,
    getUserInfoResponse,
    s3Endpoint,
  } = context;

  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${randomId('token')}`)
    .expect(307);

  restoreHeadObjectStub();

  t.is(response.status, 307);
  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);
  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), getUserInfoResponse.username);
});

test.serial('A request for a file with an invalid bearer token returns a redirect to an OAuth2 provider', async (t) => {
  const { fileLocation } = context;

  const response = await request(distributionApp)
    .get(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${invalidToken}`)
    .expect(307);

  validateRedirectToGetAuthorizationCode(t, response);
});

test.serial('A request for a public file without an access token returns a redirect to S3', async (t) => {
  stubHeadObject();
  const { fileKey, s3Endpoint } = context;
  const fileLocation = `${publicBucket}/${fileKey}`;
  const response = await request(distributionApp)
    .get(`/${publicBucketPath}/${fileKey}`)
    .set('Accept', 'application/json')
    .expect(307);

  restoreHeadObjectStub();

  t.is(response.status, 307);
  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);

  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), 'unauthenticated user');
});

test.serial('A request for a public file with an access token returns a redirect to S3', async (t) => {
  stubHeadObject();

  const { accessTokenCookie, accessTokenRecord, fileKey, s3Endpoint } = context;
  const fileLocation = `${publicBucket}/${fileKey}`;
  const response = await request(distributionApp)
    .get(`/${publicBucketPath}/${fileKey}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .expect(307);

  restoreHeadObjectStub();

  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);
  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), accessTokenRecord.username);
});

test.serial('A /login request with a good authorization code returns a correct response', async (t) => {
  const {
    authorizationCode,
    getAccessTokenResponse,
    distributionUrl,
    fileLocation,
  } = context;

  const response = await request(distributionApp)
    .get('/login')
    .query({ code: authorizationCode, state: fileLocation })
    .set('Accept', 'application/json')
    .expect(301);

  t.is(response.status, 301);
  validateDefaultHeaders(t, response);
  t.is(response.headers.location, `${distributionUrl}/${fileLocation}`);

  const cookies = response.headers['set-cookie'].map(Cookie.parse);
  const setAccessTokenCookie = cookies.find((c) => c.key === 'accessToken');

  t.truthy(setAccessTokenCookie);
  t.is(setAccessTokenCookie.value, getAccessTokenResponse.accessToken);
  t.is(setAccessTokenCookie.httpOnly, true);
  t.is(setAccessTokenCookie.secure, true);

  t.is(
    setAccessTokenCookie.expires.valueOf(),
    // expirationTime only has per-second precision
    getAccessTokenResponse.expirationTime * 1000
  );
});

test.serial('A /login request with a good authorization code stores the access token', async (t) => {
  const {
    accessTokenModel,
    authorizationCode,
    fileLocation,
  } = context;

  const response = await request(distributionApp)
    .get('/login')
    .query({ code: authorizationCode, state: fileLocation })
    .set('Accept', 'application/json')
    .expect(301);

  const cookies = response.headers['set-cookie'].map(Cookie.parse);
  const setAccessTokenCookie = cookies.find((c) => c.key === 'accessToken');

  t.true(await accessTokenModel.exists({ accessToken: setAccessTokenCookie.value }));
});

test.serial('A /logout request deletes the access token', async (t) => {
  const { accessTokenModel } = context;
  const accessTokenRecord = fakeAccessTokenFactory();
  await accessTokenModel.create(accessTokenRecord);
  const response = await request(distributionApp)
    .get('/logout')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(200);

  t.falsy(response.headers['set-cookie']);
  try {
    await accessTokenModel.get({ accessToken: accessTokenRecord.accessToken });
    t.fail('expected code to throw error');
  } catch (error) {
    console.log(error);
    t.true(error instanceof RecordDoesNotExist);
  }
  t.true(response.text.startsWith('<html>'));
});

test.serial('An authenticated / request displays welcome and logout page', async (t) => {
  const { accessTokenRecord } = context;
  const response = await request(distributionApp)
    .get('/')
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenRecord.accessToken}`])
    .expect(200);

  t.true(response.text.startsWith('<html>'));
  t.true(response.text.includes('Log Out'));
  t.false(response.text.includes('Log In'));
  t.true(response.text.includes('Welcome user'));
});

test.serial('A / request without an access token displays login page', async (t) => {
  const response = await request(distributionApp)
    .get('/')
    .set('Accept', 'application/json')
    .expect(200);

  t.true(response.text.startsWith('<html>'));
  t.true(response.text.includes('Log In'));
  t.false(response.text.includes('Log Out'));
  t.false(response.text.includes('Welcome user'));
});

test.serial('A HEAD request for a public file without an access token redirects to S3', async (t) => {
  const { fileKey, s3Endpoint } = context;
  const fileLocation = `${publicBucket}/${fileKey}`;
  const response = await request(distributionApp)
    .head(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .expect(307);

  t.is(response.status, 307);
  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);

  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), 'unauthenticated user');
});

test.serial('An authenticated HEAD request for a file returns a redirect to S3', async (t) => {
  const { s3Endpoint, accessTokenCookie, accessTokenRecord, fileLocation } = context;

  const response = await request(distributionApp)
    .head(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .expect(307);

  t.is(response.status, 307);
  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);

  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), accessTokenRecord.username);
});

test.serial('An authenticated HEAD request containing a range header for a file returns a redirect to S3 and passes the range request on', async (t) => {
  const { s3Endpoint, accessTokenCookie, accessTokenRecord, fileLocation } = context;

  const response = await request(distributionApp)
    .head(`/${fileLocation}`)
    .set('Accept', 'application/json')
    .set('Cookie', [`accessToken=${accessTokenCookie}`])
    .set('Range', 'bytes=0-2048')
    .expect(307);

  t.is(response.status, 307);
  validateDefaultHeaders(t, response);

  const redirectLocation = new URL(response.headers.location);
  const signedFileUrl = new URL(`${s3Endpoint}/${fileLocation}`);

  t.is(redirectLocation.origin, signedFileUrl.origin);
  t.is(redirectLocation.pathname, signedFileUrl.pathname);
  t.is(redirectLocation.searchParams.get('A-userid'), accessTokenRecord.username);
  t.true(redirectLocation.searchParams.get('X-Amz-SignedHeaders').includes('range'));
});

test('A sucessful /locate request for a bucket returns matching paths', async (t) => {
  const response = await request(distributionApp)
    .get('/locate?bucket_name=bucket-path-1')
    .set('Accept', 'application/json')
    .expect('Content-Type', /application\/json/)
    .expect(200);
  t.deepEqual(response.body, ['path1']);
});

test('A /locate request returns error when no matching bucket found', async (t) => {
  const response = await request(distributionApp)
    .get('/locate?bucket_name=nonexistbucket')
    .set('Accept', 'application/json')
    .expect('Content-Type', /text\/plain/)
    .expect(404);
  t.true(JSON.stringify(response.error).includes('No route defined for nonexistbucket'));
});

test('A /locate request returns error when request parameter is missing', async (t) => {
  const response = await request(distributionApp)
    .get('/locate')
    .set('Accept', 'application/json')
    .expect('Content-Type', /text\/plain/)
    .expect(400);
  t.true(JSON.stringify(response.error).includes('Required \\"bucket_name\\" query paramater not specified'));
});
