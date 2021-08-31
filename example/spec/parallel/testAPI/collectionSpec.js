'use strict';

const omit = require('lodash/omit');

const { deleteS3Object, getJsonS3Object, waitForObjectToExist } = require('@cumulus/aws-client/S3');
const { createCollection } = require('@cumulus/integration-tests/Collections');
const { api: apiTestUtils } = require('@cumulus/integration-tests');
const { deleteCollection } = require('@cumulus/api-client/collections');

const { loadConfig } = require('../../helpers/testUtils');

describe('Collections API', () => {
  let beforeAllFailed = false;
  let config;
  let collection;
  let prefix;
  let recordCreatedKey;
  let recordUpdatedKey;
  let recordDeletedKey;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      prefix = config.stackName;

      collection = await createCollection(prefix);
      const { name, version } = collection;

      const reportKeyPrefix = `${config.stackName}/test-output`;
      recordCreatedKey = `${reportKeyPrefix}/${name}-${version}-Create.output`;
      recordUpdatedKey = `${reportKeyPrefix}/${name}-${version}-Update.output`;
      recordDeletedKey = `${reportKeyPrefix}/${name}-${version}-Delete.output`;
    } catch (error) {
      beforeAllFailed = true;
      console.log(error);
    }
  });

  afterAll(async () => {
    await Promise.all([
      deleteS3Object(config.bucket, recordCreatedKey),
      deleteS3Object(config.bucket, recordUpdatedKey),
      deleteS3Object(config.bucket, recordDeletedKey),
    ]);
  });

  it('creating a collection publishes a record to the collection reporting SNS topic', async () => {
    if (beforeAllFailed) {
      fail('beforeAll() failed');
    } else {
      await expectAsync(waitForObjectToExist({
        bucket: config.bucket,
        key: recordCreatedKey,
      })).toBeResolved();
      const savedEvent = await getJsonS3Object(config.bucket, recordCreatedKey);
      const message = JSON.parse(savedEvent.Records[0].Sns.Message);
      expect(message.event).toEqual('Create');
      expect(omit(message.record, ['createdAt', 'updatedAt'])).toEqual(collection);
    }
  });

  it('updating a collection publishes a record to the collection reporting SNS topic', async () => {
    if (beforeAllFailed) {
      fail('beforeAll() failed');
    } else {
      await apiTestUtils.updateCollection({
        prefix: config.stackName,
        collection,
        updateParams: { files: [] },
      });

      await expectAsync(waitForObjectToExist({
        bucket: config.bucket,
        key: recordUpdatedKey,
      })).toBeResolved();
      const savedEvent = await getJsonS3Object(config.bucket, recordUpdatedKey);
      const message = JSON.parse(savedEvent.Records[0].Sns.Message);
      expect(message.event).toEqual('Update');
      expect(omit(message.record, ['createdAt', 'updatedAt', 'files'])).toEqual(omit(collection, 'files'));
      expect(message.record.files).toEqual([]);
    }
  });

  it('deleting a collection publishes a record to the collection reporting SNS topic', async () => {
    if (beforeAllFailed) {
      fail('beforeAll() failed');
    } else {
      const timestamp = Date.now();
      await deleteCollection({
        prefix,
        collectionName: collection.name,
        collectionVersion: collection.version,
      });

      await expectAsync(waitForObjectToExist({
        bucket: config.bucket,
        key: recordDeletedKey,
      })).toBeResolved();
      const savedEvent = await getJsonS3Object(config.bucket, recordDeletedKey);
      const message = JSON.parse(savedEvent.Records[0].Sns.Message);
      expect(message.event).toEqual('Delete');
      expect(message.record).toEqual({ name: collection.name, version: collection.version });
      expect(message.deletedAt).toBeGreaterThan(timestamp);
    }
  });
});
