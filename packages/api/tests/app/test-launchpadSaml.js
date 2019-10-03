'use strict';

const fs = require('fs');
const test = require('ava');
const rewire = require('rewire');

const aws = require('@cumulus/common/aws');
const { randomId } = require('@cumulus/common/test-utils');
const { verifyJwtToken } = require('../../lib/token');
const { AccessToken, User } = require('../../models');
const launchpadSaml = rewire('../../app/launchpadSaml');
const launchpadPublicCertificate = launchpadSaml.__get__(
  'launchpadPublicCertificate'
);
const buildLaunchpadJwt = launchpadSaml.__get__('buildLaunchpadJwt');

process.env.UsersTable = randomId('usersTable');
process.env.AccessTokensTable = randomId('tokenTable');
process.env.stackName = randomId('stackname');
process.env.TOKEN_SECRET = randomId('token_secret');
process.env.system_bucket = randomId('system_bucket');

const testBucketName = randomId('testbucket');
const createBucket = (Bucket) =>
  aws
    .s3()
    .createBucket({ Bucket })
    .promise();
const testBucketNames = [process.env.system_bucket, testBucketName];

const successfulSamlResponse = {
  user: {
    name_id: randomId('name_id'),
    session_index: randomId('session_index')
  }
};
const badSamlResponse = { user: {} };

const xmlMetadataFixture = fs.readFileSync(
  `${__dirname}/fixtures/launchpad-sbx-metadata.xml`,
  'utf8'
);
const badMetadataFixture = fs.readFileSync(
  `${__dirname}/fixtures/bad-metadata.xml`,
  'utf8'
);
const goodMetadataFile = {
  key: 'valid-metadata.xml',
  content: xmlMetadataFixture
};
const badMetadataFile = {
  key: 'bad-metadata.xml',
  content: badMetadataFixture
};
const testFiles = [goodMetadataFile, badMetadataFile];

const certificate = require('./fixtures/certificateFixture');

let accessTokenModel;
let userModel;

test.before(async () => {
  accessTokenModel = new AccessToken();
  await accessTokenModel.createTable();
  userModel = new User();
  await userModel.createTable();

  await Promise.all(testBucketNames.map(createBucket));
  await Promise.all(
    testFiles.map((f) =>
      aws.s3PutObject({
        Bucket: testBucketName,
        Key: f.key,
        Body: f.content
      }))
  );
  // launchpadSaml.__set__('prepareSamlProviders', mockPrepareSamlProvider);
});

test.after.always(async () => {
  await Promise.all(testBucketNames.map(aws.recursivelyDeleteS3Bucket));
  await accessTokenModel.deleteTable();
  await userModel.deleteTable();
});

test.serial(
  'launchpadPublicCertificate returns a certificate from valid file.',
  async (t) => {
    const parsedCertificate = await launchpadPublicCertificate(
      `s3://${testBucketName}/valid-metadata.xml`
    );

    t.deepEqual(parsedCertificate, certificate);
  }
);

test.serial(
  'launchpadPublicCertificate throws error with invalid file.',
  async (t) => {
    await t.throwsAsync(
      launchpadPublicCertificate(`s3://${testBucketName}/bad-metadata.xml`),
      {
        instanceOf: Error,
        message: `Failed to retrieve Launchpad metadata X509 Certificate from s3://${testBucketName}/bad-metadata.xml`
      }
    );
  }
);

test.serial(
  'launchpadPublicCertificate throws error with missing metadata file.',
  async (t) => {
    await t.throwsAsync(
      launchpadPublicCertificate(`s3://${testBucketName}/location`),
      {
        instanceOf: Error,
        message: `Cumulus could not find Launchpad public xml metadata at s3://${testBucketName}/location`
      }
    );
  }
);

test.serial(
  'launchpadPublicCertificate throws error with missing bucket.',
  async (t) => {
    await t.throwsAsync(launchpadPublicCertificate('s3://badBucket/location'), {
      instanceOf: Error,
      message:
        'Cumulus could not find Launchpad public xml metadata at s3://badBucket/location'
    });
  }
);

test('buildLaunchpadJwt returns a valid JWT with correct SAML information.', async (t) => {
  const jwt = await buildLaunchpadJwt(successfulSamlResponse);
  const decodedToken = verifyJwtToken(jwt);

  t.is(decodedToken.username, successfulSamlResponse.user.name_id);
  t.is(decodedToken.accessToken, successfulSamlResponse.user.session_index);

  const modelToken = await accessTokenModel.get({
    accessToken: successfulSamlResponse.user.session_index
  });
  t.is(modelToken.accessToken, successfulSamlResponse.user.session_index);
  t.is(modelToken.username, successfulSamlResponse.user.name_id);
});

test('buildLaunchpadJwt throws with bad SAML information.', async (t) => {
  await t.throwsAsync(buildLaunchpadJwt(badSamlResponse), {
    instanceOf: Error,
    message: 'invalid SAML response received {"user":{}}'
  });
});
