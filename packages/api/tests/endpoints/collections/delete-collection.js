'use strict';

const test = require('ava');
const request = require('supertest');
const {
  s3,
  sns,
  sqs,
} = require('@cumulus/aws-client/services');
const {
  recursivelyDeleteS3Bucket,
} = require('@cumulus/aws-client/S3');
const {
  randomId,
  randomString,
} = require('@cumulus/common/test-utils');
const {
  CollectionPgModel,
  destroyLocalTestDb,
  fakeCollectionRecordFactory,
  generateLocalTestDb,
  localStackConnectionEnv,
  migrationDir,
  fakeRuleRecordFactory,
  RulePgModel,
} = require('@cumulus/db');
const {
  constructCollectionId,
} = require('@cumulus/message/Collections');
const EsCollection = require('@cumulus/es-client/collections');
const { indexCollection } = require('@cumulus/es-client/indexer');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('@cumulus/es-client/testUtils');

const { AccessToken } = require('../../../models');
const {
  createFakeJwtAuthToken,
  setAuthorizedOAuthUsers,
  createCollectionTestRecords,
} = require('../../../lib/testUtils');
const assertions = require('../../../lib/assertions');
const { del } = require('../../../endpoints/collections');

process.env.AccessTokensTable = randomId('AccessTokens');
process.env.CollectionsTable = randomId('Collections');
process.env.stackName = randomId('stackName');
process.env.system_bucket = randomId('systemBucket');
process.env.TOKEN_SECRET = randomId('token');

// import the express app after setting the env variables
const { app } = require('../../../app');

const { buildFakeExpressResponse } = require('../utils');

let jwtAuthToken;
let accessTokenModel;

const testDbName = randomString(12);

