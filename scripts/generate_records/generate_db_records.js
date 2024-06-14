// @ts-check
/* eslint-disable node/no-extraneous-require */
/* eslint-disable no-await-in-loop */
const pMap = require('p-map');
const minimist = require('minimist');
const cryptoRandomString = require('crypto-random-string');
const cliProgress = require('cli-progress');

const { randomInt } = require('crypto');
const {
  GranulePgModel,
  CollectionPgModel,
  ProviderPgModel,
  ExecutionPgModel,
  GranulesExecutionsPgModel,
  FilePgModel,
  getKnexClient,
} = require('@cumulus/db');
const {
  loadCollection,
  loadExecutions,
  loadProvider,
  loadFiles,
  loadGranulesExecutions,
  loadGranules,
} = require('./db_record_loaders');

/**
 * @typedef {import('@cumulus/db').PostgresFile} PostgresFile
 * @typedef {import('@cumulus/db').PostgresGranule} PostgresGranule
 * @typedef {import('@cumulus/db').PostgresCollection} PostgresCollection
 * @typedef {import('knex').Knex} Knex
 * @typedef {{
 *   geModel: GranulesExecutionsPgModel,
 *   executionModel: ExecutionPgModel,
 *   granuleModel: GranulePgModel,
 *   fileModel: FilePgModel
 * }} ModelSet
 * @typedef {{
 *   name: string,
 *   version: string,
 * }} CollectionDetails
 */

process.env.DISABLE_PG_SSL = 'true';
/**
 * yield series of collection details
 *
 * @param {number} total - number of collections
 * @param {boolean} repeatable - use consistent names versus pseudorandom
 * @yields {CollectionDetails}
 */
function* yieldCollectionDetails(total, repeatable = true) {
  for (let i = 0; i < total; i += 1) {
    let suffix;
    if (repeatable) {
      suffix = `_test_${i.toString().padStart(3, '0')}`;
    } else {
      suffix = `_${cryptoRandomString({ length: 5 }).toUpperCase()}`;
    }
    yield {
      name: `MOD09GQ${suffix}`,
      version: '006',
    };
  }
}

/**
 * upload a batch of granules and executions
 * along with files per granule and granuleExecutions
 *
 * @typedef {{
 *   knex: Knex,
 *   collectionCumulusId: number,
 *   providerCumulusId: number,
 *   filesPerGranule: number
 *   granulesPerBatch: number,
 *   executionsPerBatch: number,
 *   models: ModelSet,
 *   swallowErrors: boolean,
 * }} BatchParams
 *
 * @param {BatchParams} params
 * @returns {Promise<{
 *   granuleCumulusIds: Array<number>
 *   fileCumulusIds: Array<number>
 *   executionCumulusIds: Array<number>
 * }>}
 */
const uploadDataBatch = async ({
  knex,
  collectionCumulusId,
  providerCumulusId,
  filesPerGranule,
  granulesPerBatch,
  executionsPerBatch,
  models,
  swallowErrors,
}) => {
  const granuleCumulusIds = await loadGranules(
    knex,
    collectionCumulusId,
    providerCumulusId,
    granulesPerBatch,
    models.granuleModel,
    swallowErrors
  );
  const fileCumulusIds = [];
  for (const granuleCumulusId of granuleCumulusIds) {
    fileCumulusIds.push(
      await loadFiles(knex, granuleCumulusId, filesPerGranule, models.fileModel, swallowErrors)
    );
  }
  const executionCumulusIds = await loadExecutions(
    knex,
    collectionCumulusId,
    executionsPerBatch,
    models.executionModel,
    swallowErrors
  );
  await loadGranulesExecutions(
    knex,
    granuleCumulusIds,
    executionCumulusIds,
    models.geModel,
    swallowErrors
  );
  return {
    granuleCumulusIds,
    fileCumulusIds: fileCumulusIds.flat(),
    executionCumulusIds,
  };
};

