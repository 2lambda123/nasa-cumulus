'use strict';

const test = require('ava');
const rewire = require('rewire');
const cryptoRandomString = require('crypto-random-string');

const cwSfExecutionEventUtils = rewire('../../lib/cwSfExecutionEventUtils');

const getFailedExecutionMessage = cwSfExecutionEventUtils.__get__('getFailedExecutionMessage');
const getCumulusMessageFromExecutionEvent = cwSfExecutionEventUtils.__get__('getCumulusMessageFromExecutionEvent');
const getFailedStepName = cwSfExecutionEventUtils.__get__('getFailedStepName');
const lastFailedEventStep = cwSfExecutionEventUtils.__get__('lastFailedEventStep');

const randomFailedStepNameFn = () => `StepName${cryptoRandomString({ length: 10 })}`;

test.serial('getFailedExecutionMessage() returns the Cumulus message from the output of the last failed step with FailedExecutionStepName amended.', async (t) => {
  const inputMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };
  const randomFailedStepName = randomFailedStepNameFn();
  const failedTaskOutput = { a: 1, exception: { Error: 'anError' } };
  const expected = { a: 1, exception: { Error: 'anError', failedExecutionStepName: randomFailedStepName } };

  const result = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [
            {
              type: 'TaskStateEntered',
              id: 1,
              previousEventId: 0,
            },
            {
              type: 'TaskStateEntered',
              id: 2,
              previousEventId: 1,
              stateEnteredEventDetails: {
                name: randomFailedStepName,
              },
            },
            {
              // lastStepFailedEvent
              type: 'LambdaFunctionFailed',
              id: 3,
              previousEventId: 2,
            },
            {
              // failedStepExitedEvent
              type: 'TaskStateExited',
              id: 4,
              previousEventId: 3,
              stateExitedEventDetails: {
                output: JSON.stringify(failedTaskOutput),
              },
            },
          ],
        };
      },
    },
  })(() => getFailedExecutionMessage(inputMessage));

  t.deepEqual(result, expected);
});

test.serial('getFailedExecutionMessage() returns the input message if there is an error fetching the output of the last failed step', async (t) => {
  // This invalid message will cause getFailedExecutionMessage to fail because
  // it does not contain cumulus_meta.state_machine or cumulus_meta.execution_name
  const inputMessage = { a: 1 };

  const actualResult = await getFailedExecutionMessage(inputMessage);

  t.deepEqual(actualResult, inputMessage);
});

test.serial('getFailedExecutionMessage() returns the input message when no ActivityFailed or LambdaFunctionFailed events are found in the execution history', async (t) => {
  const inputMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };

  const actualResult = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [],
        };
      },
    },
  })(() => getFailedExecutionMessage(inputMessage));

  t.deepEqual(actualResult, inputMessage);
});

test.serial('getFailedExecutionMessage() returns the input message with the details from the last failed lambda step event in the exception field if the failed step exited event cannot be found', async (t) => {
  const inputMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };

  const actualResult = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [
            {
              // lastStepFailedEvent
              type: 'LambdaFunctionFailed',
              id: 1,
              lambdaFunctionFailedEventDetails: {
                type: 'really bad',
              },
            },
          ],
        };
      },
    },
  })(() => getFailedExecutionMessage(inputMessage));

  const expectedResult = {
    ...inputMessage,
    exception: {
      type: 'really bad',
      failedExecutionStepName: 'UnknownFailedStepName',
    },
  };

  t.deepEqual(actualResult, expectedResult);
});

test.serial('getFailedExecutionMessage() returns the input message with the details from the last failed activity step event in the exception field if the failed step exited event cannot be found', async (t) => {
  const inputMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
    },
  };
  const randomFailedStepName = randomFailedStepNameFn();
  const actualResult = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [
            {
              type: 'TaskStateEntered',
              id: 1,
              stateEnteredEventDetails: {
                name: randomFailedStepName,
              },
            },
            {
              // lastStepFailedEvent
              type: 'ActivityFailed',
              id: 2,
              previousEventId: 1,
              activityFailedEventDetails: {
                reason: 'busted',
              },
            },
          ],
        };
      },
    },
  })(() => getFailedExecutionMessage(inputMessage));

  const expectedResult = {
    ...inputMessage,
    exception: {
      reason: 'busted',
      failedExecutionStepName: randomFailedStepName,
    },
  };

  t.deepEqual(actualResult, expectedResult);
});

test('getCumulusMessageFromExecutionEvent() returns the event input for a RUNNING event', async (t) => {
  const event = {
    detail: {
      status: 'RUNNING',
      input: JSON.stringify({
        cumulus_meta: {
          workflow_start_time: 122,
        },
      }),
      startDate: 123,
      stopDate: null,
    },
  };

  const message = await getCumulusMessageFromExecutionEvent(event);

  const expectedMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
      workflow_stop_time: null,
    },
    meta: {
      status: 'running',
    },
  };

  t.deepEqual(message, expectedMessage);
});

test('getCumulusMessageFromExecutionEvent() returns the event output for a SUCCEEDED event', async (t) => {
  const event = {
    detail: {
      status: 'SUCCEEDED',
      output: JSON.stringify({
        cumulus_meta: {
          workflow_start_time: 122,
        },
      }),
      startDate: 123,
      stopDate: 124,
    },
  };

  const message = await getCumulusMessageFromExecutionEvent(event);

  const expectedMessage = {
    cumulus_meta: {
      workflow_start_time: 122,
      workflow_stop_time: 124,
    },
    meta: {
      status: 'completed',
    },
  };

  t.deepEqual(message, expectedMessage);
});

