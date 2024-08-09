import { Knex } from 'knex';
import pick from 'lodash/pick';

import { ApiAsyncOperation } from '@cumulus/types/api/async_operations';
import Logger from '@cumulus/logger';

import { BaseSearch } from './BaseSearch';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { PostgresAsyncOperationRecord } from '../types/async_operation';
import { translatePostgresAsyncOperationToApiAsyncOperation } from '../translate/async_operations';

const log = new Logger({ sender: '@cumulus/db/AsyncOperationSearch' });

/**
 * Class to build and execute db search query for asyncOperation
 */
export class AsyncOperationSearch extends BaseSearch {
  constructor(event: QueryEvent) {
    super(event, 'asyncOperation');
  }

  /**
   * Build basic query
   *
   * @param knex - DB client
   * @returns queries for getting count and search result
   */
  protected buildBasicQuery(knex: Knex)
    : {
      countQuery: Knex.QueryBuilder,
      searchQuery: Knex.QueryBuilder,
    } {
    const countQuery = knex(this.tableName)
      .count('*');

    const searchQuery = knex(this.tableName)
      .select(`${this.tableName}.*`);
    return { countQuery, searchQuery };
  }

  /**
   * Build queries for infix and prefix
   *
   * @param params
   * @param params.countQuery - query builder for getting count
   * @param params.searchQuery - query builder for search
   * @param [params.dbQueryParameters] - db query parameters
   */
  protected buildInfixPrefixQuery(params: {
    countQuery: Knex.QueryBuilder,
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { countQuery, searchQuery, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters ?? this.dbQueryParameters;
    if (infix) {
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.id`, `%${infix}%`));
    }
    if (prefix) {
      [countQuery, searchQuery].forEach((query) => query.whereLike(`${this.tableName}.id`, `${prefix}%`));
    }
  }

  /**
   * Translate postgres records to api records
   *
   * @param pgRecords - postgres records returned from query
   * @returns translated api records
   */
  protected translatePostgresRecordsToApiRecords(pgRecords: PostgresAsyncOperationRecord[])
    : Partial<ApiAsyncOperation>[] {
    log.debug(`translatePostgresRecordsToApiRecords number of records ${pgRecords.length} `);
    const apiRecords = pgRecords.map((item: PostgresAsyncOperationRecord) => {
      const pgAsyncOperation = item;
      const apiRecord = translatePostgresAsyncOperationToApiAsyncOperation(pgAsyncOperation);
      return this.dbQueryParameters.fields
        ? pick(apiRecord, this.dbQueryParameters.fields)
        : apiRecord;
    });
    return apiRecords;
  }
}