/**
 * create a generator Object that pretends to be an Iterable
 * this is to allow pmap to use this data without holding the entire (potentially very large)
 * set of batch params for more than the currently running threads
 *
 * @param {object} params
 * @param {Knex} params.knex
 * @param {number} params.numberOfGranules
 * @param {number} params.collectionCumulusId
 * @param {number} params.providerCumulusId
 * @param {number} params.filesPerGranule
 * @param {number} params.granulesPerBatch
 * @param {number} params.executionsPerBatch
 * @param {ModelSet} params.models
 * @param {boolean} params.variance
 * @param {boolean} params.swallowErrors
 * @returns {Iterable<BatchParams>}
 */

const getDetailGenerator = ({
  knex,
  numberOfGranules,
  collectionCumulusId,
  providerCumulusId,
  filesPerGranule,
  granulesPerBatch,
  executionsPerBatch,
  models,
  variance,
  swallowErrors = false,
}) => {
  if (granulesPerBatch < 1) {
    throw new Error('granulesPerBatch must be set to >=1');
  }
  /**
   * @yields {BatchParams}
   */
  function* detailGenerator() {
    const bar = new cliProgress.SingleBar(
      { etaBuffer: numberOfGranules / 10 }
    );
    bar.start(numberOfGranules, 0);
    let _granulesPerBatch = 1;
    for (let i = 0; i < numberOfGranules; i += _granulesPerBatch) {
      _granulesPerBatch = granulesPerBatch + (variance ? randomInt(6) : 0);
      const _executionsPerBatch = executionsPerBatch + (variance ? randomInt(6) : 0);
      bar.update(i);

      // this yields one object each time this object is iterated...
      yield {
        knex,
        collectionCumulusId,
        providerCumulusId,
        filesPerGranule,
        granulesPerBatch: _granulesPerBatch,
        executionsPerBatch: _executionsPerBatch,
        models,
        swallowErrors,
      };
    }
    bar.stop();
  }
  const clujedIterable = {};
  // this sets this objects iteration behavior to be detailGenerator
  clujedIterable[Symbol.iterator] = detailGenerator;

  return /** @type {Iterable<BatchParams>} */(clujedIterable);
};

/**
 * upload a batch of granules and executions
 * along with files per granule and granuleExecutions
 *
 * @param {Knex} knex
 * @param {string} providerId
 * @param {CollectionDetails} collection
 * @param {number} numberOfGranules
 * @param {number} filesPerGranule
 * @param {number} granulesPerBatch
 * @param {number} executionsPerBatch
 * @param {number} concurrency
 * @param {boolean} variance
 * @returns {Promise<void>}
 */

const uploadDBGranules = async (
  knex,
  providerId,
  collection,
  numberOfGranules,
  filesPerGranule,
  granulesPerBatch,
  executionsPerBatch,
  concurrency,
  variance,
  swallowErrors
) => {
  const collectionPgModel = new CollectionPgModel();
  const providerPgModel = new ProviderPgModel();
  const dbCollection = await collectionPgModel.get(
    knex,
    { name: collection.name, version: collection.version }
  );
  const dbProvider = await providerPgModel.get(knex, { name: providerId });
  const collectionCumulusId = dbCollection.cumulus_id;
  const providerCumulusId = dbProvider.cumulus_id;
  const models = {
    geModel: new GranulesExecutionsPgModel(),
    executionModel: new ExecutionPgModel(),
    granuleModel: new GranulePgModel(),
    fileModel: new FilePgModel(),
  };
  const iterableDetailGenerator = getDetailGenerator({
    knex,
    numberOfGranules,
    collectionCumulusId,
    providerCumulusId,
    filesPerGranule,
    granulesPerBatch,
    executionsPerBatch,
    models,
    variance,
    swallowErrors
  });
  await pMap(
    iterableDetailGenerator,
    (params) => {
      uploadDataBatch(params);
    },
    { concurrency }
  );
};

/**
 * Parse executions per batch and granules per batch based on a given ratio
 *
 * @param {string} executionsPerGranule - executionsPerGranule in <executions>:<granules>
 * @returns {{executionsPerBatch: number, granulesPerBatch: number}}
 */
