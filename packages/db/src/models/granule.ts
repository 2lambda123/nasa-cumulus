import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresGranule, PostgresGranuleRecord } from '../types/granule';

export default class GranulePgModel extends BasePgModel<PostgresGranule, PostgresGranuleRecord> {
  constructor() {
    super({
      tableName: tableNames.granules,
    });
  }

  async create(
    // Is this safe? Should I do something better to ensure
    // that this is called with a transaction?
    knexTransaction: Knex.Transaction,
    item: PostgresGranule,
    executionCumulusId: number
  ) {
    const [granuleCumulusId] = await knexTransaction(this.tableName)
      .insert(item)
      .returning('cumulus_id');
    return knexTransaction(tableNames.granuleExecutionsHistory)
      .insert({
        granule_cumulus_id: granuleCumulusId,
        execution_cumulus_id: executionCumulusId,
      })
      .returning('cumulus_id');
  }

  upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule
  ) {
    if (granule.status === 'running') {
      return knexOrTrx(this.tableName)
        .insert(granule)
        .onConflict(['granule_id', 'collection_cumulus_id'])
        .merge({
          execution_cumulus_id: granule.execution_cumulus_id,
          status: granule.status,
          timestamp: granule.timestamp,
          updated_at: granule.updated_at,
        })
        // execution_cumulus_id is not required, so granule.execution_cumulus_id may be
        // undefined. so need to compare against EXCLUDED.execution_cumulus_id
        .whereRaw(`${this.tableName}.execution_cumulus_id != EXCLUDED.execution_cumulus_id`)
        .returning('cumulus_id');
    }
    return knexOrTrx(this.tableName)
      .insert(granule)
      .onConflict(['granule_id', 'collection_cumulus_id'])
      .merge()
      .returning('cumulus_id');
  }
}

export { GranulePgModel };
