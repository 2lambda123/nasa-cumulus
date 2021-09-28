import Knex from 'knex';
import pMap from 'p-map';

import { deleteS3Object } from '@cumulus/aws-client/S3';
import {
  FilePgModel,
  GranulePgModel,
  PostgresGranuleRecord,
  PostgresFileRecord,
  translatePostgresGranuleToApiGranule,
  CollectionPgModel,
  PdrPgModel,
  ProviderPgModel,
} from '@cumulus/db';
import { DeletePublishedGranule } from '@cumulus/errors';
import { ApiFile, ApiGranule } from '@cumulus/types';
import Logger from '@cumulus/logger';

const { deleteGranule } = require('@cumulus/es-client/indexer');
const { Search } = require('@cumulus/es-client/search');
const { publishGranuleSnsMessage } = require('../../lib/publishSnsMessageUtils');
const FileUtils = require('../../lib/FileUtils');
const Granule = require('../../models/granules');

const logger = new Logger({ sender: '@cumulus/api/granule-delete' });

/**
 * Delete a list of files from S3
 *
 * @param {Array} files - A list of S3 files
 * @returns {Promise<void>}
 */
const _deleteS3Files = async (
  files: (Omit<ApiFile, 'granuleId'> | PostgresFileRecord)[] = []
) =>
  await pMap(
    files,
    async (file) => {
      await deleteS3Object(
        FileUtils.getBucket(file),
        FileUtils.getKey(file)
      );
    }
  );

/**
 * Delete a Granule from Postgres and Dynamo, delete the Granule's
 * Files from Postgres and S3
 *
 * @param {Object} params
 * @param {Knex} params.knex - DB client
 * @param {Object} params.dynamoGranule - Granule from DynamoDB
 * @param {PostgresGranule} params.pgGranule - Granule from Postgres
 * @param {number | undefined} params.collectionCumulusId - Optional Collection Cumulus ID
 * @param {FilePgModel} params.filePgModel - File Postgres model
 * @param {GranulePgModel} params.granulePgModel - Granule Postgres model
 * @param {CollectionPgModel} params.collectionPgModel - Collection Postgres model
 * @param {Object} params.granuleModelClient - Granule Dynamo model
 */
const deleteGranuleAndFiles = async (params: {
  knex: Knex,
  dynamoGranule: ApiGranule,
  pgGranule: PostgresGranuleRecord,
  filePgModel: FilePgModel,
  granulePgModel: GranulePgModel,
  collectionPgModel: CollectionPgModel,
  granuleModelClient: typeof Granule,
  esClient: {
    delete(...args: any): any | any[];
  },
  collectionCumulusId?: number,
}) => {
  const {
    knex,
    dynamoGranule,
    pgGranule,
    filePgModel = new FilePgModel(),
    granulePgModel = new GranulePgModel(),
    collectionPgModel = new CollectionPgModel(),
    granuleModelClient = new Granule(),
    esClient = await Search.es(),
    collectionCumulusId,
  } = params;
  let granuleToPublishToSns: object;
  if (pgGranule === undefined) {
    logger.debug(`PG Granule is undefined, only deleting DynamoDB granule ${JSON.stringify(dynamoGranule)}`);
    // Delete only the Dynamo Granule and S3 Files
    granuleToPublishToSns = dynamoGranule;
    await _deleteS3Files(dynamoGranule.files);
    await granuleModelClient.delete(dynamoGranule);
    await publishGranuleSnsMessage(granuleToPublishToSns, 'Delete');
  } else if (pgGranule.published) {
    throw new DeletePublishedGranule('You cannot delete a granule that is published to CMR. Remove it from CMR first');
  } else {
    // Delete PG Granule, PG Files, Dynamo Granule, S3 Files
    logger.debug(`Initiating deletion of PG granule ${JSON.stringify(pgGranule)} mapped to dynamoGranule ${JSON.stringify(dynamoGranule)}`);
    const files = await filePgModel.search(
      knex,
      { granule_cumulus_id: pgGranule.cumulus_id }
    );

    if (collectionCumulusId) {
      const collectionPgRecord = await collectionPgModel.get(
        knex, { cumulus_id: collectionCumulusId }
      );
      granuleToPublishToSns = await translatePostgresGranuleToApiGranule({
        granulePgRecord: pgGranule,
        collectionPgRecord,
        knexOrTransaction: knex,
        collectionPgModel,
        filePgModel,
        pdrPgModel: new PdrPgModel(),
        providerPgModel: new ProviderPgModel(),
      });
    }

    try {
      await knex.transaction(async (trx) => {
        await granulePgModel.delete(trx, {
          cumulus_id: pgGranule.cumulus_id,
        });
        await granuleModelClient.delete(dynamoGranule);
        await deleteGranule({
          esClient,
          granuleId: dynamoGranule.granuleId,
          collectionId: dynamoGranule.collectionId,
          index: process.env.ES_INDEX,
          ignore: [404],
        });
        await publishGranuleSnsMessage(granuleToPublishToSns, 'Delete');
      });
      logger.debug(`Successfully deleted granule ${pgGranule.granule_id}`);
      await _deleteS3Files(files);
    } catch (error) {
      logger.debug(`Error deleting granule with ID ${pgGranule.granule_id} or S3 files ${JSON.stringify(dynamoGranule.files)}: ${JSON.stringify(error)}`);
      // Delete is idempotent, so there may not be a DynamoDB
      // record to recreate
      if (dynamoGranule) {
        await granuleModelClient.create(dynamoGranule);
      }
      throw error;
    }
  }
};

module.exports = {
  deleteGranuleAndFiles,
};
