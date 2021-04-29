import Knex from 'knex';

import { tableNames } from '../tables';

import { PostgresGranule, PostgresGranuleRecord, PostgresGranuleUniqueColumns } from '../types/granule';

import { BasePgModel } from './base';
import { GranulesExecutionsPgModel } from './granules-executions';
import { translateDateToUTC } from '../lib/timestamp';

export default class GranulePgModel extends BasePgModel<PostgresGranule, PostgresGranuleRecord> {
  constructor() {
    super({
      tableName: tableNames.granules,
    });
  }

  /**
   * Deletes the item from Postgres
   *
   * @param {Knex | Knex.Transaction} knexOrTransaction - DB client or transaction
   * @param {Partial<RecordType>} params - An object or any portion of an object of type RecordType
   * @returns {Promise<number>} The number of rows deleted
   */
  async delete(
    knexOrTransaction: Knex | Knex.Transaction,
    params: PostgresGranuleUniqueColumns | { cumulus_id: number }
  ): Promise<number> {
    return knexOrTransaction(this.tableName)
      .where(params)
      .del();
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    granule: PostgresGranule,
    executionCumulusId?: number,
    granulesExecutionsPgModel = new GranulesExecutionsPgModel()
  ) {
    if (!granule.created_at) {
      throw new Error(`To upsert granule record must have 'created_at' set: ${JSON.stringify(granule)}`);
    }
    if (granule.status === 'running') {
      const upsertQuery = knexOrTrx(this.tableName)
        .insert(granule)
        .onConflict(['granule_id', 'collection_cumulus_id'])
        .merge({
          status: granule.status,
          timestamp: granule.timestamp,
          updated_at: granule.updated_at,
          created_at: granule.created_at,
        })
        .where(knexOrTrx.raw(`${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(granule.created_at)})`));

      // In reality, the only place where executionCumulusId should be
      // undefined is from the data migrations
      if (executionCumulusId) {
        // Only do the upsert if there IS NOT already a record associating
        // the granule to this execution. If there IS already a record
        // linking this granule to this execution, then this upsert query
        // will not affect any rows.
        upsertQuery.whereNotExists(
          granulesExecutionsPgModel.search(
            knexOrTrx,
            { execution_cumulus_id: executionCumulusId }
          )
        );
      }

      upsertQuery.returning('cumulus_id');
      return upsertQuery;
    }
    return knexOrTrx(this.tableName)
      .insert(granule)
      .onConflict(['granule_id', 'collection_cumulus_id'])
      .merge()
      .where(knexOrTrx.raw(`${this.tableName}.created_at <= to_timestamp(${translateDateToUTC(granule.created_at)})`))
      .returning('cumulus_id');
  }
}

export { GranulePgModel };
