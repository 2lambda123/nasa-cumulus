const fs = require('fs-extra');
const moment = require('moment');
const AWS = require('aws-sdk');

const {
  aws: {
    fileExists,
    getS3Object,
    parseS3Uri,
    lambda,
    s3
  },
  constructCollectionId
} = require('@cumulus/common');
const { Granule } = require('@cumulus/api/models');
const {
  addCollections,
  addProviders,
  buildAndExecuteWorkflow,
  cleanupProviders,
  granulesApi: granulesApiTestUtils,
  waitUntilGranuleStatusIs
} = require('@cumulus/integration-tests');

const {
  loadConfig,
  uploadTestDataToBucket,
  deleteFolder,
  createTimestampedTestId,
  createTestDataPath,
  createTestSuffix
} = require('../../helpers/testUtils');

const config = loadConfig();

const emsReportLambda = `${config.stackName}-EmsIngestReport`;
const bucket = config.bucket;
const emsProvider = config.ems.provider;
const stackName = config.stackName;
const submitReport = config.ems.submitReport === 'true' || false;

const { setupTestGranuleForIngest } = require('../../helpers/granuleUtils');

const providersDir = './data/providers/s3/';
const collectionsDir = './data/collections/s3_MOD14A1_006';
const inputPayloadFilename = './spec/parallel/emsReport/IngestGranule.MOD14A1_006.input.payload.json';
const collection = { name: 'MOD14A1', version: '006' };
const collectionId = constructCollectionId(collection.name, collection.version);
const granuleRegex = '^MOD14A1\\.A[\\d]{7}\\.[\\w]{6}\\.006\\.[\\d]{13}$';

process.env.CollectionsTable = `${config.stackName}-CollectionsTable`;
process.env.GranulesTable = `${config.stackName}-GranulesTable`;

// add MOD14A1___006 collection
async function setupCollectionAndTestData(testSuffix, testDataFolder) {
  const s3data = [
    '@cumulus/test-data/granules/MOD14A1.A2000049.h00v10.006.2015041132152.hdf.met',
    '@cumulus/test-data/granules/MOD14A1.A2000049.h00v10.006.2015041132152.hdf'
  ];

  // populate collections, providers and test data
  await Promise.all([
    uploadTestDataToBucket(config.bucket, s3data, testDataFolder),
    addCollections(config.stackName, config.bucket, collectionsDir),
    addProviders(config.stackName, config.bucket, providersDir, config.bucket, testSuffix)
  ]);
}

// ingest a granule and publish if requested
async function ingestAndPublishGranule(testSuffix, testDataFolder, publish = true) {
  const workflowName = publish ? 'IngestAndPublishGranule' : 'IngestGranule';
  const provider = { id: `s3_provider${testSuffix}` };

  const inputPayloadJson = fs.readFileSync(inputPayloadFilename, 'utf8');
  // update test data filepaths
  const inputPayload = await setupTestGranuleForIngest(config.bucket, inputPayloadJson, granuleRegex, '', testDataFolder);

  await buildAndExecuteWorkflow(
    config.stackName, config.bucket, workflowName, collection, provider, inputPayload
  );

  await waitUntilGranuleStatusIs(config.stackName, inputPayload.granules[0].granuleId, 'completed');

  return inputPayload.granules[0].granuleId;
}

// delete old granules
async function deleteOldGranules() {
  const dbGranulesIterator = new Granule().getGranulesForCollection(collectionId, 'completed');
  let nextDbItem = await dbGranulesIterator.peek();
  while (nextDbItem) {
    const nextDbGranuleId = nextDbItem.granuleId;
    if (nextDbItem.published) {
      // eslint-disable-next-line no-await-in-loop
      await granulesApiTestUtils.removePublishedGranule({ prefix: config.stackName, granuleId: nextDbGranuleId });
    } else {
      // eslint-disable-next-line no-await-in-loop
      await granulesApiTestUtils.deleteGranule({ prefix: config.stackName, granuleId: nextDbGranuleId });
    }

    await dbGranulesIterator.shift(); // eslint-disable-line no-await-in-loop
    nextDbItem = await dbGranulesIterator.peek(); // eslint-disable-line no-await-in-loop
  }
}

