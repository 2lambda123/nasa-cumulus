'use strict';

const omit = require('lodash/omit');
const test = require('ava');
const sinon = require('sinon');
const request = require('supertest');

const { randomString, randomId } = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  fakeProviderRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  ProviderPgModel,
  RulePgModel,
  translateApiCollectionToPostgresCollection,
  translateApiProviderToPostgresProvider,
  translateApiRuleToPostgresRule,
  translatePostgresRuleToApiRule,
  fakeRuleRecordFactory,
} = require('@cumulus/db');
const S3 = require('@cumulus/aws-client/S3');
const { Search } = require('@cumulus/es-client/search');
const indexer = require('@cumulus/es-client/indexer');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const { buildFakeExpressResponse } = require('./utils');
const {
  fakeCollectionFactory,
  fakeProviderFactory,
  fakeRuleFactoryV2,
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  createRuleTestRecords,
} = require('../../lib/testUtils');
const { post, put, del } = require('../../endpoints/rules');
const AccessToken = require('../../models/access-tokens');
const Rule = require('../../models/rules');
const assertions = require('../../lib/assertions');

[
  'AccessTokensTable',
  'RulesTable',
  'CollectionsTable',
  'ProvidersTable',
  'stackName',
  'system_bucket',
  'TOKEN_SECRET',
  'messageConsumer',
  'KinesisInboundEventLogger',
  // eslint-disable-next-line no-return-assign
].forEach((varName) => process.env[varName] = randomString());

const testDbName = randomString(12);

// import the express app after setting the env variables
const { app } = require('../../app');

const workflow = randomId('workflow-');

const setBuildPayloadStub = () => sinon.stub(Rule, 'buildPayload').resolves({});

let jwtAuthToken;
let accessTokenModel;
let ruleModel;
let buildPayloadStub;

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esRulesClient = new Search(
    {},
    'rule',
    t.context.esIndex
  );
  process.env.ES_INDEX = esIndex;

  await S3.createBucket(process.env.system_bucket);

  buildPayloadStub = setBuildPayloadStub();

  t.context.rulePgModel = new RulePgModel();
  t.context.collectionPgModel = new CollectionPgModel();
  t.context.providerPgModel = new ProviderPgModel();

  // Create PG Provider
  t.context.testPgProvider = fakeProviderRecordFactory();
  [t.context.pgProvider] = await t.context.providerPgModel.create(
    t.context.testKnex,
    t.context.testPgProvider,
    '*'
  );

  // Create PG Collection
  const collectionName = 'fakeCollection';
  const collectionVersion = 'v1';
  const testPgCollection = fakeCollectionRecordFactory({
    name: collectionName,
    version: collectionVersion,
  });
  t.context.collectionPgModel = new CollectionPgModel();
  [t.context.pgCollection] = await t.context.collectionPgModel.create(
    t.context.testKnex,
    testPgCollection
  );

  t.context.testRule = fakeRuleFactoryV2({
    name: randomId('testRule'),
    workflow: workflow,
    rule: {
      type: 'onetime',
      arn: 'arn',
      value: 'value',
    },
    state: 'ENABLED',
    queueUrl: 'https://sqs.us-west-2.amazonaws.com/123456789012/queue_url',
    collection: {
      name: t.context.pgCollection.name,
      version: t.context.pgCollection.version,
    },
    provider: t.context.pgProvider.name,
  });

  ruleModel = new Rule();
  await ruleModel.createTable();
  t.context.ruleModel = ruleModel;

  const ruleRecord = await ruleModel.create(t.context.testRule);
  await indexer.indexRule(esClient, ruleRecord, t.context.esIndex);
  t.context.testPgRule = await translateApiRuleToPostgresRule(ruleRecord, knex);
  t.context.rulePgModel.create(knex, t.context.testPgRule);

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });
});

