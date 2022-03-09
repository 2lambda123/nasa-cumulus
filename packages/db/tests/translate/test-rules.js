const test = require('ava');
const {
  translateApiRuleToPostgresRule,
  translateApiRuleToPostgresRuleRaw,
} = require('../../dist/translate/rules');

test('translateApiRuleToPostgresRuleRaw converts API rule to Postgres and keeps nil fields', async (t) => {
  const record = {
    name: 'name',
    workflow: 'workflow_name',
    provider: 'fake-provider',
    state: 'ENABLED',
    collection: {
      name: 'fake-collection',
      version: '0.0.0',
    },
    rule: { type: 'onetime', value: 'value' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const fakeDbClient = {};
  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(1),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(2),
  };

  const expectedPostgresRule = {
    name: record.name,
    workflow: record.workflow,
    meta: undefined,
    payload: undefined,
    queue_url: undefined,
    arn: undefined,
    type: record.rule.type,
    value: record.rule.value,
    log_event_arn: undefined,
    enabled: true,
    tags: undefined,
    execution_name_prefix: undefined,
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
    collection_cumulus_id: 1,
    provider_cumulus_id: 2,
  };

  const result = await translateApiRuleToPostgresRuleRaw(
    record,
    fakeDbClient,
    fakeCollectionPgModel,
    fakeProviderPgModel
  );
  t.deepEqual(
    result,
    expectedPostgresRule
  );
});

test('translateApiRuleToPostgresRule converts API rule to Postgres', async (t) => {
  const record = {
    name: 'name',
    workflow: 'workflow_name',
    provider: 'fake-provider',
    state: 'ENABLED',
    collection: {
      name: 'fake-collection',
      version: '0.0.0',
    },
    rule: { type: 'onetime', value: 'value', arn: 'arn', logEventArn: 'event_arn' },
    executionNamePrefix: 'prefix',
    meta: { key: 'value' },
    queueUrl: 'queue_url',
    payload: { result: { key: 'value' } },
    tags: ['tag1', 'tag2'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const fakeDbClient = {};
  const fakeCollectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(1),
  };
  const fakeProviderPgModel = {
    getRecordCumulusId: () => Promise.resolve(2),
  };

  const expectedPostgresRule = {
    name: record.name,
    workflow: record.workflow,
    meta: record.meta,
    payload: record.payload,
    queue_url: record.queueUrl,
    arn: record.rule.arn,
    type: record.rule.type,
    value: record.rule.value,
    log_event_arn: record.rule.logEventArn,
    enabled: true,
    tags: JSON.stringify(record.tags),
    execution_name_prefix: record.executionNamePrefix,
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
    collection_cumulus_id: 1,
    provider_cumulus_id: 2,
  };

  const result = await translateApiRuleToPostgresRule(
    record,
    fakeDbClient,
    fakeCollectionPgModel,
    fakeProviderPgModel
  );
  t.deepEqual(
    result,
    expectedPostgresRule
  );
});
