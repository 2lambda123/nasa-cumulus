import Knex from 'knex';

import { BasePgModel } from './base';
import { tableNames } from '../tables';

import { PostgresExecution, PostgresExecutionRecord } from '../types/execution';

const queries = require('@cumulus/es-client/queries');

class ExecutionPgModel extends BasePgModel<PostgresExecution, PostgresExecutionRecord> {
  constructor() {
    super({
      tableName: tableNames.executions,
    });
  }

  async upsert(
    knexOrTrx: Knex | Knex.Transaction,
    execution: PostgresExecution
  ) {
    if (execution.status === 'running') {
      return await knexOrTrx(this.tableName)
        .insert(execution)
        .onConflict('arn')
        .merge({
          created_at: execution.created_at,
          updated_at: execution.updated_at,
          timestamp: execution.timestamp,
          original_payload: execution.original_payload,
        })
        .returning('cumulus_id');
    }
    return await knexOrTrx(this.tableName)
      .insert(execution)
      .onConflict('arn')
      .merge()
      .returning('cumulus_id');
  }

  /**
   * Get executions from the execution cumulus_id
   *
   * @param {Knex | Knex.Transaction} knexOrTrx -
   *  DB client or transaction
   * @param {Array<number>} executionCumulusIds -
   * single execution cumulus_id or array of exeuction cumulus_ids
   * @param {Object} [params] - Optional object with addition params for query
   * @param {number} [params.limit] - number of records to be returned
   * @param {number} [params.offset] - record offset
   * @returns {Promise<Array<number>>} An array of exeuctions
   */
  async searchByCumulusIds(
    knexOrTrx: Knex | Knex.Transaction,
    executionCumulusIds: Array<number> | number,
    params: { limit: number, offset: number }
  ): Promise<Array<number>> {
    const { limit, offset, ...sortQueries } = params || {};
    const { sort } = queries(sortQueries);
    const executionCumulusIdsArray = [executionCumulusIds].flat();
    const executions = await knexOrTrx(this.tableName)
      .whereIn('cumulus_id', executionCumulusIdsArray)
      .modify((queryBuilder) => {
        if (limit) queryBuilder.limit(limit);
        if (offset) queryBuilder.offset(offset);
        if (sort.length > 1) {
          sort.forEach((sortObject: { [key: string]: { order: string } }) => {
            const sortField = Object.keys(sortObject)[0];
            const { order } = sortObject[sortField];
            queryBuilder.orderBy(sortField, order);
          });
        }
      });
    return executions;
  }
  async getWorkflowNameJoin(
    knexOrTransaction: Knex | Knex.Transaction,
    granuleCumulusIds: Array<number> | number
  ): Promise<Array<Object>> {
    const granuleCumulusIdsArray = [granuleCumulusIds].flat();
    const numberOfGranules = granuleCumulusIdsArray.length;
    const { granulesExecutions: granulesExecutionsTable } = tableNames;

    const aggregatedWorkflowCounts = await knexOrTransaction(this.tableName)
      .select('workflow_name')
      .countDistinct('granule_cumulus_id')
      .innerJoin(granulesExecutionsTable, `${this.tableName}.cumulus_id`, `${granulesExecutionsTable}.execution_cumulus_id`)
      .whereIn('granule_cumulus_id', granuleCumulusIdsArray)
      .groupBy('workflow_name')
      .havingRaw('count(distinct granule_cumulus_id) = ?', [numberOfGranules]);
    return aggregatedWorkflowCounts
      .map((workflowCounts) => workflowCounts.workflow_name);
  }
}

export { ExecutionPgModel };
