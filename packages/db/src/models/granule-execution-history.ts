import Knex from 'knex';

import { tableNames } from '../tables';

import { PostgresGranuleExecution } from '../types/granule-execution-history';

export default class GranuleExecutionHistoryPgModel {
  readonly tableName: tableNames;

  // can't extend base class because type for this data doesn't contain
  // a cumulus_id property
  constructor() {
    this.tableName = tableNames.granuleExecutionsHistory;
  }

  async create(
    knexOrTrx: Knex | Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return knexOrTrx(this.tableName).insert(item);
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    item: PostgresGranuleExecution
  ) {
    return knexOrTrx(tableNames.granuleExecutionsHistory)
      .insert(item)
      .onConflict(['granule_cumulus_id', 'execution_cumulus_id'])
      .merge();
  }

  search(
    knexOrTrx: Knex | Knex.Transaction,
    query: Partial<PostgresGranuleExecution>
  ) {
    return knexOrTrx(tableNames.granuleExecutionsHistory)
      .where(query);
  }
}

export { GranuleExecutionHistoryPgModel };
