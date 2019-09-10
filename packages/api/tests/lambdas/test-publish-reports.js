'use strict';

const test = require('ava');
const rewire = require('rewire');
const sinon = require('sinon');

const aws = require('@cumulus/common/aws');
const { getMessageExecutionArn } = require('@cumulus/common/message');
const StepFunctions = require('@cumulus/common/StepFunctions');
const { randomId, randomNumber, randomString } = require('@cumulus/common/test-utils');

const { fakeGranuleFactoryV2, fakeFileFactory } = require('../../lib/testUtils');
const { deconstructCollectionId } = require('../../lib/utils');

const publishReports = rewire('../../lambdas/publish-reports');

let snsStub;
let granulePublishSpy;
let pdrPublishSpy;
let snsPublishSpy;
let stepFunctionsStub;

const sfEventSource = 'aws.states';

const createCloudwatchEventMessage = (
  status,
  message,
  source = sfEventSource
) => {
  const messageString = JSON.stringify(message);
  const detail = (status === 'SUCCEEDED'
    ? { status, output: messageString }
    : { status, input: messageString });
  return { source, detail };
};

const createFakeGranule = (granuleParams = {}, fileParams = {}) => fakeGranuleFactoryV2({
  files: [
    fakeFileFactory(fileParams),
    fakeFileFactory(fileParams),
    fakeFileFactory(fileParams)
  ],
  ...granuleParams
});

const createCumulusMessage = ({
  numberOfGranules = 1,
  cMetaParams = {},
  collectionId = `${randomId('MOD')}___${randomNumber()}`,
  granuleParams = {},
  fileParams = {}
} = {}) => ({
  cumulus_meta: {
    execution_name: randomId('execution'),
    state_machine: randomId('ingest-'),
    ...cMetaParams
  },
  meta: {
    collection: deconstructCollectionId(collectionId),
    provider: {
      id: 'prov1',
      protocol: 'http',
      host: 'example.com',
      port: 443
    }
  },
  payload: {
    granules: [
      ...new Array(numberOfGranules)
    ].map(createFakeGranule.bind(null, { collectionId, ...granuleParams }, fileParams)),
    pdr: {
      name: randomString()
    }
  }
});

test.before(async () => {
  snsStub = sinon.stub(aws, 'sns').returns({
    publish: () => ({
      promise: () => Promise.resolve()
    })
  });

  const fakeExecution = async () => ({
    startDate: new Date(Date.UTC(2019, 6, 28)),
    stopDate: new Date(Date.UTC(2019, 6, 28, 1))
  });
  stepFunctionsStub = sinon.stub(StepFunctions, 'describeExecution').callsFake(fakeExecution);

  granulePublishSpy = sinon.spy();
  pdrPublishSpy = sinon.spy();
  snsPublishSpy = sinon.spy(aws.sns(), 'publish');
});

test.beforeEach((t) => {
  process.env.execution_sns_topic_arn = randomString();
  process.env.granule_sns_topic_arn = randomString();
  process.env.pdr_sns_topic_arn = randomString();

  t.context.snsTopicArns = [
    process.env.execution_sns_topic_arn,
    process.env.granule_sns_topic_arn,
    process.env.pdr_sns_topic_arn
  ];

  t.context.message = createCumulusMessage({
    numberOfGranules: 1
  });

  t.context.executionArn = getMessageExecutionArn(t.context.message);

  granulePublishSpy.resetHistory();
  pdrPublishSpy.resetHistory();
  snsPublishSpy.resetHistory();
});

test.after.always(async () => {
  snsStub.restore();
  stepFunctionsStub.restore();
});

