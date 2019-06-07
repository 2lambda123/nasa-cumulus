'use strict';

const {
  lambda,
  sfn,
  sqs,
  s3PutObject,
  receiveSQSMessages
} = require('@cumulus/common/aws');
const StepFunctions = require('@cumulus/common/StepFunctions');
const {
  addCollections,
  deleteCollections
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  createTimestampedTestId,
  timestampedName,
  createTestSuffix,
  createTestDataPath,
  deleteFolder
} = require('../../helpers/testUtils');

const config = loadConfig();

const testName = createTimestampedTestId(config.stackName, 'testStartSf');
const testSuffix = createTestSuffix(testName);
const testDataFolder = createTestDataPath(testName);

const passSfName = timestampedName('passTestSf');
const passSfDef = {
  Comment: 'Pass-only step function',
  StartAt: 'PassState',
  States: {
    PassState: {
      Type: 'Pass',
      Result: '$.payload',
      End: true
    }
  }
};
const passSfRoleArn = `arn:aws:iam::${config.awsAccountId}:role/${config.stackName}-steprole`;

const passSfParams = {
  name: passSfName,
  definition: JSON.stringify(passSfDef),
  roleArn: passSfRoleArn
};

const sfStarterName = `${config.stackName}-sqs2sf`;

function generateStartSfMessages(num, workflowArn) {
  const arr = [];
  for (let i = 0; i < num; i += 1) {
    arr.push({ cumulus_meta: { state_machine: workflowArn }, payload: `message #${i}` });
  }
  return arr;
}

