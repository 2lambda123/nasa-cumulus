'use strict';

const {
  aws: {
    buildS3Uri,
    deleteS3Files,
    dynamodb,
    lambda,
    s3
  },
  testUtils: {
    randomString
  }
} = require('@cumulus/common');

const { loadConfig } = require('../helpers/testUtils');

const reportsPrefix = (stackName) => `${stackName}/reconciliation-reports/`;
const filesTableName = (stackName) => `${stackName}-FilesTable`;

async function findProtectedBucket(systemBucket, stackName) {
  const bucketConfigs = await s3().getObject({
    Bucket: systemBucket,
    Key: `${stackName}/workflow/buckets.json`
  }).promise()
    .then((response) => response.Body.toString())
    .then((bucketsConfigString) => JSON.parse(bucketsConfigString))
    .then(Object.values);

  const protectedBucketConfig = bucketConfigs.find((bc) => bc.type === 'protected');
  if (!protectedBucketConfig) throw new Error(`Unable to find protected bucket in ${JSON.stringify(bucketConfigs)}`);

  return protectedBucketConfig.name;
}

function getReportsKeys(systemBucket, stackName) {
  return s3().listObjectsV2({
    Bucket: systemBucket,
    Prefix: reportsPrefix(stackName)
  }).promise()
    .then((response) => response.Contents.map((o) => o.Key));
}

async function deleteReconciliationReports(systemBucket, stackName) {
  const reportKeys = await getReportsKeys(systemBucket, stackName);

  const objectsToDelete = reportKeys.map((Key) => ({
    Bucket: systemBucket,
    Key
  }));

  return deleteS3Files(objectsToDelete);
}

describe('The CreateReconciliationReport lambda function', () => {
  let config;
  let report;
  let extraS3Object;
  let extraDynamoDbItem;
  let protectedBucket;

  beforeAll(async () => {
    config = loadConfig();

    // Remove any pre-existing reconciliation reports
    await deleteReconciliationReports(config.bucket, config.stackName);

    // Find a protected bucket
    protectedBucket = await findProtectedBucket(config.bucket, config.stackName);

    // Write an extra S3 object to the protected bucket
    extraS3Object = { Bucket: protectedBucket, Key: randomString() };
    await s3().putObject(Object.assign({ Body: 'delete-me' }, extraS3Object)).promise();

    // Write an extra file to the DynamoDB Files table
    extraDynamoDbItem = {
      bucket: { S: protectedBucket },
      key: { S: randomString() },
      granuleId: { S: randomString() }
    };

    await dynamodb().putItem({
      TableName: filesTableName(config.stackName),
      Item: extraDynamoDbItem
    }).promise();

    // Run the report
    await lambda().invoke({ FunctionName: `${config.stackName}-CreateReconciliationReport` }).promise();

    // Fetch the report
    const reportKey = (await getReportsKeys(config.bucket, config.stackName))[0];
    report = await s3().getObject({
      Bucket: config.bucket,
      Key: reportKey
    }).promise()
      .then((response) => JSON.parse(response.Body.toString()));
  });

  it('detects a file that is in S3 but not in the DynamoDB Files table', () => {
    const extraS3ObjectUri = buildS3Uri(extraS3Object.Bucket, extraS3Object.Key);
    expect(report.onlyInS3).toContain(extraS3ObjectUri);
  });

  it('detects a file that is in the DynamoDB Files table but not in S3', () => {
    const extraFileUri = buildS3Uri(extraDynamoDbItem.bucket.S, extraDynamoDbItem.key.S);
    const extraDbUris = report.onlyInDynamoDb.map((i) => i.uri);
    expect(extraDbUris).toContain(extraFileUri);
  });

  afterAll(() =>
    Promise.all([
      deleteReconciliationReports(config.bucket, config.stackName),
      s3().deleteObject(extraS3Object).promise(),
      dynamodb().deleteItem({
        TableName: filesTableName(config.stackName),
        Key: {
          bucket: extraDynamoDbItem.bucket,
          key: extraDynamoDbItem.key
        }
      }).promise()
    ]));
});
