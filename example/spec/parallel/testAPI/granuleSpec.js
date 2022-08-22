'use strict';

const omit = require('lodash/omit');
const {
  s3PutObject,
  getJsonS3Object,
  waitForObjectToExist,
} = require('@cumulus/aws-client/S3');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { waitForListGranulesResult } = require('@cumulus/integration-tests/Granules');
const { constructCollectionId } = require('@cumulus/message/Collections');
const { deleteCollection } = require('@cumulus/api-client/collections');
const {
  associateExecutionWithGranule,
  createGranule,
  deleteGranule,
  getGranule,
  updateGranule,
} = require('@cumulus/api-client/granules');
const {
  createExecution,
  deleteExecution,
} = require('@cumulus/api-client/executions');
const { randomId } = require('@cumulus/common/test-utils');
const { removeNilProperties } = require('@cumulus/common/util');
const {
  fakeExecutionFactoryV2,
  fakeGranuleFactoryV2,
} = require('@cumulus/api/lib/testUtils');

const { loadConfig } = require('../../helpers/testUtils');

describe('The Granules API', () => {
  let beforeAllError;
  let config;
  let collection;
  let collectionId;
  let discoveredGranule;
  let executionRecord;
  let granuleFile;
  let granuleId;
  let modifiedGranule;
  let prefix;
  let randomGranuleRecord;
  let updatedGranuleFromApi;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection = await createCollection(prefix);
      collectionId = constructCollectionId(collection.name, collection.version);

      executionRecord = omit(fakeExecutionFactoryV2({
        collectionId,
        status: 'running',
      }), ['parentArn', 'createdAt', 'updatedAt']);

      const response = await createExecution({
        prefix,
        body: executionRecord,
      });

      if (response.statusCode !== 200) {
        throw new Error(`failed to createExecution ${response.body.message}`);
      }

      granuleFile = {
        bucket: config.buckets.public.name,
        key: randomId('key'),
        size: 8,
      };
      await s3PutObject({
        Bucket: granuleFile.bucket,
        Key: granuleFile.key,
        Body: 'testfile',
      });

      randomGranuleRecord = removeNilProperties(fakeGranuleFactoryV2({
        collectionId,
        published: false,
        dataType: undefined,
        version: undefined,
        execution: undefined,
        files: [granuleFile],
      }));
      console.log('granule record: %j', randomGranuleRecord);

      granuleId = randomGranuleRecord.granuleId;
    } catch (error) {
      beforeAllError = error;
    }
  });

  afterAll(async () => {
    await deleteExecution({ prefix, executionArn: executionRecord.arn });
    await deleteCollection({
      prefix,
      collectionName: collection.name,
      collectionVersion: collection.version,
    });
  });

  describe('the Granule Api', () => {
    it('creates a granule.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }
      const response = await createGranule({
        prefix,
        body: randomGranuleRecord,
      });

      expect(response.statusCode).toBe(200);
      const { message } = JSON.parse(response.body);
      expect(message).toBe(`Successfully wrote granule with Granule Id: ${granuleId}, Collection Id: ${collectionId}`);
    });

    it('can discover the granule directly via the API.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

      discoveredGranule = await getGranule({
        prefix,
        granuleId,
        collectionId,
      });
      expect(discoveredGranule).toEqual(jasmine.objectContaining(randomGranuleRecord));
    });

    it('can search the granule via the API.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

      const searchResults = await waitForListGranulesResult({
        prefix,
        query: {
          granuleId: randomGranuleRecord.granuleId,
        },
      });

      const searchedGranule = JSON.parse(searchResults.body).results[0];
      expect(searchedGranule).toEqual(jasmine.objectContaining(randomGranuleRecord));
    });

    it('can modify the granule via API.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

      modifiedGranule = {
        ...discoveredGranule,
        status: 'failed',
        error: { message: 'granule now failed' },
      };
      const response = await updateGranule({
        prefix,
        granuleId: modifiedGranule.granuleId,
        collectionId: modifiedGranule.collectionId,
        body: modifiedGranule,
      });

      expect(response.statusCode).toBe(200);
      updatedGranuleFromApi = await getGranule({
        prefix,
        granuleId: modifiedGranule.granuleId,
        collectionId: modifiedGranule.collectionId,
      });
      updatedGranuleFromApi.execution = undefined;
      expect(updatedGranuleFromApi).toEqual(jasmine.objectContaining(modifiedGranule));
    });

    it('can associate an execution with the granule via API.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

      const requestPayload = {
        granuleId,
        collectionId,
        executionArn: executionRecord.arn,
      };
      const response = await associateExecutionWithGranule({
        prefix,
        body: requestPayload,
      });

      expect(response.statusCode).toBe(200);
      updatedGranuleFromApi = await getGranule({
        prefix,
        granuleId,
        collectionId,
      });
      expect(updatedGranuleFromApi.execution).toBe(executionRecord.execution);
    });

    it('Errors creating a bad granule.', async () => {
      if (beforeAllError) {
        fail(beforeAllError);
      }

      const name = randomId('name');
      const version = randomId('version');
      const badRandomGranuleRecord = fakeGranuleFactoryV2({
        collectionId: constructCollectionId(name, version),
        execution: undefined,
      });
      try {
        await createGranule({
          prefix,
          body: badRandomGranuleRecord,
        });
      } catch (error) {
        const apiError = JSON.parse(error.apiMessage);
        expect(apiError.statusCode).toBe(400);
        expect(apiError.error).toBe('Bad Request');
        expect(apiError.message).toContain('RecordDoesNotExist');
        expect(apiError.message).toContain(name);
        expect(apiError.message).toContain(version);
      }
    });

    it('publishes a record to the granules reporting SNS topic upon granule creation', async () => {
      if (beforeAllError) {
        fail('beforeAll() failed');
      } else {
        const granuleKey = `${config.stackName}/test-output/${granuleId}-${discoveredGranule.status}-Create.output`;
        await expectAsync(waitForObjectToExist({
          bucket: config.bucket,
          key: granuleKey,
        })).toBeResolved();
        const savedEvent = await getJsonS3Object(config.bucket, granuleKey);
        const message = JSON.parse(savedEvent.Records[0].Sns.Message);
        expect(message.event).toEqual('Create');
        expect(message.record).toEqual(discoveredGranule);
      }
    });

    it('publishes a record to the granules reporting SNS topic for a granule modification', async () => {
      if (beforeAllError) {
        fail('beforeAll() failed');
      } else {
        const granuleKey = `${config.stackName}/test-output/${modifiedGranule.granuleId}-${modifiedGranule.status}-Update.output`;
        await expectAsync(waitForObjectToExist({
          bucket: config.bucket,
          key: granuleKey,
        })).toBeResolved();
        const savedEvent = await getJsonS3Object(config.bucket, granuleKey);
        const message = JSON.parse(savedEvent.Records[0].Sns.Message);
        expect(message.event).toEqual('Update');
        expect(message.record).toEqual(updatedGranuleFromApi);
      }
    });

    it('publishes a record to the granules reporting SNS topic for a granule deletion', async () => {
      if (beforeAllError) {
        fail('beforeAll() failed');
      } else {
        const timestamp = Date.now();
        const response = await deleteGranule({ prefix, granuleId: modifiedGranule.granuleId });
        expect(response.statusCode).toBe(200);

        const granuleKey = `${config.stackName}/test-output/${modifiedGranule.granuleId}-${modifiedGranule.status}-Delete.output`;
        await expectAsync(waitForObjectToExist({
          bucket: config.bucket,
          key: granuleKey,
        })).toBeResolved();
        const savedEvent = await getJsonS3Object(config.bucket, granuleKey);
        const message = JSON.parse(savedEvent.Records[0].Sns.Message);
        expect(message.event).toEqual('Delete');
        expect(message.record).toEqual(updatedGranuleFromApi);
        expect(message.deletedAt).toBeGreaterThan(timestamp);
      }
    });
  });
});