describe('the sf-starter lambda function', () => {
  let queueUrl;
  let passSfArn;

  beforeAll(async () => {
    const { QueueUrl } = await sqs().createQueue({
      QueueName: `${testName}Queue`
    }).promise();
    queueUrl = QueueUrl;

    const sfResponse = await sfn().createStateMachine(passSfParams).promise();
    passSfArn = sfResponse.stateMachineArn;
  });

  afterAll(async () => {
    await sqs().deleteQueue({
      QueueUrl: queueUrl
    }).promise();
    await sfn().deleteStateMachine({ stateMachineArn: passSfArn }).promise();
  });

  it('has a configurable message limit', () => {
    const messageLimit = config.sqs_consumer_rate;
    expect(messageLimit).toBe(300);
  });

  describe('when provided a queue', () => {
    const initialMessageCount = 30;
    const testMessageLimit = 25;
    let qAttrParams;
    let messagesConsumed;

    beforeAll(async () => {
      qAttrParams = {
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible']
      };
      // const { stateMachineArn } = await sfn().createStateMachine(passSfParams).promise();
      // passSfArn = stateMachineArn;
      const msgs = generateStartSfMessages(initialMessageCount, passSfArn);
      await Promise.all(
        msgs.map((msg) =>
          sqs().sendMessage({ QueueUrl: queueUrl, MessageBody: JSON.stringify(msg) }).promise())
      );
    });

    // afterAll(async () => {
    //   await sfn().deleteStateMachine({ stateMachineArn: passSfArn }).promise();
    // });

    it('that has messages', async () => {
      pending('until SQS provides a reliable getNumberOfMessages function');
      const { Attributes } = await sqs().getQueueAttributes(qAttrParams).promise();
      expect(Attributes.ApproximateNumberOfMessages).toBe(initialMessageCount.toString());
    });

    it('consumes the messages', async () => {
      const { Payload } = await lambda().invoke({
        FunctionName: sfStarterName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          queueUrl,
          messageLimit: testMessageLimit
        })
      }).promise();
      messagesConsumed = parseInt(Payload, 10);
      expect(messagesConsumed).toBeGreaterThan(0);
    });

    it('up to its message limit', async () => {
      pending('until SQS provides a way to confirm a given message/set of messages was deleted');
      const { Attributes } = await sqs().getQueueAttributes(qAttrParams).promise();
      const numOfMessages = parseInt(Attributes.ApproximateNumberOfMessages, 10); // sometimes returns 30 due to nature of SQS, failing test
      expect(numOfMessages).toBe(initialMessageCount - messagesConsumed);
    });

    it('to trigger workflows', async () => {
      const { executions } = await StepFunctions.listExecutions({ stateMachineArn: passSfArn });
      expect(executions.length).toBe(messagesConsumed);
    });
  });

  describe('when provided a queue with a maximum number of executions', () => {
    let maxQueueUrl;
    let maxQueueName;
    let templateUri;
    let templateKey;

    const queueMaxExecutions = 5;
    const numberOfMessages = 6;

    const collectionsDir = './data/collections/s3_MOD09GQ_006';
    const collection = {
      name: `MOD09GQ${testSuffix}`,
      dataType: `MOD09GQ${testSuffix}`,
      version: '006'
    };

    beforeAll(async () => {
      maxQueueName = `${testName}MaxQueue`;

      const { QueueUrl } = await sqs().createQueue({
        QueueName: maxQueueName
      }).promise();
      maxQueueUrl = QueueUrl;

      templateKey = `${testDataFolder}/${passSfName}.json`;
      templateUri = `s3://${config.bucket}/${templateKey}`;

      await Promise.all([
        s3PutObject({
          Bucket: config.bucket,
          Key: templateKey,
          Body: JSON.stringify({
            cumulus_meta: {
              state_machine: passSfArn
            },
            meta: {
              queues: {
                [maxQueueName]: maxQueueUrl
              },
              queueExecutionLimits: {
                [maxQueueName]: queueMaxExecutions
              }
            }
          })
        }),
        addCollections(config.stackName, config.bucket, collectionsDir, testSuffix)
      ]);
    });

    afterAll(async () => {
      await Promise.all([
        sqs().deleteQueue({
          QueueUrl: maxQueueUrl
        }).promise(),
        deleteCollections(config.stackName, config.bucket, [collection]),
        deleteFolder(config.bucket, testDataFolder)
      ]);
    });

    it('queue-granules returns the correct amount of queued executions', async () => {
      const granules = new Array(numberOfMessages)
        .fill()
        .map((value) => ({
          granuleId: `granule${value}`,
          dataType: collection.dataType,
          version: collection.version,
          files: []
        }));

      const { Payload } = await lambda().invoke({
        FunctionName: `${config.stackName}-QueueGranules`,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          cumulus_meta: {
            message_source: 'local',
            execution_name: 'test-execution',
            task: 'QueueGranules'
          },
          meta: {
            stack: config.stackName,
            buckets: {
              internal: {
                name: config.bucket
              }
            },
            templates: {
              [passSfName]: templateUri
            },
            provider: {},
            queues: {
              [maxQueueName]: maxQueueUrl
            }
          },
          workflow_config: {
            QueueGranules: {
              stackName: '{{$.meta.stack}}',
              queueUrl: `{{$.meta.queues.${maxQueueName}}}`,
              granuleIngestMessageTemplateUri: `{{$.meta.templates.${passSfName}}}`,
              provider: '{{$.meta.provider}}',
              internalBucket: '{{$.meta.buckets.internal.name}}'
            }
          },
          payload: {
            granules: granules
          }
        })
      }).promise();
      const { payload } = JSON.parse(Payload);
      expect(payload.queued.length).toEqual(numberOfMessages);
    });

    it('has the right amount of messages in the queue', async () => {
      const messages = await receiveSQSMessages(maxQueueUrl, {
        visibilityTimeout: 0,
        numOfMessages: numberOfMessages
      });
      expect(messages.length).toBeLessThanOrEqual(numberOfMessages);
    });

    it('consumes the right amount of messages', async () => {
      const { Payload } = await lambda().invoke({
        FunctionName: `${config.stackName}-sqs2sfThrottle`,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          queueUrl: maxQueueUrl,
          messageLimit: numberOfMessages
        })
      }).promise();
      const payload = parseInt(Payload, 10);
      expect(payload).toEqual(queueMaxExecutions);
    });
  });
});
