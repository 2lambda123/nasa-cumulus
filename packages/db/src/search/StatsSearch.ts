//@ts-nocheck
import { Knex } from 'knex';
import { getKnexClient } from '../connection';

class StatsSearch {
  query: String;

  matches: any = {
    field: /[&?]field=([^&]+)/,
    from: /[&?]timestamp__from=([^&]+)/,
    to: /[&?]timestamp__to=([^&]+)/,
    type: /[&?]type=([^&]+)/,
    collection_id: /[&?]collectionId=([^&]+)/,
    provider_id: /[&?]providerId=([^&]+)/,
    status: /[&?]status=([^&]+)/,
  };

  constructor(statsQuery: string) {
    this.query = statsQuery;
  }

  public handleTime(end: string, beg: string, queryTo: string, queryFrom: string, query: any): any {
    let tempQuery = query;
    if (queryTo) {
      tempQuery = tempQuery.whereBetween(end,
        [new Date(Number.parseInt(queryFrom, 10)), new Date(Number.parseInt(queryTo, 10))]);
    }
    if (queryFrom) {
      tempQuery = tempQuery.whereBetween(beg,
        [new Date(Number.parseInt(queryFrom, 10)), new Date(Number.parseInt(queryTo, 10))]);
    }
    return tempQuery;
  }

  public async summary(sendknex: Knex, queryTo: string, queryFrom: string): Promise<any> {
    const knex = sendknex ?? await getKnexClient();
    let aggregateQuery = this.handleTime('beginning_date_time', 'ending_date_time', queryTo, queryFrom, knex('granules'));
    aggregateQuery = await aggregateQuery.select(
      knex.raw("COUNT(CASE WHEN error ->> 'Error' != '{}' THEN 1 END) AS count_errors"),
      knex.raw('COUNT(cumulus_id) AS count_granules'),
      knex.raw('AVG(time_to_process) AS avg_processing_time'),
      knex.raw('COUNT(DISTINCT collection_cumulus_id) AS count_collections')
    );
    const result = aggregateQuery;
    return result;
  }

  public providerAndCollectionIdBuilder(type: string, field: string, collectionName: string,
    providerId: string, knex: Knex): any {
    let aggregateQuery;
    if (collectionName && providerId) {
      aggregateQuery = (knex.select(
        this.whatToGroupBy(field, knex)
      ).from(`${type}`).join('collections', `${type}.collection_cumulus_id`, 'collections.cumulus_id').groupBy(
        this.whatToGroupBy(field, knex)
      ))
        .select(
          this.whatToGroupBy(field, knex)
        )
        .from(`${type}`)
        .join('providers', `${type}.provider_cumulus_id`, 'providers.cumulus_id')
        .groupBy(
          this.whatToGroupBy(field, knex)
        );
    } else {
      if (collectionName && !providerId) {
        aggregateQuery = knex.select(
          this.whatToGroupBy(field, knex)
        ).from(`${type}`)
          .join('collections', `${type}.collection_cumulus_id`, 'collections.cumulus_id')
          .groupBy(
            this.whatToGroupBy(field, knex)
          );
      }
      if (!collectionName && providerId) {
        aggregateQuery = knex.select(
          this.whatToGroupBy(field, knex)
        ).from(`${type}`)
          .join('providers', `${type}.provider_cumulus_id`, 'providers.cumulus_id')
          .groupBy(
            this.whatToGroupBy(field, knex)
          );
      }
    }
    return aggregateQuery;
  }

  public whatToGroupBy(field: string, knex: Knex): string {
    let groupStrings = '';
    if (field.includes('error.Error')) {
      groupStrings += ('*', knex.raw("error #>> '{Error, keyword}' as error"), knex.raw('COUNT(*) as count'));
    } else {
      groupStrings += (` ${field}`);
    }
    return groupStrings;
  }

  public aggregateQueryField(field: string, query: any, knex: Knex): any {
    let tempQuery = '';
    if (field.includes('error.Error')) {
      tempQuery = query.select(knex.raw("error #>> '{Error, keyword}' as error"), knex.raw('COUNT(*) as count')).groupByRaw("error #>> '{Error, keyword}'").orderBy('count', 'desc');
    } else {
      tempQuery = query.select(`${field}`).count('* as count').groupBy(`${field}`)
        .orderBy('count', 'desc');
    }
    return tempQuery;
  }

  // eslint-disable-next-line complexity
  public async aggregate_search(sendKnex: Knex): Promise<any> {
    if (this.query) {
      let aggregateQuery;
      const knex = sendKnex ?? await getKnexClient();
      const queryType = (this.query).match(this.matches.type) ?
        (this.query).match(this.matches.type)[1] : 'granules'; // what table to query
      const queryFrom = (this.query).match(this.matches.from) ?
        (this.query).match(this.matches.from)[1] : undefined; //range lower bound
      const queryTo = (this.query).match(this.matches.to) ?
        (this.query).match(this.matches.to)[1] : undefined; //range upper bound
      const queryCollectionId = (this.query).match(this.matches.collection_id) ?
        (this.query).match(this.matches.collection_id)[1] : undefined; //collection NAME
      const queryProvider = (this.query).match(this.matches.provider_id) ?
        (this.query).match(this.matches.provider_id)[1] : undefined; //provider NAME
      const queryField = (this.query).match(this.matches.field) ?
        (this.query).match(this.matches.field)[1] : 'status';
      const queryStatus = (this.query).match(this.matches.status) ?
        (this.query).match(this.matches.status)[1] : undefined;
      const dateStringTo = queryType === 'granules' ? `${queryType}.ending_date_time` : `${queryType}.updated_at`;
      const dateStringFrom = queryType === 'granules' ? `${queryType}.beginning_date_time` : `${queryType}.created_at`;

      aggregateQuery = (queryProvider || queryCollectionId) ? this.providerAndCollectionIdBuilder(queryType, queryField, queryCollectionId, queryProvider, knex) : knex(`${queryType}`);

      if (queryCollectionId) {
        aggregateQuery = aggregateQuery.where('collections.name', '=', queryCollectionId);
      }
      if (queryProvider) {
        aggregateQuery = aggregateQuery.where('providers.name', '=', queryProvider);
      }

      aggregateQuery = this.handleTime(dateStringTo,
        dateStringFrom, queryTo, queryFrom, aggregateQuery);

      aggregateQuery = this.aggregateQueryField(queryField, aggregateQuery, knex);

      const result = await knex.raw(aggregateQuery.toString());
      let r = result.rows;
      if (queryStatus) {
        r = r.filter((rec) => (rec.status === queryStatus)).map((rec) => ({ count: rec.count }));
      }
      /***getting query results*/
      return r;
    }
    return undefined;
  }
}

export { StatsSearch };
