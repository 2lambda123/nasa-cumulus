'use strict';

const test = require('ava');
const request = require('supertest');
const awsServices = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const { randomString } = require('@cumulus/common/test-utils');
const { getKnexClient, localStackConnectionEnv } = require('@cumulus/db');
const models = require('../../../models');
const bootstrap = require('../../../lambdas/bootstrap');
const {
  createFakeJwtAuthToken,
  fakeCollectionFactory,
  setAuthorizedOAuthUsers,
} = require('../../../lib/testUtils');
const { Search } = require('../../../es/search');
const assertions = require('../../../lib/assertions');
const { dynamoRecordToDbRecord } = require('../../../endpoints/collections');

process.env.AccessTokensTable = randomString();
process.env.CollectionsTable = randomString();
process.env.stackName = randomString();
process.env.system_bucket = randomString();
process.env.TOKEN_SECRET = randomString();

// import the express app after setting the env variables
const { app } = require('../../../app');

const esIndex = randomString();
let esClient;

let jwtAuthToken;
let accessTokenModel;
let collectionModel;

test.before(async (t) => {
  process.env = { ...process.env, ...localStackConnectionEnv };

  const esAlias = randomString();
  process.env.ES_INDEX = esAlias;
  await bootstrap.bootstrapElasticSearch('fakehost', esIndex, esAlias);

  await awsServices.s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  collectionModel = new models.Collection({ tableName: process.env.CollectionsTable });
  await collectionModel.createTable();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new models.AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
  esClient = await Search.es('fakehost');

  t.context.dbClient = await getKnexClient({ env: localStackConnectionEnv });
});

test.beforeEach(async (t) => {
  t.context.testCollection = fakeCollectionFactory();
  await collectionModel.create(t.context.testCollection);
});

test.after.always(async () => {
  await accessTokenModel.deleteTable();
  await collectionModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await esClient.indices.delete({ index: esIndex });
});

test('CUMULUS-911 PUT with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .put('/collections/asdf/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/collections/asdf/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test('PUT replaces an existing collection', async (t) => {
  const { dbClient } = t.context;

  const originalCollection = fakeCollectionFactory({
    duplicateHandling: 'replace',
    process: randomString(),
  });

  const originalDynamoRecord = await collectionModel.create(originalCollection);

  const dbRecord = dynamoRecordToDbRecord(originalDynamoRecord);
  await dbClient('collections').insert(dbRecord);

  const updatedCollection = {
    ...originalCollection,
    duplicateHandling: 'error',
  };

  delete updatedCollection.process;

  await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedCollection)
    .expect(200);

  const fetchedDynamoRecord = await collectionModel.get({
    name: originalCollection.name,
    version: originalCollection.version,
  });

  t.is(fetchedDynamoRecord.name, originalCollection.name);
  t.is(fetchedDynamoRecord.version, originalCollection.version);
  t.is(fetchedDynamoRecord.duplicateHandling, 'error');
  t.is(fetchedDynamoRecord.process, undefined);

  const fetchedDbRecord = await dbClient.first()
    .from('collections')
    .where({
      name: originalCollection.name,
      version: originalCollection.version,
    });

  t.is(fetchedDbRecord.name, originalCollection.name);
  t.is(fetchedDbRecord.version, originalCollection.version);
  t.is(fetchedDbRecord.duplicateHandling, 'error');
  // eslint-disable-next-line unicorn/no-null
  t.is(fetchedDbRecord.process, null);
  t.is(fetchedDbRecord.created_at.getTime(), fetchedDynamoRecord.createdAt);
  t.is(fetchedDbRecord.updated_at.getTime(), fetchedDynamoRecord.updatedAt);
});

test('PUT creates a new record in RDS if one does not exist', async (t) => {
  const { dbClient } = t.context;

  const originalCollection = fakeCollectionFactory({
    duplicateHandling: 'replace',
    process: randomString(),
  });

  await collectionModel.create(originalCollection);

  const updatedCollection = {
    ...originalCollection,
    duplicateHandling: 'error',
  };

  delete updatedCollection.process;

  await request(app)
    .put(`/collections/${originalCollection.name}/${originalCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updatedCollection)
    .expect(200);

  const fetchedDynamoRecord = await collectionModel.get({
    name: originalCollection.name,
    version: originalCollection.version,
  });

  const fetchedDbRecord = await dbClient.first()
    .from('collections')
    .where({
      name: originalCollection.name,
      version: originalCollection.version,
    });

  t.is(fetchedDbRecord.name, originalCollection.name);
  t.is(fetchedDbRecord.version, originalCollection.version);
  t.is(fetchedDbRecord.duplicateHandling, 'error');
  // eslint-disable-next-line unicorn/no-null
  t.is(fetchedDbRecord.process, null);
  t.is(fetchedDbRecord.created_at.getTime(), fetchedDynamoRecord.createdAt);
  t.is(fetchedDbRecord.updated_at.getTime(), fetchedDynamoRecord.updatedAt);
});

test('PUT returns 404 for non-existent collection', async (t) => {
  const name = randomString();
  const version = randomString();
  const response = await request(app)
    .put(`/collections/${name}/${version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ name, version })
    .expect(404);
  const { message, record } = response.body;

  t.truthy(message);
  t.falsy(record);
});

test('PUT returns 400 for name mismatch between params and payload',
  async (t) => {
    const name = randomString();
    const version = randomString();
    const response = await request(app)
      .put(`/collections/${name}/${version}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ name: randomString(), version })
      .expect(400);
    const { message, record } = response.body;

    t.truthy(message);
    t.falsy(record);
  });

test('PUT returns 400 for version mismatch between params and payload',
  async (t) => {
    const name = randomString();
    const version = randomString();
    const response = await request(app)
      .put(`/collections/${name}/${version}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ name, version: randomString() })
      .expect(400);
    const { message, record } = response.body;

    t.truthy(message);
    t.falsy(record);
  });
