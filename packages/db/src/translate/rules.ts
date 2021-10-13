import { Knex } from 'knex';
import { RuleRecord } from '@cumulus/types/api/rules';

import { CollectionPgModel } from '../models/collection';
import { ProviderPgModel } from '../models/provider';
import { PostgresRule } from '../types/rule';

/**
 * Generate a Postgres rule record from a DynamoDB record.
 *
 * @param {Object} record - A rule
 * @param {Object} dbClient - Knex client for reading from RDS database
 * @param {Object} collectionPgModel - Instance of the collection database model
 * @param {Object} providerPgModel - Instance of the provider database model
 * @returns {Object} A rule record
 */
export const translateApiRuleToPostgresRule = async (
  record: RuleRecord,
  dbClient: Knex,
  collectionPgModel = new CollectionPgModel(),
  providerPgModel = new ProviderPgModel()
): Promise<PostgresRule> => {
  const ruleRecord: PostgresRule = {
    name: record.name,
    workflow: record.workflow,
    provider_cumulus_id: record.provider ? await providerPgModel.getRecordCumulusId(
      dbClient,
      { name: record.provider }
    ) : undefined,
    collection_cumulus_id: record.collection ? await collectionPgModel.getRecordCumulusId(
      dbClient,
      { name: record.collection.name, version: record.collection.version }
    ) : undefined,
    meta: record.meta,
    payload: record.payload as any,
    queue_url: record.queueUrl,
    arn: record.rule.arn,
    type: record.rule.type,
    value: record.rule.value,
    log_event_arn: record.rule.logEventArn,
    enabled: (record.state === undefined) || (record.state === 'ENABLED'),
    tags: (record.tags ? JSON.stringify(record.tags) : undefined),
    execution_name_prefix: record.executionNamePrefix,
    created_at: (record.createdAt ? new Date(record.createdAt) : undefined),
    updated_at: (record.updatedAt ? new Date(record.updatedAt) : undefined),
  };

  return ruleRecord;
};
