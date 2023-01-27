'use strict';

const isNumber = require('lodash/isNumber');
const rewire = require('rewire');
const test = require('ava');

const awsServices = require('@cumulus/aws-client/services');
const {
  createQueue,
  receiveSQSMessages,
  sendSQSMessage,
} = require('@cumulus/aws-client/SQS');
const { ResourcesLockedError } = require('@cumulus/errors');
const { randomId } = require('@cumulus/common/test-utils');

const Semaphore = require('../../lib/Semaphore');
const sfStarter = rewire('../../lambdas/sf-starter');
const { Manager } = require('../../models');

const {
  incrementAndDispatch,
  handleEvent,
  handleThrottledEvent,
  handleSourceMappingEvent,
} = sfStarter;

class stubConsumer {
  consume() {
    return Promise.resolve(9);
  }
}

// Mock startExecution so nothing attempts to start executions.
const stubSFN = () => ({
  startExecution: () => ({
    promise: () => Promise.resolve({}),
  }),
});
sfStarter.__set__('sfn', stubSFN);

let manager;

const createRuleInput = (queueUrl, timeLimit = 60) => ({
  queueUrl,
  messageLimit: 50,
  timeLimit,
});

const createWorkflowMessage = (queueUrl, maxExecutions) => JSON.stringify({
  cumulus_meta: {
    queueUrl,
    queueExecutionLimits: {
      [queueUrl]: maxExecutions,
    },
  },
});

const createSendMessageTasks = (queueUrl, message, total) => {
  let count = 0;
  const tasks = [];
  while (count < total) {
    tasks.push(sendSQSMessage(
      queueUrl,
      message
    ));
    count += 1;
  }
  return tasks;
};

test.before(async () => {
  process.env.SemaphoresTable = randomId('semaphoreTable');
  manager = new Manager({
    tableName: process.env.SemaphoresTable,
    tableHash: { name: 'key', type: 'S' },
  });
  await manager.createTable();
});

test.beforeEach(async (t) => {
  t.context.semaphore = new Semaphore(
    awsServices.dynamodbDocClient(),
    process.env.SemaphoresTable
  );
  t.context.client = awsServices.dynamodbDocClient();
  t.context.queueUrl = await createQueue(randomId('queue'));
});

test.afterEach.always(
  (t) =>
    awsServices.sqs().deleteQueue({ QueueUrl: t.context.queueUrl }).promise()
);

test.after.always(() => manager.deleteTable());

test('dispatch() sets the workflow_start_time', async (t) => {
  const { queueUrl } = t.context;

  const cumulusMessage = {
    cumulus_meta: {
      state_machine: 'my-state-machine',
      execution_name: 'my-execution-name',
    },
  };

  const sqsMessage = {
    Body: JSON.stringify(cumulusMessage),
  };

  let startExecutionParams;

  await sfStarter.__with__({
    sfn: () => ({
      startExecution: (params) => {
        startExecutionParams = params;
        return ({
          promise: () => Promise.resolve({}),
        });
      },
    }),
  })(() => sfStarter.__get__('dispatch')(queueUrl, sqsMessage));

  const executionInput = JSON.parse(startExecutionParams.input);

  t.true(isNumber(executionInput.cumulus_meta.workflow_start_time));
  t.true(executionInput.cumulus_meta.workflow_start_time <= Date.now());
});

test('dispatch() sets cumulus_meta.queueUrl', async (t) => {
  const { queueUrl } = t.context;

  const cumulusMessage = {
    cumulus_meta: {
      state_machine: 'my-state-machine',
      execution_name: 'my-execution-name',
    },
  };

  const sqsMessage = {
    Body: JSON.stringify(cumulusMessage),
  };

  let startExecutionParams;

  await sfStarter.__with__({
    sfn: () => ({
      startExecution: (params) => {
        startExecutionParams = params;
        return ({
          promise: () => Promise.resolve({}),
        });
      },
    }),
  })(() => sfStarter.__get__('dispatch')(queueUrl, sqsMessage));

  const executionInput = JSON.parse(startExecutionParams.input);
  t.is(executionInput.cumulus_meta.queueUrl, queueUrl);
});

test(
  'handleEvent throws error when queueUrl is undefined',
  (t) =>
    t.throwsAsync(
      () => handleEvent(createRuleInput()),
      { message: 'queueUrl is missing' }
    )
);

test.serial('handleEvent returns the number of messages consumed', async (t) => {
  const revert = sfStarter.__set__('Consumer', stubConsumer);
  const ruleInput = createRuleInput('queue');
  let data;
  try {
    data = await handleEvent(ruleInput);
  } finally {
    revert();
  }
  t.is(data, 9);
});