test.before(async (t) => {
  process.env = {
    ...process.env,
    ...localStackConnectionEnv,
    PG_DATABASE: testDbName,
  };

  const { knex, knexAdmin } = await generateLocalTestDb(testDbName, migrationDir);
  t.context.testKnex = knex;
  t.context.testKnexAdmin = knexAdmin;

  t.context.collectionPgModel = new CollectionPgModel();

  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;
  t.context.esCollectionClient = new EsCollection(
    {},
    undefined,
    t.context.esIndex
  );

  await s3().createBucket({ Bucket: process.env.system_bucket }).promise();

  const username = randomString();
  await setAuthorizedOAuthUsers([username]);

  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();

  jwtAuthToken = await createFakeJwtAuthToken({ accessTokenModel, username });

  t.context.rulePgModel = new RulePgModel();

  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflow_template.json`,
    Body: JSON.stringify({}),
  }).promise();
});

test.beforeEach(async (t) => {
  t.context.testCollection = fakeCollectionRecordFactory();
  await t.context.collectionPgModel.create(t.context.testKnex, t.context.testCollection);

  const topicName = randomString();
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.collection_sns_topic_arn = TopicArn;
  t.context.TopicArn = TopicArn;

  const QueueName = randomString();
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
});

test.afterEach(async (t) => {
  const { QueueUrl, TopicArn } = t.context;
  await sqs().deleteQueue({ QueueUrl }).promise();
  await sns().deleteTopic({ TopicArn }).promise();
});

test.after.always(async (t) => {
  await accessTokenModel.deleteTable();
  await recursivelyDeleteS3Bucket(process.env.system_bucket);
  await cleanupTestIndex(t.context);
  await destroyLocalTestDb({
    knex: t.context.testKnex,
    knexAdmin: t.context.testKnexAdmin,
    testDbName,
  });
});

test('Attempting to delete a collection without an Authorization header returns an Authorization Missing response', async (t) => {
  const {
    testCollection,
    testKnex,
  } = t.context;
  const response = await request(app)
    .delete(`/collections/${testCollection.name}/${testCollection.version}`)
    .set('Accept', 'application/json')
    .expect(401);

  t.is(response.status, 401);
  t.true(
    await t.context.collectionPgModel.exists(
      testKnex,
      { name: testCollection.name, version: testCollection.version }
    )
  );
});

test('Attempting to delete a collection with an invalid access token returns an unauthorized response', async (t) => {
  const response = await request(app)
    .delete('/collections/asdf/asdf')
    .set('Accept', 'application/json')
    .set('Authorization', 'Bearer ThisIsAnInvalidAuthorizationToken')
    .expect(401);

  assertions.isInvalidAccessTokenResponse(t, response);
});

test.todo('Attempting to delete a collection with an unauthorized user returns an unauthorized response');

test('DELETE returns a 404 if PostgreSQL collection cannot be found', async (t) => {
  const nonExistentCollection = fakeCollectionRecordFactory();
  const response = await request(app)
    .delete(`/collections/${nonExistentCollection.name}/${nonExistentCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(404);
  t.is(response.body.message, 'No record found');
});

test.serial('DELETE successfully deletes if collection exists in PostgreSQL but not Elasticsearch', async (t) => {
  const {
    collectionPgModel,
    esCollectionClient,
    testKnex,
  } = t.context;
  const testCollection = fakeCollectionRecordFactory();
  await collectionPgModel.create(testKnex, testCollection);
  t.true(await collectionPgModel.exists(
    testKnex,
    {
      name: testCollection.name,
      version: testCollection.version,
    }
  ));
  t.false(
    await esCollectionClient.exists(
      constructCollectionId(testCollection.name, testCollection.version)
    )
  );

  await request(app)
    .delete(`/collections/${testCollection.name}/${testCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.false(
    await collectionPgModel.exists(
      t.context.testKnex,
      {
        name: testCollection.name,
        version: testCollection.version,
      }
    )
  );
  t.false(
    await esCollectionClient.exists(
      constructCollectionId(testCollection.name, testCollection.version)
    )
  );
});

test.serial('DELETE successfully deletes if collection exists in Elasticsearch but not PostgreSQL', async (t) => {
  const {
    collectionPgModel,
    esClient,
    esCollectionClient,
    testKnex,
  } = t.context;
  const testCollection = fakeCollectionRecordFactory();
  await indexCollection(esClient, testCollection, process.env.ES_INDEX);
  t.false(await collectionPgModel.exists(
    testKnex,
    {
      name: testCollection.name,
      version: testCollection.version,
    }
  ));
  t.true(
    await esCollectionClient.exists(
      constructCollectionId(testCollection.name, testCollection.version)
    )
  );

  await request(app)
    .delete(`/collections/${testCollection.name}/${testCollection.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.false(
    await collectionPgModel.exists(
      t.context.testKnex,
      {
        name: testCollection.name,
        version: testCollection.version,
      }
    )
  );
  t.false(
    await esCollectionClient.exists(
      constructCollectionId(testCollection.name, testCollection.version)
    )
  );
});

test.serial('Deleting a collection removes it from all data stores and publishes an SNS message', async (t) => {
  const { originalPgRecord } = await createCollectionTestRecords(t.context);

  t.true(await t.context.collectionPgModel.exists(t.context.testKnex, {
    name: originalPgRecord.name,
    version: originalPgRecord.version,
  }));
  t.true(
    await t.context.esCollectionClient.exists(
      constructCollectionId(originalPgRecord.name, originalPgRecord.version)
    )
  );

  await request(app)
    .delete(`/collections/${originalPgRecord.name}/${originalPgRecord.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(200);

  t.false(await t.context.collectionPgModel.exists(t.context.testKnex, {
    name: originalPgRecord.name,
    version: originalPgRecord.version,
  }));
  t.false(
    await t.context.esCollectionClient.exists(
      constructCollectionId(originalPgRecord.name, originalPgRecord.version)
    )
  );

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const message = JSON.parse(JSON.parse(Messages[0].Body).Message);
  t.is(message.event, 'Delete');
  t.true(Date.now() > message.deletedAt);
  t.deepEqual(
    message.record,
    { name: originalPgRecord.name, version: originalPgRecord.version }
  );
});

test.serial('Attempting to delete a collection with an associated rule returns a 409 response', async (t) => {
  const {
    testKnex,
    rulePgModel,
  } = t.context;

  const {
    originalPgRecord,
  } = await createCollectionTestRecords(t.context);

  const rule = fakeRuleRecordFactory({
    collection_cumulus_id: originalPgRecord.cumulus_id,
    type: 'onetime',
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({}),
  }).promise();

  await rulePgModel.create(testKnex, rule);

  const response = await request(app)
    .delete(`/collections/${originalPgRecord.name}/${originalPgRecord.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.is(response.status, 409);
  t.true(response.body.message.includes('Cannot delete collection with associated rules'));
});

test.serial('Attempting to delete a collection with an associated rule does not delete the provider', async (t) => {
  const {
    collectionPgModel,
    rulePgModel,
    testKnex,
  } = t.context;
  const { originalPgRecord } = await createCollectionTestRecords(t.context);

  const rule = fakeRuleRecordFactory({
    collection_cumulus_id: originalPgRecord.cumulus_id,
    type: 'onetime',
  });

  // The workflow message template must exist in S3 before the rule can be created
  await s3().putObject({
    Bucket: process.env.system_bucket,
    Key: `${process.env.stackName}/workflows/${rule.workflow}.json`,
    Body: JSON.stringify({}),
  }).promise();

  await rulePgModel.create(testKnex, rule);

  await request(app)
    .delete(`/collections/${originalPgRecord.name}/${originalPgRecord.version}`)
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${jwtAuthToken}`)
    .expect(409);

  t.true(await collectionPgModel.exists(
    testKnex,
    {
      name: originalPgRecord.name,
      version: originalPgRecord.version,
    }
  ));
});

test.serial('del() does not remove from Elasticsearch or publish SNS message if removing from PostgreSQL fails', async (t) => {
  const {
    originalPgRecord,
  } = await createCollectionTestRecords(
    t.context
  );

  const fakeCollectionPgModel = {
    delete: () => {
      throw new Error('something bad');
    },
    get: () => Promise.resolve(originalPgRecord),
  };

  const expressRequest = {
    params: {
      name: originalPgRecord.name,
      version: originalPgRecord.version,
    },
    body: originalPgRecord,
    testContext: {
      knex: t.context.testKnex,
      collectionPgModel: fakeCollectionPgModel,
    },
  };

  const response = buildFakeExpressResponse();

  await t.throwsAsync(
    del(expressRequest, response),
    { message: 'something bad' }
  );

  t.true(
    await t.context.collectionPgModel.exists(t.context.testKnex, {
      name: originalPgRecord.name,
      version: originalPgRecord.version,
    })
  );
  t.true(
    await t.context.esCollectionClient.exists(
      constructCollectionId(originalPgRecord.name, originalPgRecord.version)
    )
  );
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});

test.serial('del() does not remove from PostgreSQL or publish SNS message if removing from Elasticsearch fails', async (t) => {
  const {
    originalPgRecord,
  } = await createCollectionTestRecords(
    t.context
  );

  const fakeEsClient = {
    delete: () => {
      throw new Error('something bad');
    },
  };

  const expressRequest = {
    params: {
      name: originalPgRecord.name,
      version: originalPgRecord.version,
    },
    body: originalPgRecord,
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

  t.true(
    await t.context.collectionPgModel.exists(t.context.testKnex, {
      name: originalPgRecord.name,
      version: originalPgRecord.version,
    })
  );
  t.true(
    await t.context.esCollectionClient.exists(
      constructCollectionId(originalPgRecord.name, originalPgRecord.version)
    )
  );
  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages, undefined);
});
