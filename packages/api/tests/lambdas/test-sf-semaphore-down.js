'use strict';

const test = require('ava');
const {
  aws,
  DynamoDb,
  Semaphore,
  testUtils: {
    randomId,
    randomString
  }
} = require('@cumulus/common');
const { Manager } = require('../../models');
const {
  getSemaphoreDecrementTasks,
  handler
} = require('../../lambdas/sf-semaphore-down');

const createSnsWorkflowMessage = ({
  status,
  priorityKey
}) => ({
  Sns: {
    Message: JSON.stringify({
      cumulus_meta: {
        execution_name: randomString(),
        priorityKey
      },
      meta: {
        status
      }
    })
  }
});

let manager;

test.before(async () => {
  process.env.SemaphoresTable = randomId('semaphoreTable');
  manager = new Manager({
    tableName: process.env.SemaphoresTable,
    tableHash: { name: 'key', type: 'S' }
  });
  await manager.createTable();
});

test.beforeEach(async (t) => {
  t.context.semaphore = new Semaphore(
    aws.dynamodbDocClient(),
    process.env.SemaphoresTable
  );
  t.context.client = aws.dynamodbDocClient();
});

test.after.always(() => manager.deleteTable());

test('getSemaphoreDecrementTasks() returns empty array for non-SNS message', async (t) => {
  const tasks = getSemaphoreDecrementTasks({});
  t.is(tasks.length, 0);
});

test('getSemaphoreDecrementTasks() returns empty array for SNS message without records', async (t) => {
  const tasks = getSemaphoreDecrementTasks({
    Records: [
      null
    ]
  });
  t.is(tasks.length, 0);
});

test('getSemaphoreDecrementTasks() returns empty array for SNS message with empty record objects', async (t) => {
  const tasks = getSemaphoreDecrementTasks({
    Records: [
      {}
    ]
  });
  t.is(tasks.length, 0);
});

test('getSemaphoreDecrementTasks() returns empty array for SNS message with empty message body', async (t) => {
  const tasks = getSemaphoreDecrementTasks({
    Records: [
      {
        Sns: {
          Message: null
        }
      }
    ]
  });
  t.is(tasks.length, 0);
});

test('sfSemaphoreDown lambda does nothing for a workflow message with no priority info', async (t) => {
  const { client, semaphore } = t.context;
  const key = randomId('low');

  await DynamoDb.put({
    tableName: process.env.SemaphoresTable,
    item: {
      key,
      semvalue: 1
    },
    client
  });

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed'
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda does nothing for a workflow message with no status', async (t) => {
  const { client, semaphore } = t.context;
  const key = randomId('low');

  await DynamoDb.put({
    tableName: process.env.SemaphoresTable,
    item: {
      key,
      semvalue: 1
    },
    client
  });

  await handler({
    Records: [
      createSnsWorkflowMessage({
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda does nothing for a workflow message for a running workflow', async (t) => {
  const { client, semaphore } = t.context;
  const key = randomId('low');

  await DynamoDb.put({
    tableName: process.env.SemaphoresTable,
    item: {
      key,
      semvalue: 1
    },
    client
  });

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'running',
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda throws error when attempting to decrement empty semaphore', async (t) => {
  const key = randomId('low');

  await t.throws(handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: key
      })
    ]
  }));
});

test('sfSemaphoreDown lambda decrements priority semaphore for completed workflow message', async (t) => {
  const { client, semaphore } = t.context;
  const key = randomId('low');

  // arbitrarily set semaphore so it can be decremented
  await DynamoDb.put({
    tableName: process.env.SemaphoresTable,
    item: {
      key,
      semvalue: 1
    },
    client
  });

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.semvalue, 0);
});

test('sfSemaphoreDown lambda decrements priority semaphore for failed workflow message', async (t) => {
  const { client, semaphore } = t.context;
  const key = randomId('low');

  // arbitrarily set semaphore so it can be decremented
  await DynamoDb.put({
    tableName: process.env.SemaphoresTable,
    item: {
      key,
      semvalue: 1
    },
    client
  });

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'failed',
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.semvalue, 0);
});

test('sfSemaphoreDown lambda handles multiple updates to a single semaphore', async (t) => {
  const { client, semaphore } = t.context;
  const key = randomId('low');

  // Arbitrarily set semaphore value so it can be decremented
  await DynamoDb.put({
    tableName: process.env.SemaphoresTable,
    item: {
      key,
      semvalue: 3
    },
    client
  });

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'failed',
        priorityKey: key
      }),
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: key
      })
    ]
  });

  const response = await semaphore.get(key);
  t.is(response.semvalue, 1);
});

test('sfSemaphoreDown lambda updates multiple semaphores', async (t) => {
  const { client, semaphore } = t.context;
  const lowPriorityKey = randomId('low');
  const medPriorityKey = randomId('med');

  await Promise.all([
    DynamoDb.put({
      tableName: process.env.SemaphoresTable,
      item: {
        key: lowPriorityKey,
        semvalue: 3
      },
      client
    }),
    DynamoDb.put({
      tableName: process.env.SemaphoresTable,
      item: {
        key: medPriorityKey,
        semvalue: 3
      },
      client
    })
  ]);

  await handler({
    Records: [
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: lowPriorityKey
      }),
      createSnsWorkflowMessage({
        status: 'failed',
        priorityKey: lowPriorityKey
      }),
      createSnsWorkflowMessage({
        status: 'completed',
        priorityKey: medPriorityKey
      })
    ]
  });

  let response = await semaphore.get(lowPriorityKey);
  t.is(response.semvalue, 1);

  response = await semaphore.get(medPriorityKey);
  t.is(response.semvalue, 2);
});