test.serial('lambda publishes correct report to all SNS topics', async (t) => {
  const { message, snsTopicArns } = t.context;

  const cwEventMessage = createCloudwatchEventMessage(
    'SUCCEEDED',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(snsPublishSpy.callCount, 3);

  // executions topic
  const expectedMessage = {
    ...message,
    meta: {
      ...message.meta,
      status: 'completed'
    }
  };
  t.deepEqual(JSON.parse(snsPublishSpy.args[0][0].Message), expectedMessage);
  t.true(snsTopicArns.includes(snsPublishSpy.args[0][0].TopicArn));

  // granules topic
  // const [granule] = message.payload.granules;
  // t.deepEqual(JSON.parse(snsPublishSpy.args[1][0].Message), {
  //   ...granule,
  //   executionArn
  // });
  t.true(snsTopicArns.includes(snsPublishSpy.args[1][0].TopicArn));

  // PDRs topic
  t.true(snsTopicArns.includes(snsPublishSpy.args[2][0].TopicArn));
});

test.todo('event status is correctly converted to message status');

test.serial('lambda without granules in message does not publish to granule SNS topic', async (t) => {
  const { message } = t.context;

  const granulePublishMock = publishReports.__set__('publishGranuleSnsMessage', granulePublishSpy);

  delete message.payload.granules;

  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(granulePublishSpy.callCount, 0);

  // revert the mocking
  granulePublishMock();
});

test.serial('lambda ignores granules without granule ID', async (t) => {
  const granulePublishMock = publishReports.__set__('publishGranuleSnsMessage', granulePublishSpy);

  const message = createCumulusMessage({
    numberOfGranules: 3
  });
  message.payload.granules.push({});

  t.is(message.payload.granules.length, 4);

  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(granulePublishSpy.callCount, 3);

  // revert the mocking
  granulePublishMock();
});

test.serial('lambda publishes correct number of granules from payload.granules to SNS topic', async (t) => {
  const granulePublishMock = publishReports.__set__('publishGranuleSnsMessage', granulePublishSpy);

  const message = createCumulusMessage({
    numberOfGranules: 5
  });

  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(granulePublishSpy.callCount, 5);

  // revert the mocking
  granulePublishMock();
});

test.serial('lambda publishes correct number of granules from meta.input_granules to SNS topic', async (t) => {
  const granulePublishMock = publishReports.__set__('publishGranuleSnsMessage', granulePublishSpy);

  const message = createCumulusMessage({
    numberOfGranules: 7
  });

  const { granules } = message.payload;
  delete message.payload;
  message.meta.input_granules = granules;

  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(granulePublishSpy.callCount, 7);

  // revert the mocking
  granulePublishMock();
});

test.serial('lambda without PDR in message does not publish to PDR SNS topic', async (t) => {
  const { message } = t.context;

  const pdrPublishMock = publishReports.__set__('publishPdrSnsMessage', pdrPublishSpy);

  delete message.payload.pdr;

  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(pdrPublishSpy.callCount, 0);

  // revert the mocking
  pdrPublishMock();
});

test.serial('lambda without valid PDR in message does not publish to PDR SNS topic', async (t) => {
  const { message } = t.context;

  const pdrPublishMock = publishReports.__set__('publishPdrSnsMessage', pdrPublishSpy);

  delete message.payload.pdr.name;

  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(pdrPublishSpy.callCount, 0);

  // revert the mocking
  pdrPublishMock();
});

test.serial('lambda publishes PDR from meta.pdr to SNS topic', async (t) => {
  const { message } = t.context;

  const pdrPublishMock = publishReports.__set__('publishPdrSnsMessage', pdrPublishSpy);

  const { pdr } = message.payload;
  message.meta.pdr = pdr;

  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(pdrPublishSpy.callCount, 1);

  // revert the mocking
  pdrPublishMock();
});

test.serial('publish failure to executions topic does not affect publishing to other topics', async (t) => {
  // delete env var to cause failure publishing to executions topic
  delete process.env.execution_sns_topic_arn;

  const { message } = t.context;
  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(snsPublishSpy.callCount, 2);
});

test.serial('publish failure to granules topic does not affect publishing to other topics', async (t) => {
  // delete env var to cause failure publishing to granules topic
  delete process.env.granule_sns_topic_arn;

  const { message } = t.context;
  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(snsPublishSpy.callCount, 2);
});

test.serial('publish failure to PDRs topic does not affect publishing to other topics', async (t) => {
  // delete env var to cause failure publishing to PDRS topic
  delete process.env.pdr_sns_topic_arn;

  const { message } = t.context;
  const cwEventMessage = createCloudwatchEventMessage(
    'RUNNING',
    message
  );

  await publishReports.handler(cwEventMessage);

  t.is(snsPublishSpy.callCount, 2);
});