test.serial('getCumulusMessageFromExecutionEvent() returns the failed execution message for a failed event', async (t) => {
  const input = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
      workflow_start_time: 122,
    },
  };

  const event = {
    detail: {
      status: 'FAILED',
      input: JSON.stringify(input),
      startDate: 123,
      stopDate: 124,
    },
  };

  const failedTaskOutput = input;

  const message = await cwSfExecutionEventUtils.__with__({
    StepFunctions: {
      getExecutionHistory: ({ executionArn }) => {
        if (executionArn !== 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name') {
          throw new Error(`Expected executionArn === 'arn:aws:states:us-east-1:111122223333:execution:HelloWorld-StateMachine:my-execution-name' but got ${executionArn}`);
        }
        return {
          events: [
            {
              // lastStepFailedEvent
              type: 'LambdaFunctionFailed',
              id: 3,
            },
            {
              // failedStepExitedEvent
              type: 'TaskStateExited',
              previousEventId: 3,
              stateExitedEventDetails: {
                output: JSON.stringify(failedTaskOutput),
              },
            },
          ],
        };
      },
    },
    pullStepFunctionEvent: () => Promise.resolve(input),
  })(() => getCumulusMessageFromExecutionEvent(event));

  const expectedMessage = {
    cumulus_meta: {
      state_machine: 'arn:aws:states:us-east-1:111122223333:stateMachine:HelloWorld-StateMachine',
      execution_name: 'my-execution-name',
      workflow_start_time: 122,
      workflow_stop_time: 124,
    },
    meta: {
      status: 'failed',
    },
  };

  t.deepEqual(message, expectedMessage);
});

test('getFailedStepName() returns the name of the most recent TaskStateEntered event prior to the Failed event. Ignoring any that TaskStateEntered that happen after the failed event.', (t) => {
  const randomFailedStepName = randomFailedStepNameFn();
  const events = [
    {
      type: 'TaskStateEntered',
      id: 2,
      previousEventId: 0,
      stateEnteredEventDetails: {
        name: randomFailedStepName,
      },
    },
    {
      type: 'LambdaFunctionScheduled',
      id: 3,
      previousEventId: 2,
      lambdaFunctionScheduledEventDetails: {
        inputDetails: [],
      },
    },
    {
      type: 'LambdaFunctionStarted',
      id: 4,
      previousEventId: 3,
    },
    {
      type: 'LambdaFunctionFailed',
      id: 5,
      previousEventId: 4,
      lambdaFunctionFailedEventDetails: {
        error: 'ThisIsTheFailureWeAreTesting',
        cause: 'something',
      },
    },
    {
      type: 'TaskStateEntered',
      id: 6,
      previousEventId: 5,
      stateEnteredEventDetails: {
        name: 'ALaterSuccessfulTaskEntered',
      },
    },
    {
      type: 'LambdaFunctionExited',
      id: 7,
      previousEventId: 6,
    },
  ];

  const failedEvent = {
    type: 'LambdaFunctionFailed',
    id: 5,
    previousEventId: 4,
    lambdaFunctionFailedEventDetails: {
      error: 'ThisIsTheFailureWeAreTesting',
      cause: 'something',
    },
  };

  const expected = randomFailedStepName;
  const actual = getFailedStepName(events, failedEvent);

  t.is(actual, expected);
});

test('getFailedStepName() returns UnknownFailedStepName if no TaskStateEntered events exist before the failed id.', (t) => {
  const events = [
    {
      type: 'LambdaFunctionScheduled',
      id: 3,
      previousEventId: 2,
      lambdaFunctionScheduledEventDetails: {
        inputDetails: [],
      },
    },
    {
      type: 'LambdaFunctionStarted',
      id: 4,
      previousEventId: 3,
    },
    {
      type: 'LambdaFunctionFailed',
      id: 5,
      previousEventId: 4,
      lambdaFunctionFailedEventDetails: {
        error: 'CumulusMessageAdapterExecutionError',
        cause: 'someCause',
      },
    },
  ];

  const expected = 'UnknownFailedStepName';
  const actual = getFailedStepName(events, 5);

  t.is(actual, expected);
});

test('lastFailedEventStep() returns the event for a failed lambda.', (t) => {
  const events = [
    {
      type: 'ActivityFailed',
      id: 3,
      previousEventId: 0,
    },
    {
      type: 'LambdaFunctionFailed',
      id: 5,
      previousEventId: 4,
    },
  ];

  const expected = {
    type: 'LambdaFunctionFailed',
    id: 5,
    previousEventId: 4,
  };

  const actual = lastFailedEventStep(events);
  t.deepEqual(actual, expected);
});

test('lastFailedEventStep() returns the event for a failed Activity.', (t) => {
  const events = [
    {
      type: 'ActivityFailed',
      id: 3,
      previousEventId: 0,
    },
    {
      type: 'LambdaFunctionFailed',
      id: 4,
      previousEventId: 3,
    },
    {
      type: 'ActivityFailed',
      id: 5,
      previousEventId: 5,
    },
  ];

  const expected = {
    type: 'ActivityFailed',
    id: 5,
    previousEventId: 5,
  };

  const actual = lastFailedEventStep(events);
  t.deepEqual(actual, expected);
});

test('lastFailedEventStep() returns undefined if no failed lambda or activities are found.', (t) => {
  const events = [
    {
      type: 'TaskStateEntered',
      id: 3,
      previousEventId: 0,
    },
    {
      type: 'TaskStateExited',
      id: 4,
      previousEventId: 3,
    },
    {
      type: 'ExecutionFailed',
      id: 5,
      previousEventId: 5,
    },
  ];
  const expected = undefined;
  const actual = lastFailedEventStep(events);
  t.is(actual, expected);
});
