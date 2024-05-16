import get from 'lodash/get';
import { Knex } from 'knex';
import omit from 'lodash/omit';
import { getKnexClient } from '../connection';
import { TableNames } from '../tables';
import { DbQueryParameters, QueryEvent } from '../types/search';
import { BaseSearch, typeToTable } from './BaseSearch';

type TotalSummary = {
  count_errors: number,
  count_collections: number,
  count_granules: number,
  avg_processing_time: number,
};

type Aggregate = {
  count: string,
  status?: string,
  error?: string,
  name?: string,
};

type Summary = {
  dateFrom: string,
  dateTo: string,
  value: number,
  aggregation: string,
  unit: string,
};

type SummaryResult = {
  errors: Summary,
  granules: Summary,
  collections: Summary,
  processingTime: Summary,
};

type Meta = {
  name: string,
  count: number,
  field: string,
};

type AggregateRes = {
  key: string,
  count: number,
};

type ApiAggregateResult = {
  meta: Meta,
  count: AggregateRes[]
};

const infixMapping = {
  granules: 'granule_id',
  collections: 'name',
  providers: 'name',
  executions: 'arn',
  pdrs: 'name',
};

/**
 * A class to query postgres for the STATS and STATS/AGGREGATE endpoints
 */
class StatsSearch extends BaseSearch {
  readonly tableName: string;

  constructor(event: QueryEvent, type: string) {
    super(event, type);
    this.tableName = typeToTable[this.type];
  }

  /** Formats the postgres records into an API stats/aggregate response
   *
   * @param {Record<string, Aggregate>} result - the postgres query results
   * @returns {ApiAggregateResult} the api object with the aggregate statistics
   */
  private formatAggregateResult(result: Record<string, Aggregate>): ApiAggregateResult {
    let totalCount = 0;
    const responses = [];
    const localField = this.queryStringParameters.field ? this.queryStringParameters.field : 'status';
    for (const row of Object.keys(result)) {
      responses.push(
        {
          key: localField === 'status' ? `${result[row].status}` :
            (localField?.includes('error.Error') ? `${result[row].error}` : `${result[row].name}`),
          count: Number.parseInt(result[row].count, 10),
        }
      );
      totalCount += Number(result[row].count);
    }
    return {
      meta: {
        name: 'cumulus-api',
        count: totalCount,
        field: `${localField}`,
      },
      count: responses,
    };
  }

  /** Formats the postgres results into an API stats/summary response
   *
   * @param {TotalSummary} result - the knex summary query results
   * @returns {SummaryResult} the api object with the summary statistics
   */
  private formatSummaryResult(result: TotalSummary): SummaryResult {
    const timestampTo = Number.parseInt(this.queryStringParameters.timestamp__to as string, 10);
    const timestampFrom = Number.parseInt(this.queryStringParameters.timestamp__from as string, 10);
    const dateto = this.queryStringParameters.timestamp__to ?
      new Date(timestampTo).toISOString() : new Date().toISOString();
    const datefrom = this.queryStringParameters.timestamp__from ?
      new Date(timestampFrom).toISOString() : '1970-01-01T12:00:00+00:00';
    return {
      errors: {
        dateFrom: datefrom,
        dateTo: dateto,
        value: Number(result.count_errors),
        aggregation: 'count',
        unit: 'error',
      },
      collections: {
        dateFrom: datefrom,
        dateTo: dateto,
        value: Number(result.count_collections),
        aggregation: 'count',
        unit: 'collection',
      },
      processingTime: {
        dateFrom: datefrom,
        dateTo: dateto,
        value: Number(result.avg_processing_time),
        aggregation: 'average',
        unit: 'second',
      },
      granules: {
        dateFrom: datefrom,
        dateTo: dateto,
        value: Number(result.count_granules),
        aggregation: 'count',
        unit: 'granule',
      },
    };
  }

  /** Queries postgres for a summary of statistics around the granules in the system
   *
   * @param {Knex} sendKnex - the knex client to be used
   * @returns {Promise<SummaryResult>} the postgres aggregations based on query
   */
  public async summary(sendknex: Knex): Promise<SummaryResult> {
    const knex = sendknex ?? await getKnexClient();
    const aggregateQuery:Knex.QueryBuilder = knex(`${TableNames.granules}`);
    if (this.queryStringParameters.timestamp__from) {
      aggregateQuery.where(`${TableNames.granules}.updated_at`, '>=', new Date(Number.parseInt(this.queryStringParameters.timestamp__from as string, 10)));
    }
    if (this.queryStringParameters.timestamp__to) {
      aggregateQuery.where(`${TableNames.granules}.updated_at`, '<=', new Date(Number.parseInt(this.queryStringParameters.timestamp__to as string, 10)));
    }
    aggregateQuery.select(
      knex.raw(`COUNT(CASE WHEN ${TableNames.granules}.error ->> 'Error' != '{}' THEN 1 END) AS count_errors`),
      knex.raw(`COUNT(${TableNames.granules}.cumulus_id) AS count_granules`),
      knex.raw(`AVG(${TableNames.granules}.duration) AS avg_processing_time`),
      knex.raw(`COUNT(DISTINCT ${TableNames.granules}.collection_cumulus_id) AS count_collections`)
    );
    const aggregateQueryRes: TotalSummary[] = await aggregateQuery;
    return this.formatSummaryResult(aggregateQueryRes[0]);
  }

