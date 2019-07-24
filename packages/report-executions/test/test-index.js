'use strict';

const test = require('ava');

const { Execution } = require('@cumulus/api/models');
const { parseException } = require('@cumulus/api/lib/utils');
const { constructCollectionId } = require('@cumulus/common/collection-config-store');
const { getExecutionArn } = require('@cumulus/common/aws');
const { randomId, randomString } = require('@cumulus/common/test-utils');
const { RecordDoesNotExist } = require('@cumulus/common/errors');

const { getReportExecutionMessages, handler } = require('..');

const fakeCollection = {
  name: 'fake-collection',
  version: '001'
};

const createExecutionMessage = ({
  status,
  stateMachine,
  executionName,
  startTime
}) => ({
  cumulus_meta: {
    state_machine: stateMachine,
    execution_name: executionName,
    workflow_start_time: startTime
  },
  meta: {
    collection: fakeCollection,
    status
  }
});

const createExecutionSnsMessage = ({
  status,
  stateMachine,
  executionName,
  startTime
}) => ({
  Sns: {
    Message: JSON.stringify(
      createExecutionMessage({
        status,
        stateMachine,
        executionName,
        startTime
      })
    )
  }
});

let executionsModel;

test.before(async () => {
  process.env.ExecutionsTable = randomId('executionsTable');
  executionsModel = new Execution();
  await executionsModel.createTable();
});

test.after.always(async () => {
  await executionsModel.deleteTable();
});

test('getReportExecutionMessages returns no tasks for non-execution messages', (t) => {
  let messages = getReportExecutionMessages([{}]);
  t.is(messages.length, 0);

  messages = getReportExecutionMessages([{
    Records: [{
      Sns: {}
    }]
  }]);
  t.is(messages.length, 0);

  messages = getReportExecutionMessages([{
    Records: [{
      Sns: {
        Message: 'message'
      }
    }]
  }]);
  t.is(messages.length, 0);

  messages = getReportExecutionMessages([{
    Records: [{
      Sns: {
        Message: JSON.stringify({
          meta: {}
        })
      }
    }]
  }]);
  t.is(messages.length, 0);
});

test('getReportExecutionMessages returns correct number of messages', (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomId('execution');

  const tasks = getReportExecutionMessages({
    Records: [
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        status: 'completed'
      }),
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        status: 'failed'
      }),
      { }
    ]
  });
  t.is(tasks.length, 2);
});

test('handler correctly creates execution record', async (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomString();
  const arn = getExecutionArn(stateMachine, executionName);

  await handler({
    Records: [
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        status: 'running',
        startTime: Date.now()
      })
    ]
  });

  t.true(await executionsModel.exists({ arn }));
});

test('handler throws error for update to non-existent execution', async (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomString();

  await t.throwsAsync(
    () => handler({
      Records: [
        createExecutionSnsMessage({
          stateMachine,
          executionName,
          status: 'completed'
        })
      ]
    }),
    { instanceOf: RecordDoesNotExist }
  );
});

test('handler correctly updates completed execution record', async (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomString();
  const arn = getExecutionArn(stateMachine, executionName);
  const startTime = Date.now();

  const status = 'completed';

  const executionMessage = createExecutionMessage({
    stateMachine,
    executionName,
    status: 'running',
    startTime
  });

  await executionsModel.createExecutionFromSns(executionMessage);
  const originalExecution = await executionsModel.get({ arn });

  await handler({
    Records: [
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        startTime,
        status
      })
    ]
  });

  const updatedExecution = await executionsModel.get({ arn });
  const expectedResponse = {
    ...originalExecution,
    status,
    duration: updatedExecution.duration,
    timestamp: updatedExecution.timestamp,
    updatedAt: updatedExecution.updatedAt
  };

  t.deepEqual(updatedExecution, expectedResponse);
});

test('handler correctly updates failed execution record', async (t) => {
  const stateMachine = randomId('stateMachine');
  const executionName = randomString();
  const arn = getExecutionArn(stateMachine, executionName);

  const startTime = Date.now();
  const status = 'failed';

  await executionsModel.createExecutionFromSns(
    createExecutionMessage({
      stateMachine,
      executionName,
      status: 'running',
      startTime
    })
  );
  const originalExecution = await executionsModel.get({ arn });

  await handler({
    Records: [
      createExecutionSnsMessage({
        stateMachine,
        executionName,
        startTime,
        status
      })
    ]
  });

  const updatedExecution = await executionsModel.get({ arn });
  const expectedResponse = {
    ...originalExecution,
    status,
    duration: updatedExecution.duration,
    timestamp: updatedExecution.timestamp,
    updatedAt: updatedExecution.updatedAt
  };

  t.deepEqual(updatedExecution, expectedResponse);
});

test('handler correctly updates multiple records', async (t) => {
  const stateMachine1 = randomId('stateMachine');
  const executionName1 = randomString();
  const arn1 = getExecutionArn(stateMachine1, executionName1);

  const stateMachine2 = randomId('stateMachine');
  const executionName2 = randomString();
  const arn2 = getExecutionArn(stateMachine2, executionName2);

  const startTime = Date.now();

  const status1 = 'failed';
  const status2 = 'completed';

  await Promise.all([
    executionsModel.createExecutionFromSns(
      createExecutionMessage({
        stateMachine: stateMachine1,
        executionName: executionName1,
        status: 'running',
        startTime
      })
    ),
    executionsModel.createExecutionFromSns(
      createExecutionMessage({
        stateMachine: stateMachine2,
        executionName: executionName2,
        status: 'running',
        startTime
      })
    )
  ]);

  const originalExecution1 = await executionsModel.get({ arn: arn1 });
  const originalExecution2 = await executionsModel.get({ arn: arn2 });

  await handler({
    Records: [
      createExecutionSnsMessage({
        stateMachine: stateMachine1,
        executionName: executionName1,
        startTime,
        status: status1
      }),
      createExecutionSnsMessage({
        stateMachine: stateMachine2,
        executionName: executionName2,
        startTime,
        status: status2
      })
    ]
  });

  const updatedExecution1 = await executionsModel.get({ arn: arn1 });

  const expectedResponse1 = {
    ...originalExecution1,
    status: status1,
    duration: updatedExecution1.duration,
    timestamp: updatedExecution1.timestamp,
    updatedAt: updatedExecution1.updatedAt
  };

  t.deepEqual(updatedExecution1, expectedResponse1);

  const updatedExecution2 = await executionsModel.get({ arn: arn2 });
  const expectedResponse2 = {
    ...originalExecution2,
    status: status2,
    duration: updatedExecution2.duration,
    timestamp: updatedExecution2.timestamp,
    updatedAt: updatedExecution2.updatedAt
  };

  t.deepEqual(updatedExecution2, expectedResponse2);
});