describe('The EMS report', () => {
  let testDataFolder;
  let testSuffix;
  let deletedGranuleId;
  let ingestedGranuleIds;

  beforeAll(async () => {
    // in order to generate the ingest reports here and by daily cron, we need to ingest granules
    // as well as delete granules

    const testId = createTimestampedTestId(config.stackName, 'emsIngestReport');
    testSuffix = createTestSuffix(testId);
    testDataFolder = createTestDataPath(testId);

    await setupCollectionAndTestData(testSuffix, testDataFolder);
    // ingest one granule, this will be deleted later
    deletedGranuleId = await ingestAndPublishGranule(testSuffix, testDataFolder);

    // delete granules ingested for this collection, so that ArchDel report can be generated
    await deleteOldGranules();

    // ingest two new granules, so that Arch and Ing reports can be generated
    ingestedGranuleIds = await Promise.all([
      // ingest a granule and publish it to CMR
      ingestAndPublishGranule(testSuffix, testDataFolder),

      // ingest a granule but not publish it to CMR
      ingestAndPublishGranule(testSuffix, testDataFolder, false)
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      deleteFolder(config.bucket, testDataFolder),
      // leave collections in the table for EMS reports
      //cleanupCollections(config.stackName, config.bucket, collectionsDir),
      cleanupProviders(config.stackName, config.bucket, providersDir, testSuffix)
    ]);
  });

  describe('When run automatically', () => {
    let expectReports = false;
    beforeAll(async () => {
      const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
      AWS.config.update({ region: region });

      const lambdaConfig = await lambda().getFunctionConfiguration({ FunctionName: emsReportLambda })
        .promise();
      const lastUpdate = lambdaConfig.LastModified;

      // Compare lambda function's lastUpdate with the time 24 hours before now.
      // If the lambda is created 24 hours ago, it must have been invoked
      // and generated EMS reports for the previous day.
      if (new Date(lastUpdate).getTime() < moment.utc().subtract(24, 'hours').toDate().getTime()) {
        expectReports = true;
      }
    });

    it('generates an EMS report every 24 hours', async () => {
      if (expectReports) {
        const datestring = moment.utc().format('YYYYMMDD');
        const types = ['Ing', 'Arch', 'ArchDel'];
        const jobs = types.map((type) => {
          const filename = `${datestring}_${emsProvider}_${type}_${stackName}.flt`;
          const key = `${stackName}/ems/${filename}`;
          const sentKey = `${stackName}/ems/sent/${filename}`;
          return fileExists(bucket, key) || fileExists(bucket, sentKey);
        });
        const results = await Promise.all(jobs);
        results.forEach((result) => expect(result).not.toBe('false'));
      }
    });
  });

  describe('After execution', () => {
    let lambdaOutput;
    beforeAll(async () => {
      const region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
      AWS.config.update({ region: region });

      // add a few seconds to allow records searchable in elasticsearch
      const endTime = moment.utc().add(3, 'seconds').format();
      const startTime = moment.utc().subtract(1, 'days').format();

      const response = await lambda().invoke({
        FunctionName: emsReportLambda,
        Payload: JSON.stringify({
          startTime,
          endTime
        })
      }).promise()
        .catch((err) => console.log('invoke err', err));

      lambdaOutput = JSON.parse(response.Payload);
    });

    afterAll(async () => {
      const jobs = lambdaOutput.map(async (report) => {
        const parsed = parseS3Uri(report.file);
        return s3().deleteObject({ Bucket: parsed.Bucket, Key: parsed.Key }).promise();
      });
      await Promise.all(jobs);
    });

    it('generates an EMS report', async () => {
      // generated reports should have the records just ingested or deleted
      expect(lambdaOutput.length).toEqual(3);
      const jobs = lambdaOutput.map(async (report) => {
        const parsed = parseS3Uri(report.file);
        const obj = await getS3Object(parsed.Bucket, parsed.Key);
        const reportRecords = obj.Body.toString().split('\n');
        if (['ingest', 'archive'].includes(report.reportType)) {
          const records = reportRecords.filter((record) =>
            record.startsWith(ingestedGranuleIds[0]) || record.startsWith(ingestedGranuleIds[1]));
          expect(records.length).toEqual(2);
        }
        if (report.reportType === 'delete') {
          const records = reportRecords.filter((record) =>
            record.startsWith(deletedGranuleId));
          expect(records.length).toEqual(1);
        }

        if (submitReport) {
          expect(parsed.Key.includes('/sent/')).toBe(true);
        }

        return true;
      });
      const results = await Promise.all(jobs);
      results.forEach((result) => expect(result).not.toBe(false));
    });
  });
});