const parseExecutionsGranulesBatch = (executionsPerGranule) => {
  // expect to come in format 'x:y'
  try {
    const split = executionsPerGranule.split(':');
    if (split.length < 2) {
      throw new Error(`only 1 value could be split from ${executionsPerGranule}`);
    }
    const executionsPerBatch = Number.parseInt(split[0], 10);
    const granulesPerBatch = Number.parseInt(split[1], 10);
    return { executionsPerBatch, granulesPerBatch };
  } catch (error) {
    throw new Error(`cannot parse ${executionsPerGranule}, expected format <executions>:<granules> ratio \n${error}`);
  }
};

/**
 * parse command line args for run parameters
 *
 * @returns {{
 *   granules: number,
 *   files: number,
 *   granulesPerBatch: number
 *   executionsPerBatch: number
 *   collections: number
 *   concurrency: number
 *   variance: boolean
 *   swallowErrors: boolean
 * }}
 */
const parseArgs = () => {
  const {
    granulesK,
    files,
    executionsPerGranule,
    collections,
    variance,
    concurrency,
    swallowErrors,
  } = minimist(
    process.argv,
    {
      string: [
        'collections',
        'files',
        'granulesK',
        'executionsPerGranule',
        'concurrency',
      ],
      boolean: [
        'swallowErrors',
        'variance',
      ],
      alias: {
        g: 'granulesK',
        f: 'files',
        c: 'collections',
        e: 'executionsPerGranule',
        C: 'concurrency',
        v: 'variance',
        s: 'swallowErrors',
      },
      default: {
        collections: process.env.COLLECTIONS || 1,
        files: process.env.FILES || 1,
        granulesK: process.env.GRANULES_K || 10,
        executionsPerGranule: process.env.EXECUTIONS_PER_GRANULE || '2:2',
        variance: process.env.VARIANCE || false,
        concurrency: process.env.CONCURRENCY || 1,
        swallowErrors: process.env.SWALLOW_ERRORS || true,
      },
    }
  );
  const {
    granulesPerBatch,
    executionsPerBatch,
  } = parseExecutionsGranulesBatch(executionsPerGranule);
  if (granulesPerBatch < 1) {
    throw new Error(`granules per batch must be > 0, got ${granulesPerBatch} from ${executionsPerGranule}`);
  }
  if (concurrency < 1) {
    throw new Error(`concurrency must be > 0, got ${concurrency}`);
  }
  return {
    granules: Number.parseInt(granulesK, 10) * 1000,
    files: Number.parseInt(files, 10),
    granulesPerBatch: granulesPerBatch,
    executionsPerBatch: executionsPerBatch,
    collections: Number.parseInt(collections, 10),
    concurrency: Number.parseInt(concurrency, 10),
    variance,
    swallowErrors,
  };
};

/**
 * handle command line arguments and environment variables
 * run the data upload based on configured parameters
 */
const main = async () => {
  const {
    granules,
    files,
    granulesPerBatch,
    executionsPerBatch,
    collections,
    variance,
    concurrency,
    swallowErrors,
  } = parseArgs();
  process.env.dbMaxPool = concurrency.toString();
  const knex = await getKnexClient();
  const providerId = await loadProvider(knex);
  for (const collection of yieldCollectionDetails(collections, true)) {
    await loadCollection(knex, collection.name, files);
    await uploadDBGranules(
      knex,
      providerId,
      collection,
      granules,
      files,
      granulesPerBatch,
      executionsPerBatch,
      concurrency,
      variance,
      swallowErrors
    );
  }
};

if (require.main === module) {
  main(
  ).then(
    (ret) => ret
  ).catch((error) => {
    console.log(`failed: ${error}`);
    throw error;
  });
}

module.exports = {
  yieldCollectionDetails,
  getDetailGenerator,
  parseArgs,
  uploadDataBatch,
  uploadDBGranules,
};
