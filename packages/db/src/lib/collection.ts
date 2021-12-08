import { deconstructCollectionId } from '@cumulus/message/Collections';
import { Knex } from 'knex';

import { TableNames } from '../tables';

/**
 * Get collection results for a given set of granule IDs
 *
 * @param {Knex} knex - Knex databse client
 * @param {Array<string>} granuleIds - Array of granule IDs
 * @returns {Promise<Array<Object>>} - An array of collection results
 */
export const getCollectionsByGranuleIds = async (
  knex: Knex,
  granuleIds: string[]
) => {
  const {
    collections: collectionsTable,
    granules: granulesTable,
  } = TableNames;
  return await knex(collectionsTable)
    .select(`${collectionsTable}.*`)
    .innerJoin(granulesTable, `${collectionsTable}.cumulus_id`, `${granulesTable}.collection_cumulus_id`)
    .whereIn(`${granulesTable}.granule_id`, granuleIds)
    .groupBy(`${collectionsTable}.cumulus_id`);
};


/**
 * Get cumulus_collection_ids from an array of collectionIds
 *
 * @param {Knex} knex - Knex database client
 * @param {string[]} collectionIds - array of collectionId strings
 * @returns {Promise<number[]>} - cumulus_collection_ids
 */
export const getCumulusCollectionIdsByCollectionIds = async (
  knex: Knex,
  collectionIds: string[],
): Promise<number[]> => {
  var query = knex(TableNames.collections).select('cumulus_id')
  const collectionNameVersions = collectionIds.map(deconstructCollectionId);
  collectionNameVersions.forEach((c) => query = query.orWhere(c))
  const results = await query;
  return results.map((r) => r.cumulus_id)
};
