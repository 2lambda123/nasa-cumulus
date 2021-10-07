'use strict';

const test = require('ava');
const sinon = require('sinon');
const cryptoRandomString = require('crypto-random-string');

const { sns, sqs } = require('@cumulus/aws-client/services');

const {
  publishSnsMessageByDataType,
} = require('../../lib/publishSnsMessageUtils');

const {
  fakeExecutionFactoryV2,
  fakeCollectionFactory,
  fakePdrFactoryV2,
} = require('../../lib/testUtils');

test.before(async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
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
});

test.after.always(async (t) => {
  const { QueueUrl, TopicArn } = t.context;

  await Promise.all([
    sqs().deleteQueue({ QueueUrl }).promise(),
    sns().deleteTopic({ TopicArn }).promise(),
  ]);
});

test.serial('publishSnsMessageByDataType() does not publish an execution SNS message if execution_sns_topic_arn is undefined', async (t) => {
  const { QueueUrl } = t.context;
  const newExecution = fakeExecutionFactoryV2({
    arn: cryptoRandomString({ length: 5 }),
    status: 'completed',
    name: 'test_execution',
  });
  await t.throwsAsync(
    publishSnsMessageByDataType(newExecution, 'execution'),
    { message: 'The execution_sns_topic_arn environment variable must be set' }
  );
  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages, undefined);
});

test.serial('publishSnsMessageByDataType() publishes an SNS message for execution', async (t) => {
  process.env.execution_sns_topic_arn = t.context.TopicArn;
  const executionArn = cryptoRandomString({ length: 10 });
  const newExecution = fakeExecutionFactoryV2({
    arn: executionArn,
    status: 'completed',
    name: 'test_execution',
  });
  await publishSnsMessageByDataType(newExecution, 'execution');

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const executionRecord = JSON.parse(snsMessage.Message);

  t.deepEqual(executionRecord.arn, executionArn);
  t.deepEqual(executionRecord.status, newExecution.status);
});

test.serial('publishSnsMessageByDataType() does not publish a collection SNS message if collection_sns_topic_arn is undefined', async (t) => {
  const { QueueUrl } = t.context;
  const newCollection = fakeCollectionFactory();

  t.teardown(() => {
    process.env.collection_sns_topic_arn = t.context.TopicArn;
  });

  await t.throwsAsync(
    publishSnsMessageByDataType(newCollection, 'collection', 'Update'),
    { message: 'The collection_sns_topic_arn environment variable must be set' }
  );

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages, undefined);
});

test.serial('publishSnsMessageByDataType() publishes a collection SNS message for the event type Create', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishSnsMessageByDataType(newCollection, 'collection', 'Create');

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const message = JSON.parse(snsMessage.Message);

  t.deepEqual(message.record, newCollection);
  t.is(message.event, 'Create');
});

test.serial('publishSnsMessageByDataType() publishes a collection SNS message for the event type Update', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishSnsMessageByDataType(newCollection, 'collection', 'Update');

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const message = JSON.parse(snsMessage.Message);

  t.deepEqual(message.record, newCollection);
  t.is(message.event, 'Update');
});

test.serial('publishSnsMessageByDataType() publishes a collection SNS message for the event type Delete', async (t) => {
  process.env.collection_sns_topic_arn = t.context.TopicArn;
  const deletedAt = Date.now();
  const stub = sinon.stub(Date, 'now').returns(deletedAt);
  t.teardown(() => {
    stub.restore();
  });

  const collectionName = cryptoRandomString({ length: 10 });
  const newCollection = fakeCollectionFactory({ name: collectionName });
  await publishSnsMessageByDataType(newCollection, 'collection', 'Delete');

  const { Messages } = await sqs().receiveMessage({
    QueueUrl: t.context.QueueUrl,
    WaitTimeSeconds: 10,
  }).promise();
  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const message = JSON.parse(snsMessage.Message);

  t.deepEqual(message.record, { name: newCollection.name, version: newCollection.version });
  t.is(message.event, 'Delete');
  t.is(message.deletedAt, deletedAt);
});

test.serial('publishSnsMessageByDataType() does not publish a PDR SNS message if pdr_sns_topic_arn is undefined', async (t) => {
  const { QueueUrl } = t.context;
  const newPdr = fakePdrFactoryV2({
    pdrName: 'test_pdr',
  });
  await t.throwsAsync(
    publishSnsMessageByDataType(newPdr, 'pdr'),
    { message: 'The pdr_sns_topic_arn environment variable must be set' }
  );

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();
  t.is(Messages, undefined);
});

test.serial('publishSnsMessageByDataType() publishes a PDR SNS message', async (t) => {
  const topicName = cryptoRandomString({ length: 10 });
  const { TopicArn } = await sns().createTopic({ Name: topicName }).promise();
  process.env.pdr_sns_topic_arn = TopicArn;

  const QueueName = cryptoRandomString({ length: 10 });
  const { QueueUrl } = await sqs().createQueue({ QueueName }).promise();
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

  const pdrName = cryptoRandomString({ length: 10 });
  const newPdr = fakePdrFactoryV2({
    pdrName,
  });
  await publishSnsMessageByDataType(newPdr, 'pdr');

  const { Messages } = await sqs().receiveMessage({ QueueUrl, WaitTimeSeconds: 10 }).promise();

  t.is(Messages.length, 1);

  const snsMessage = JSON.parse(Messages[0].Body);
  const pdrRecord = JSON.parse(snsMessage.Message);

  t.deepEqual(pdrRecord.pdrName, pdrName);
  t.deepEqual(pdrRecord.status, newPdr.status);
});