  /** Performs joins on the provider and/or collection table if neccessary
   *
   * @param {Knex} knex - the knex client to be used
   * @returns {Knex.QueryBuilder} the knex query of a joined table or not based on queryStringParams
   */
  private providerAndCollectionIdBuilder(knex: Knex): Knex.QueryBuilder {
    let aggregateQuery;
    const localField = this.queryStringParameters.field ? this.queryStringParameters.field : 'status';
    if (localField?.includes('error.Error')) {
      aggregateQuery = knex.select(knex.raw(`"count(${this.tableName}.cumulus_id), error ->> 'Error' as error"`)).from(this.tableName);
    } else {
      aggregateQuery = knex.select(`${this.tableName}.${localField}`).from(this.tableName);
    }
    if (this.queryStringParameters.collectionId) {
      aggregateQuery.join(`${TableNames.collections}`, `${this.tableName}.collection_cumulus_id`, 'collections.cumulus_id');
    }

    if (this.queryStringParameters.provider) {
      aggregateQuery.join(`${TableNames.providers}`, `${this.tableName}.provider_cumulus_id`, 'providers.cumulus_id');
    }
    return aggregateQuery;
  }

  /** Aggregates the search query based on queryStringParameters
   *
   * @param {Knex.QueryBuilder} query - the knex query to be aggregated
   * @param {Knex} knex - the knex client to be used
   * @returns {Knex.QueryBuilder} the query with its new Aggregatation
   */
  private aggregateQueryField(query: Knex.QueryBuilder, knex: Knex): Knex.QueryBuilder {
    const localField = this.queryStringParameters.field ? this.queryStringParameters.field : 'status';
    if (localField?.includes('error.Error')) {
      query.select(knex.raw("error ->> 'Error' as error"))
        .count(`${this.tableName}.cumulus_id as count`)
        .groupByRaw(knex.raw("error ->> 'Error'"))
        .orderBy('count', 'desc');
    } else {
      query.select(`${this.tableName}.${localField}`)
        .count(`${this.tableName}.cumulus_id as count`)
        .groupBy(`${this.tableName}.${localField}`)
        .orderBy('count', 'desc');
    }
    return query;
  }

  /**
   * Builds basic query
   *
   * @param knex - the knex client
   * @returns the search query
   */
  protected buildBasicQuery(knex: Knex)
    : {
      searchQuery: Knex.QueryBuilder,
    } {
    let searchQuery:Knex.QueryBuilder;
    if (this.queryStringParameters.provider || this.queryStringParameters.collectionId) {
      searchQuery = this.providerAndCollectionIdBuilder(knex);
    } else {
      searchQuery = knex(`${this.tableName}`);
    }
    this.aggregateQueryField(searchQuery, knex);
    return { searchQuery };
  }

  /**
   * Builds queries for infix and prefix
   *
   * @param params
   * @param {Knex.QueryBuilder} params.searchQuery - the search query
   */
  protected buildInfixPrefixQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { searchQuery, dbQueryParameters } = params;
    const { infix, prefix } = dbQueryParameters || this.dbQueryParameters;
    const typeName = this.tableName ? get(infixMapping, this.tableName) : 'granuleId';
    if (infix) {
      searchQuery.whereLike(`${this.tableName}.${typeName}`, `%${infix}%`);
    }
    if (prefix) {
      searchQuery.whereLike(`${this.tableName}.${typeName}`, `%${prefix}%`);
    }
  }

  /**
   * Builds queries for term fields
   *
   * @param params
   * @param {Knex.QueryBuilder} params.searchQuery - the search query
   * @param [params.dbQueryParameters] - the db query parameters
   * @returns {Knex.QueryBuilder} - the updated search query based on queryStringParams
   */
  protected buildTermQuery(params: {
    searchQuery: Knex.QueryBuilder,
    dbQueryParameters?: DbQueryParameters,
  }) {
    const { searchQuery } = params;
    if (this.queryStringParameters.collectionId) {
      searchQuery.where(`${TableNames.collections}.name`, '=', this.queryStringParameters.collectionId);
    }
    if (this.queryStringParameters.provider) {
      searchQuery.where(`${TableNames.providers}.name`, '=', this.queryStringParameters.provider);
    }
    if (this.queryStringParameters.timestamp__from) {
      searchQuery.where(`${this.tableName}.updated_at`, '>=', new Date(Number.parseInt(this.queryStringParameters.timestamp__from as string, 10)));
    }
    if (this.queryStringParameters.timestamp__to) {
      searchQuery.where(`${this.tableName}.updated_at`, '<=', new Date(Number.parseInt(this.queryStringParameters.timestamp__to as string, 10)));
    }
    const { term = {} } = this.dbQueryParameters;
    return super.buildTermQuery({
      ...params,
      dbQueryParameters: { term: omit(term, ['collectionName', 'collectionVersion', 'pdrName', 'error.Error', 'providerName']) },
    });
  }

  /**
   * Executes the aggregate search query
   *
   * @param {Knex} knex - the knex client to be used
   * @param [params.dbQueryParameters] - the db query parameters
   * @returns {ApiAggregateResult} - the aggregate query results in api format
   */
  async aggregate(testKnex: Knex | undefined) {
    const knex = testKnex ?? await getKnexClient();
    const { searchQuery } = this.buildSearch(knex);
    try {
      const pgRecords = await searchQuery;
      return this.formatAggregateResult(pgRecords);
    } catch (error) {
      return error;
    }
  }
}

export { StatsSearch };