test.beforeEach((t) => {
  const newRule = fakeRuleFactoryV2();
  delete newRule.collection;
  delete newRule.provider;
  t.context.newRule = newRule;
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await ruleModel.deleteTable();
  await S3.recursivelyDeleteS3Bucket(process.env.system_bucket);
  await cleanupTestIndex(t.context);

  buildPayloadStub.restore();
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('CUMULUS-911 GET without pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/rules')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 GET with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .get('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 POST with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .post('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 PUT with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .put('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);
  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-911 DELETE with pathParameters and without an Authorization header returns an Authorization Missing response', async (t) => {
  const response = await request(app)
    .delete('/rules/asdf')
    .set('Accept', 'application/json')
    .expect(401);

  assertions.isAuthorizationMissingResponse(t, response);
});

test('CUMULUS-912 GET without pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test('CUMULUS-912 GET with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .get('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 GET with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 POST with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .post('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 POST with pathParameters and with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 PUT with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .put('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 PUT with pathParameters and with an unauthorized user returns an unauthorized response');

test('CUMULUS-912 DELETE with pathParameters and with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/rules/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('CUMULUS-912 DELETE with pathParameters and with an unauthorized user returns an unauthorized response');

test.serial('default returns list of rules', async (t) => {
  const response = await request(app)
    .get('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { results } = response.body;
  t.is(results.length, 1);
});

test('GET gets a rule', async (t) => {
  const response = await request(app)
    .get(`/rules/${t.context.testRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const expectedRule = {
    ...t.context.testRule,
    updatedAt: response.body.updatedAt,
    createdAt: response.body.createdAt,
  };
  t.deepEqual(response.body, expectedRule);
});

test('When calling the API endpoint to delete an existing rule it does not return the deleted rule', async (t) => {
  const {
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queueUrl: 'fake-queue-url',
      collection: undefined,
      provider: undefined,
    }
  );
  t.true(await t.context.rulePgModel.exists(t.context.testKnex, { name: originalPgRecord.name }));

  const response = await request(app)
    .delete(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message, record } = response.body;
  t.is(message, 'Record deleted');
  t.is(record, undefined);
  t.false(await t.context.rulePgModel.exists(t.context.testKnex, { name: originalPgRecord.name }));
});

test('403 error when calling the API endpoint to delete an existing rule without a valid access token', async (t) => {
  const newRule = fakeRuleRecordFactory();
  const translatedRule = await translatePostgresRuleToApiRule(newRule);
  let response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(translatedRule)
    .expect(200);

  const { message, record } = response.body;

  t.is(message, 'Record saved');
  newRule.createdAt = record.createdAt;
  newRule.updatedAt = record.updatedAt;

  response = await request(app)
    .delete(`/rules/${newRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);

  response = await request(app)
    .get(`/rules/${newRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.deepEqual(response.body, record);
});

test('POST creates a rule in all data stores', async (t) => {
  const {
    collectionPgModel,
    newRule,
    providerPgModel,
    rulePgModel,
    testKnex,
  } = t.context;

  const fakeCollection = fakeCollectionFactory();
  const fakeProvider = fakeProviderFactory({
    encrypted: true,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: new Date(2020, 11, 17),
    updatedAt: new Date(2020, 12, 2),
  });

  newRule.provider = fakeProvider.id;
  newRule.collection = {
    name: fakeCollection.name,
    version: fakeCollection.version,
  };
  newRule.rule = {
    type: 'kinesis',
    value: 'my-kinesis-arn',
  };

  await collectionPgModel.create(
    testKnex,
    translateApiCollectionToPostgresCollection(fakeCollection)
  );

  await providerPgModel.create(
    testKnex,
    await translateApiProviderToPostgresProvider(fakeProvider)
  );

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  const { message } = response.body;
  const fetchedPostgresRecord = await rulePgModel
    .get(testKnex, { name: newRule.name });

  t.is(message, 'Record saved');
  const translatedPgRecord = await translatePostgresRuleToApiRule(fetchedPostgresRecord, testKnex);

  const esRecord = await t.context.esRulesClient.get(
    newRule.name
  );
  t.like(esRecord, translatedPgRecord);
});

test('POST creates a rule in PG with correct timestamps', async (t) => {
  const { newRule } = t.context;

  const fakeCollection = fakeCollectionFactory();
  const fakeProvider = fakeProviderFactory({
    encrypted: true,
    privateKey: 'key',
    cmKeyId: 'key-id',
    certificateUri: 'uri',
    createdAt: new Date(2020, 11, 17),
    updatedAt: new Date(2020, 12, 2),
  });

  newRule.provider = fakeProvider.id;
  newRule.collection = {
    name: fakeCollection.name,
    version: fakeCollection.version,
  };

  await t.context.collectionPgModel.create(
    t.context.testKnex,
    translateApiCollectionToPostgresCollection(fakeCollection)
  );
  await t.context.providerPgModel.create(
    t.context.testKnex,
    await translateApiProviderToPostgresProvider(fakeProvider)
  );

  await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  const fetchedPostgresRecord = await t.context.rulePgModel
    .get(t.context.testKnex, { name: newRule.name });

  t.true(fetchedPostgresRecord.created_at.getTime() > newRule.createdAt);
  t.true(fetchedPostgresRecord.updated_at.getTime() > newRule.updatedAt);
});

test('POST creates a rule that is enabled by default', async (t) => {
  const { newRule } = t.context;
  delete newRule.state;

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(200);

  const fetchedPostgresRecord = await t.context.rulePgModel
    .get(t.context.testKnex, { name: newRule.name });

  t.true(fetchedPostgresRecord.enabled);
  t.is(response.body.record.state, 'ENABLED');
});

test('POST returns a 409 response if record already exists', async (t) => {
  const { newRule, rulePgModel, testKnex } = t.context;

  const newPgRule = await translateApiRuleToPostgresRule(newRule);
  await rulePgModel.create(testKnex, newPgRule);

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(newRule)
    .expect(409);

  const { message, record } = response.body;
  t.is(message, `A record already exists for ${newRule.name}`);
  t.falsy(record);
});

test('POST returns a 400 response if record is missing a required property', async (t) => {
  const newRule = fakeRuleRecordFactory();
  const translatedRule = await translatePostgresRuleToApiRule(newRule);
  // Remove required property to trigger create error
  delete translatedRule.workflow;

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(translatedRule)
    .expect(400);
  t.is(response.status, 400);
});

test('POST returns a 400 response if rule name is invalid', async (t) => {
  const newRule = fakeRuleRecordFactory();
  const translatedRule = await translatePostgresRuleToApiRule(newRule);
  translatedRule.name = 'bad rule name';

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(translatedRule)
    .expect(400);
  t.is(response.status, 400);
});

test('POST returns a 400 response if rule name does not exist', async (t) => {
  const newRule = fakeRuleRecordFactory();
  const translatedRule = await translatePostgresRuleToApiRule(newRule);
  translatedRule.name = undefined;
  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(translatedRule)
    .expect(400);
  t.is(response.status, 400);
});

test('POST returns a 400 response if rule type is invalid', async (t) => {
  const newRule = fakeRuleRecordFactory();
  const translatedRule = await translatePostgresRuleToApiRule(newRule);
  translatedRule.type = 'invalid';

  const response = await request(app)
    .post('/rules')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(translatedRule)
    .expect(400);
  t.is(response.status, 400);
});

test.serial('POST returns a 500 response if workflow definition file does not exist', async (t) => {
  const rule = fakeRuleRecordFactory();
  const translatedRule = await translatePostgresRuleToApiRule(rule, t.context.knex);

  buildPayloadStub.restore();

  try {
    const response = await request(app)
      .post('/rules')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(translatedRule)
      .expect(500);
    t.is(response.status, 500);
  } finally {
    buildPayloadStub = setBuildPayloadStub();
  }
});

test.serial('POST returns a 500 response if record creation throws unexpected error', async (t) => {
  const { newRule } = t.context;

  const stub = sinon.stub(Rule.prototype, 'createRuleTrigger')
    .callsFake(() => {
      throw new Error('unexpected error');
    });

  try {
    const response = await request(app)
      .post('/rules')
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send(newRule)
      .expect(500);
    t.is(response.status, 500);
  } finally {
    stub.restore();
  }
});

test.serial('post() does not write to Elasticsearch if writing to PostgreSQL fails', async (t) => {
  const { newRule, testKnex } = t.context;

  const fakeRulePgModel = {
    create: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    body: newRule,
    testContext: {
      knex: testKnex,
      rulePgModel: fakeRulePgModel,
    },
  };
  const response = buildFakeExpressResponse();
  await post(expressRequest, response);

  const dbRecords = await t.context.rulePgModel
    .search(t.context.testKnex, { name: newRule.name });

  t.true(response.boom.badImplementation.calledWithMatch('something bad'));
  t.is(dbRecords.length, 0);
  t.false(await t.context.esRulesClient.exists(
    newRule.name
  ));
});

test.serial('post() does not write to PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const { newRule, testKnex } = t.context;

  const fakeEsClient = {
    index: () => Promise.reject(new Error('something bad')),
  };

  const expressRequest = {
    body: newRule,
    testContext: {
      knex: testKnex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await post(expressRequest, response);

  t.true(response.boom.badImplementation.calledWithMatch('something bad'));

  const dbRecords = await t.context.rulePgModel
    .search(t.context.testKnex, { name: newRule.name });

  t.is(dbRecords.length, 0);
  t.false(await t.context.esRulesClient.exists(
    newRule.name
  ));
});

test('PUT replaces a rule', async (t) => {
  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queueUrl: 'fake-queue-url',
      collection: undefined,
      provider: undefined,
    }
  );

  const updateRule = {
    ...omit(originalDynamoRule, ['queueUrl', 'provider', 'collection']),
    state: 'ENABLED',
    // these timestamps should not get used
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await request(app)
    .put(`/rules/${updateRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send(updateRule)
    .expect(200);

  const actualRule = await ruleModel.get({ name: updateRule.name });
  const actualPostgresRule = await t.context.rulePgModel
    .get(t.context.testKnex, { name: updateRule.name });
  const updatedEsRecord = await t.context.esRulesClient.get(
    originalDynamoRule.name
  );

  t.true(actualRule.updatedAt > updateRule.updatedAt);
  // PG and Dynamo records have the same timestamps
  t.is(actualPostgresRule.created_at.getTime(), actualRule.createdAt);
  t.is(actualPostgresRule.updated_at.getTime(), actualRule.updatedAt);
  t.is(actualPostgresRule.created_at.getTime(), updatedEsRecord.createdAt);
  t.is(actualPostgresRule.updated_at.getTime(), updatedEsRecord.updatedAt);

  t.like(actualPostgresRule, {
    ...omit(originalPgRecord, ['queue_url']),
    enabled: true,
    created_at: new Date(originalDynamoRule.createdAt),
    updated_at: actualPostgresRule.updated_at,
  });
  t.deepEqual(actualRule, {
    // should not contain a queueUrl property
    ...updateRule,
    createdAt: originalDynamoRule.createdAt,
    updatedAt: actualRule.updatedAt,
  });
  t.deepEqual(
    updatedEsRecord,
    {
      ...omit(originalEsRecord, ['queueUrl']),
      state: 'ENABLED',
      createdAt: originalDynamoRule.createdAt,
      updatedAt: actualRule.updatedAt,
      timestamp: updatedEsRecord.timestamp,
    }
  );
});

test('PUT returns 404 for non-existent rule', async (t) => {
  const name = 'new_make_coffee';
  const response = await request(app)
    .put(`/rules/${name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .send({ name })
    .expect(404);

  const { message, record } = response.body;
  t.truthy(message.includes(name));
  t.falsy(record);
});

test('PUT returns 400 for name mismatch between params and payload',
  async (t) => {
    const response = await request(app)
      .put(`/rules/${randomString()}`)
      .set('Accept', 'application/json')
      .set('Authorization', `Bearer ${jwtAuthToken}`)
      .send({ name: randomString() })
      .expect(400);
    const { message, record } = response.body;

    t.truthy(message);
    t.falsy(record);
  });

test('put() does not write to PostgreSQL/Elasticsearch if writing to Dynamo fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
      queueUrl: 'queue-1',
    }
  );

  const fakeRulesModel = {
    get: () => Promise.resolve(originalDynamoRule),
    update: () => {
      throw new Error('something bad');
    },
    create: () => Promise.resolve(originalDynamoRule),
    createRuleTrigger: () => Promise.resolve(originalDynamoRule),
  };

  const updatedRule = {
    ...omit(originalDynamoRule, ['collection', 'provider']),
    queueUrl: 'queue-2',
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updatedRule,
    testContext: {
      knex: testKnex,
      ruleModel: fakeRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['provider', 'collection'])
  );
  t.deepEqual(
    await t.context.rulePgModel.get(t.context.testKnex, {
      name: originalDynamoRule.name,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esRulesClient.get(
      originalDynamoRule.name
    ),
    originalEsRecord
  );
});

test('put() does not write to Dynamo/Elasticsearch if writing to PostgreSQL fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
      queueUrl: 'queue-1',
    }
  );

  const fakerulePgModel = {
    upsert: () => Promise.reject(new Error('something bad')),
  };

  const updatedRule = {
    ...omit(originalDynamoRule, ['collection', 'provider']),
    queueUrl: 'queue-2',
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updatedRule,
    testContext: {
      knex: testKnex,
      rulePgModel: fakerulePgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['provider', 'collection'])
  );
  t.deepEqual(
    await t.context.rulePgModel.get(t.context.testKnex, {
      name: originalDynamoRule.name,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esRulesClient.get(
      originalDynamoRule.name
    ),
    originalEsRecord
  );
});

test('put() does not write to Dynamo/PostgreSQL if writing to Elasticsearch fails', async (t) => {
  const { testKnex } = t.context;
  const {
    originalDynamoRule,
    originalPgRecord,
    originalEsRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
      queueUrl: 'queue-1',
    }
  );

  const fakeEsClient = {
    index: () => Promise.reject(new Error('something bad')),
  };

  const updatedRule = {
    ...omit(originalDynamoRule, ['collection', 'provider']),
    queueUrl: 'queue-2',
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    body: updatedRule,
    testContext: {
      knex: testKnex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    put(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['provider', 'collection'])
  );
  t.deepEqual(
    await t.context.rulePgModel.get(t.context.testKnex, {
      name: originalDynamoRule.name,
    }),
    originalPgRecord
  );
  t.deepEqual(
    await t.context.esRulesClient.get(
      originalDynamoRule.name
    ),
    originalEsRecord
  );
});

test('DELETE returns a 404 if PostgreSQL and Elasticsearch rule cannot be found', async (t) => {
  const nonExistentRule = fakeRuleFactoryV2();
  const response = await request(app)
    .delete(`/rules/${nonExistentRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.body.message, 'No record found');
});

test('DELETE deletes rule that exists in PostgreSQL and DynamoDB but not Elasticsearch', async (t) => {
  const {
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const newRule = fakeRuleFactoryV2();
  delete newRule.collection;
  delete newRule.provider;
  const ruleWithTrigger = await ruleModel.createRuleTrigger(newRule);
  const apiRule = await ruleModel.create(ruleWithTrigger);
  const translatedRule = await translateApiRuleToPostgresRule(apiRule, testKnex);
  await rulePgModel.create(testKnex, translatedRule);

  t.false(
    await esRulesClient.exists(
      translatedRule.name
    )
  );
  t.true(
    await rulePgModel.exists(testKnex, {
      name: translatedRule.name,
    })
  );
  const response = await request(app)
    .delete(`/rules/${translatedRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { message } = response.body;
  const dbRecords = await rulePgModel
    .search(testKnex, { name: translatedRule.name });

  t.is(dbRecords.length, 0);
  t.is(message, 'Record deleted');
});

test('DELETE deletes rule that exists in Elasticsearch but not PostgreSQL', async (t) => {
  const {
    esClient,
    esIndex,
    esRulesClient,
    rulePgModel,
    testKnex,
  } = t.context;
  const newRule = fakeRuleFactoryV2();
  const ruleWithTrigger = await ruleModel.createRuleTrigger(newRule);
  await ruleModel.create(ruleWithTrigger);
  await indexer.indexRule(esClient, newRule, esIndex);

  t.true(
    await esRulesClient.exists(
      newRule.name
    )
  );
  t.false(
    await rulePgModel.exists(testKnex, {
      name: newRule.name,
    })
  );
  const response = await request(app)
    .delete(`/rules/${newRule.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);
  const { message } = response.body;
  const dbRecords = await rulePgModel
    .search(t.context.testKnex, { name: newRule.name });

  t.is(dbRecords.length, 0);
  t.is(message, 'Record deleted');
});

test('DELETE deletes a rule', async (t) => {
  const {
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      queueUrl: 'fake-queue-url',
      collection: undefined,
      provider: undefined,
    }
  );
  t.true(await t.context.rulePgModel.exists(t.context.testKnex, { name: originalPgRecord.name }));

  const response = await request(app)
    .delete(`/rules/${originalPgRecord.name}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  const { message } = response.body;
  const dbRecords = await t.context.rulePgModel
    .search(t.context.testKnex, { name: originalPgRecord.name });

  t.is(dbRecords.length, 0);
  t.is(message, 'Record deleted');
  t.false(
    await t.context.esRulesClient.exists(
      originalPgRecord.name
    )
  );
});

test('del() does not remove from PostgreSQL/Elasticsearch if removing from Dynamo fails', async (t) => {
  const {
    originalDynamoRule,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
    }
  );

  const fakeRulesModel = {
    get: () => Promise.resolve(originalDynamoRule),
    delete: () => {
      throw new Error('something bad');
    },
    create: () => Promise.resolve(true),
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    testContext: {
      knex: t.context.testKnex,
      ruleModel: fakeRulesModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['collection', 'provider'])
  );
  t.true(
    await t.context.rulePgModel.exists(t.context.testKnex, {
      name: originalDynamoRule.name,
    })
  );
  t.true(
    await t.context.esRulesClient.exists(
      originalDynamoRule.name
    )
  );
});

test('del() does not remove from Dynamo/Elasticsearch if removing from PostgreSQL fails', async (t) => {
  const {
    originalDynamoRule,
    originalPgRecord,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
    }
  );

  const fakeRulesPgModel = {
    delete: () => {
      throw new Error('something bad');
    },
    get: () => Promise.resolve(originalPgRecord),
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    testContext: {
      knex: t.context.testKnex,
      rulePgModel: fakeRulesPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['collection', 'provider'])
  );
  t.true(
    await t.context.rulePgModel.exists(t.context.testKnex, {
      name: originalDynamoRule.name,
    })
  );
  t.true(
    await t.context.esRulesClient.exists(
      originalDynamoRule.name
    )
  );
});

test('del() does not remove from Dynamo/PostgreSQL if removing from Elasticsearch fails', async (t) => {
  const {
    originalDynamoRule,
  } = await createRuleTestRecords(
    t.context,
    {
      collection: undefined,
      provider: undefined,
    }
  );

  const fakeEsClient = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      name: originalDynamoRule.name,
    },
    testContext: {
      knex: t.context.testKnex,
      esClient: fakeEsClient,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.deepEqual(
    await t.context.ruleModel.get({
      name: originalDynamoRule.name,
    }),
    omit(originalDynamoRule, ['collection', 'provider'])
  );
  t.true(
    await t.context.rulePgModel.exists(t.context.testKnex, {
      name: originalDynamoRule.name,
    })
  );
  t.true(
    await t.context.esRulesClient.exists(
      originalDynamoRule.name
    )
  );
});