test('incrementAndDispatch throws error for message without queue URL', async (t) => {
  const { queueUrl } = t.context;
  await t.throwsAsync(
    () => incrementAndDispatch(queueUrl, { Body: createWorkflowMessage() })
  );
});

test('incrementAndDispatch throws error for message with no maximum executions value', async (t) => {
  const { queueUrl } = t.context;

  await t.throwsAsync(
    () => incrementAndDispatch(queueUrl, { Body: createWorkflowMessage(queueUrl) })
  );
});

test('incrementAndDispatch increments priority semaphore', async (t) => {
  const { semaphore, queueUrl } = t.context;

  const message = createWorkflowMessage(queueUrl, 5);

  await incrementAndDispatch(queueUrl, { Body: message });

  const response = await semaphore.get(queueUrl);
  t.is(response.semvalue, 1);
});

test.serial('incrementAndDispatch decrements priority semaphore if dispatch() throws error', async (t) => {
  const { semaphore, queueUrl } = t.context;

  const message = createWorkflowMessage(queueUrl, 5);

  const stubSFNThrowError = () => ({
    startExecution: () => ({
      promise: async () => {
        const response = await semaphore.get(queueUrl);
        t.is(response.semvalue, 1);
        throw new Error('testing');
      },
    }),
  });
  const revert = sfStarter.__set__('sfn', stubSFNThrowError);

  try {
    await incrementAndDispatch(queueUrl, { Body: message });
  } catch (error) {
    const response = await semaphore.get(queueUrl);
    t.is(response.semvalue, 0);
  } finally {
    revert();
  }
});

test('incrementAndDispatch throws error when trying to increment priority semaphore beyond maximum', async (t) => {
  const { client, queueUrl } = t.context;
  const maxExecutions = 5;

  // Set semaphore value to the maximum.
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueUrl,
      semvalue: maxExecutions,
    },
  });

  await t.throwsAsync(
    () => incrementAndDispatch(queueUrl, { Body: createWorkflowMessage(queueUrl, maxExecutions) }),
    { instanceOf: ResourcesLockedError }
  );
});

test('handleThrottledEvent starts 0 executions when priority semaphore is at maximum', async (t) => {
  const { client, queueUrl } = t.context;
  const maxExecutions = 5;

  // Set semaphore value to the maximum.
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueUrl,
      semvalue: maxExecutions,
    },
  });

  const message = createWorkflowMessage(queueUrl, maxExecutions);

  await sendSQSMessage(
    queueUrl,
    message
  );

  const result = await handleThrottledEvent({ queueUrl });
  t.is(result, 0);
});

test('handleThrottledEvent starts MAX - N executions for messages with priority', async (t) => {
  const { client, queueUrl } = t.context;

  const maxExecutions = 5;
  const initialSemValue = 2;
  const numOfMessages = 4;
  const messageLimit = numOfMessages;

  // Set initial semaphore value.
  await client.put({
    TableName: process.env.SemaphoresTable,
    Item: {
      key: queueUrl,
      semvalue: initialSemValue,
    },
  });

  const message = createWorkflowMessage(queueUrl, maxExecutions);

  // Create 4 messages in the queue.
  const sendMessageTasks = createSendMessageTasks(queueUrl, message, numOfMessages);
  await Promise.all(sendMessageTasks);

  const result = await handleThrottledEvent({
    queueUrl,
    messageLimit,
  }, 0);
  // Only 3 executions should have been started, even though 4 messages are in the queue
  //   5 (semaphore max )- 2 (initial value) = 3 available executions
  t.is(result, maxExecutions - initialSemValue);

  // There should be 1 message left in the queue.
  //   4 initial messages - 3 messages read/deleted = 1 message
  const messages = await receiveSQSMessages(queueUrl, {
    numOfMessages: messageLimit,
  });
  t.is(messages.length, numOfMessages - result);
});

test('handleSourceMappingEvent calls dispatch on messages in an EventSource event', async (t) => {
  // EventSourceMapping input uses 'body' instead of 'Body'
  const event = {
    Records: [
      {
        eventSourceARN: 'queue-url',
        body: createWorkflowMessage('test'),
      },
      {
        eventSourceARN: 'queue-url',
        body: createWorkflowMessage('test'),
      },
    ],
  };
  const output = await handleSourceMappingEvent(event);

  const dispatchReturn = await stubSFN().startExecution().promise();
  output.forEach((o) => t.deepEqual(o, dispatchReturn));
});
