'use strict';

const test = require('ava');

const { randomString } = require('@cumulus/common/test-utils');

const indexer = require('../indexer');
const { Search } = require('../search');
const {
  createTestIndex,
  cleanupTestIndex,
} = require('../testUtils');

process.env.system_bucket = randomString();
process.env.stackName = randomString();

test.before(async (t) => {
  const { esIndex, esClient } = await createTestIndex();
  t.context.esIndex = esIndex;
  t.context.esClient = esClient;

  t.context.esPdrsClient = new Search(
    {},
    'pdr',
    process.env.ES_INDEX
  );
});

test.after.always(async (t) => {
  await cleanupTestIndex(t.context);
});

test('upsertPdr creates a new "running" PDR record', async (t) => {
  const { esIndex, esClient } = t.context;

  const pdr = {
    pdrName: randomString(),
    status: 'running',
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);
});

test('upsertPdr creates a new "completed" PDR record', async (t) => {
  const { esIndex, esClient } = t.context;

  const pdr = {
    pdrName: randomString(),
    status: 'completed',
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);
});

test('upsertPdr does update a "running" PDR record if execution is different', async (t) => {
  const { esIndex, esClient } = t.context;

  const pdr = {
    pdrName: randomString(),
    status: 'running',
    execution: randomString(),
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    execution: randomString(),
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esIndex);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(updatedEsRecord, updates);
});

test('upsertPdr does update a "completed" PDR record to "running" if execution is different and createdAt is newer', async (t) => {
  const { esIndex, esClient } = t.context;

  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'completed',
    execution: randomString(),
    createdAt,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    execution: randomString(),
    createdAt: createdAt + 1,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esIndex);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(updatedEsRecord, updates);
});

test('upsertPdr does not update "completed" PDR record to "running" with same execution and older createdAt value', async (t) => {
  const { esIndex, esClient } = t.context;

  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'completed',
    createdAt,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'running',
    createdAt: createdAt - 1,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esIndex);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should NOT have been applied
  t.like(updatedEsRecord, pdr);
});

test('upsertPdr does not update PDR record with same execution if progress is less than current', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const pdr = {
    pdrName: randomString(),
    status: 'completed',
    stats: {
      completed: 3,
      total: 3,
    },
    progress: 100,
    execution,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'running',
    stats: {
      processing: 3,
      total: 3,
    },
    progress: 0,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esIndex);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should NOT have been applied
  t.like(updatedEsRecord, pdr);
});

test('upsertPdr does not update PDR record from different execution with older createdAt value', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'completed',
    stats: {
      completed: 3,
      total: 3,
    },
    progress: 100,
    execution,
    createdAt,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updatedExecution = randomString();
  const updates = {
    ...pdr,
    status: 'failed',
    stats: {
      failed: 2,
      total: 2,
    },
    createdAt: createdAt - 1,
    execution: updatedExecution,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esIndex);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should NOT have been applied
  t.like(updatedEsRecord, pdr);
});

test('upsertPdr does not update PDR record from same execution with older createdAt value', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'completed',
    stats: {
      completed: 3,
      total: 3,
    },
    progress: 100,
    execution,
    createdAt,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'failed',
    stats: {
      failed: 2,
      total: 2,
    },
    createdAt: createdAt - 1,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esIndex);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should NOT have been applied
  t.like(updatedEsRecord, pdr);
});

test('upsertPdr does update PDR record from same execution if progress was made', async (t) => {
  const { esIndex, esClient } = t.context;

  const execution = randomString();
  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'running',
    stats: {
      processing: 5,
      total: 5,
    },
    progress: 0,
    execution,
    createdAt,
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'running',
    stats: {
      processing: 1,
      completed: 4,
      total: 5,
    },
    progress: 20,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esIndex);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should have been applied
  t.like(updatedEsRecord, updates);
});

test('upsertPdr does not update a final (failed) record to a final state (completed) if execution is different but createdAt is older', async (t) => {
  const { esIndex, esClient } = t.context;

  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'failed',
    createdAt,
    execution: randomString(),
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'completed',
    execution: randomString(),
    createdAt: createdAt - 1,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esIndex);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  // updates should NOT have been applied
  t.like(updatedEsRecord, pdr);
});

test('upsertPdr does update a final (failed) record to a final state (completed) if execution is different and createdAt is newer', async (t) => {
  const { esIndex, esClient } = t.context;

  const createdAt = Date.now();
  const pdr = {
    pdrName: randomString(),
    status: 'failed',
    createdAt: createdAt - 1,
    execution: randomString(),
  };

  await indexer.upsertPdr(esClient, pdr.pdrName, pdr, esIndex);

  const esRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(esRecord, pdr);

  const updates = {
    ...pdr,
    status: 'completed',
    execution: randomString(),
    createdAt,
  };
  await indexer.upsertPdr(esClient, updates.pdrName, updates, esIndex);
  const updatedEsRecord = await t.context.esPdrsClient.get(pdr.pdrName);
  t.like(updatedEsRecord, updates);
});
