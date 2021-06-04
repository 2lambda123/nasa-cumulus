import AWS from 'aws-sdk';
import got from 'got';
import Logger from '@cumulus/logger';
import { Context } from 'aws-lambda';

import { constructCollectionId } from '@cumulus/message/Collections';
import { CumulusMessage, CumulusRemoteMessage } from '@cumulus/types/message';
import { getCollection } from '@cumulus/api-client/collections';
import { getLaunchpadToken } from '@cumulus/launchpad-auth';
import { getRequiredEnvVar } from '@cumulus/common/env';
import { getSecretString } from '@cumulus/aws-client/SecretsManager';
import { inTestMode } from '@cumulus/aws-client/test-utils';
import { parseS3Uri } from '@cumulus/aws-client/S3';
import { CollectionRecord } from '@cumulus/types/api/collections';
import { runCumulusTask, CumulusMessageWithAssignedPayload } from '@cumulus/cumulus-message-adapter-js';
import { s3 as coreS3, sts } from '@cumulus/aws-client/services';
import {
  constructDistributionUrl,
  fetchDistributionBucketMap,
} from '@cumulus/distribution-utils';

import {
  ChecksumError,
  CollectionNotDefinedError,
  CollectionInvalidRegexpError,
  GetAuthTokenError,
  InvalidUrlTypeError,
} from './errors';
import { isFulfilledPromise } from './typeGuards';
import { makeBackupFileRequestResult, HandlerEvent, MessageGranule, MessageGranuleFilesObject } from './types';

const log = new Logger({ sender: '@cumulus/lzards-backup' });

const CREDS_EXPIRY_SECONDS = 1000;
const S3_LINK_EXPIRY_SECONDS_DEFAULT = 3600;

export const generateCloudfrontUrl = async (params: {
  Bucket: string,
  Key: string,
  cloudfrontEndpoint?: string,
}) => {
  const distributionBucketMap = await fetchDistributionBucketMap();
  return constructDistributionUrl(
    params.Bucket,
    params.Key,
    distributionBucketMap,
    params.cloudfrontEndpoint
  );
};

export const generateDirectS3Url = async (params: {
  roleCreds: AWS.STS.AssumeRoleResponse,
  Bucket: string,
  Key: string,
  usePassedCredentials?: boolean
}) => {
  const { roleCreds, Key, Bucket, usePassedCredentials } = params;
  const region = process.env.AWS_REGION || 'us-east-1';
  const secretAccessKey = roleCreds?.Credentials?.SecretAccessKey;
  const sessionToken = roleCreds?.Credentials?.SessionToken;
  const accessKeyId = roleCreds?.Credentials?.AccessKeyId;

  const s3AccessTimeoutSeconds = (
    process.env.lzards_s3_link_timeout || S3_LINK_EXPIRY_SECONDS_DEFAULT
  );
  let s3;
  if (!inTestMode() || usePassedCredentials) {
    const s3Config = {
      signatureVersion: 'v4',
      secretAccessKey,
      accessKeyId,
      sessionToken,
      region,
    };
    s3 = new AWS.S3(s3Config);
  } else {
    coreS3().config.update({ signatureVersion: 'v4' });
    s3 = coreS3();
  }
  return await s3.getSignedUrlPromise('getObject', { Bucket, Key, Expires: s3AccessTimeoutSeconds });
};

export const generateAccessUrl = async (params: {
  Bucket: string,
  Key: string,
  urlConfig: {
    roleCreds: AWS.STS.AssumeRoleResponse,
    urlType?: string,
    cloudfrontEndpoint?: string,
  },
}) => {
  const {
    Bucket,
    Key,
    urlConfig: {
      roleCreds,
      urlType,
      cloudfrontEndpoint,
    },
  } = params;

  try {
    switch ((urlType || 's3')) {
      case 's3': return await generateDirectS3Url({ roleCreds, Bucket, Key });
      case 'cloudfront': return await generateCloudfrontUrl({ Bucket, Key, cloudfrontEndpoint });
      default: throw new InvalidUrlTypeError(`${urlType} is not a recognized type for access URL generation`);
    }
  } catch (error) {
    log.error(`${urlType} access URL generation failed for s3://${Bucket}/${Key}: ${error}`);
    throw error;
  }
};

export const setLzardsChecksumQueryType = (
  file: MessageGranuleFilesObject,
  granuleId: string
) => {
  if (file.checksumType === 'md5') {
    return { expectedMd5Hash: file.checksum };
  }
  if (file.checksumType === 'sha256') {
    return { expectedSha256Hash: file.checksum };
  }
  log.error(`${granuleId}: File ${file.filename} did not have a checksum or supported checksumType defined`);
  throw new ChecksumError(`${granuleId}: File ${file.filename} did not have a checksum or checksumType defined`);
};

export const postRequestToLzards = async (params: {
  accessUrl: string,
  authToken: string,
  collection: string,
  file: MessageGranuleFilesObject,
  granuleId: string,
}) => {
  const {
    accessUrl,
    authToken,
    collection,
    file,
    granuleId,
  } = params;

  const provider = getRequiredEnvVar('lzards_provider');
  const lzardsApiUrl = getRequiredEnvVar('lzards_api');

  const checksumConfig = setLzardsChecksumQueryType(file, granuleId);

  try {
    return await got.post(lzardsApiUrl,
      {
        json: {
          provider,
          objectUrl: accessUrl,
          metadata: {
            filename: file.filename,
            collection,
            granuleId,
          },
          ...checksumConfig,
        },
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
  } catch (error) {
    log.error('got encountered error:', error);
    if (error.options) log.debug('erroring request:', JSON.stringify(error.options));
    if (error.response) log.debug('error response:', JSON.stringify(error.response.body));
    throw error;
  }
};

export const makeBackupFileRequest = async (params: {
  backupConfig: {
    roleCreds: AWS.STS.AssumeRoleResponse,
    authToken: string,
    urlType: string,
    cloudfrontEndpoint?: string,
  },
  collectionId: string,
  file: MessageGranuleFilesObject,
  granuleId: string,
  lzardsPostMethod?: typeof postRequestToLzards,
  generateAccessUrlMethod?: typeof generateAccessUrl,
}): Promise<makeBackupFileRequestResult> => {
  const {
    collectionId,
    backupConfig,
    backupConfig: { authToken },
    file,
    granuleId,
    lzardsPostMethod = postRequestToLzards,
    generateAccessUrlMethod = generateAccessUrl,
  } = params;

  try {
    const { Key, Bucket } = parseS3Uri(file.filename);
    log.info(`${granuleId}: posting backup request to LZARDS: ${file.filename}`);
    const accessUrl = await generateAccessUrlMethod({
      Bucket,
      Key,
      urlConfig: backupConfig,
    });
    const { statusCode, body } = await lzardsPostMethod({
      accessUrl,
      authToken,
      collection: collectionId,
      file,
      granuleId,
    });
    if (statusCode !== 201) {
      log.error(`${granuleId}: Request failed - LZARDS api returned ${statusCode}: ${JSON.stringify(body)}`);
      return { statusCode, granuleId, filename: file.filename, body, status: 'FAILED' };
    }
    return { statusCode, granuleId, filename: file.filename, body, status: 'COMPLETED' };
  } catch (error) {
    log.error(`${granuleId}: LZARDS request failed: ${error}`);
    return {
      granuleId,
      filename: file.filename,
      body: JSON.stringify({ name: error.name, stack: error.stack }),
      status: 'FAILED',
    };
  }
};

export const shouldBackupFile = (
  fileName: string,
  collectionConfig: CollectionRecord
): boolean => {
  const collectionFiles = collectionConfig?.files || [];
  const matchingConfig = collectionFiles.filter(
    ({ regex }) => fileName.match(regex)
  );
  if (matchingConfig.length > 1) {
    const errString = `Multiple files matched configured regexp for ${JSON.stringify(collectionConfig)},${fileName}`;
    log.error(errString);
    throw new CollectionInvalidRegexpError(errString);
  }
  if (matchingConfig[0]?.lzards?.backup) return true;
  return false;
};

export const getGranuleCollection = async (params: {
  collectionName: string,
  collectionVersion: string,
  stackPrefix?: string
}): Promise<CollectionRecord> => {
  const prefix = params.stackPrefix || getRequiredEnvVar('stackName');
  const { collectionName, collectionVersion } = params;
  if (!collectionName && !collectionVersion) {
    throw new CollectionNotDefinedError('Collection Name and Version not defined');
  }
  return await getCollection({
    prefix,
    collectionName,
    collectionVersion,
  });
};

export const backupGranule = async (params: {
  granule: MessageGranule,
  backupConfig: {
    roleCreds: AWS.STS.AssumeRoleResponse,
    authToken: string,
    urlType: string,
    cloudfrontEndpoint?: string,
  },
}) => {
  const { granule, backupConfig } = params;
  log.info(`${granule.granuleId}: Backup called on granule: ${JSON.stringify(granule)}`);
  try {
    const granuleCollection = await getGranuleCollection({
      collectionName: granule.dataType,
      collectionVersion: granule.version,
    });
    const collectionId = constructCollectionId(granule.dataType, granule.version);
    const backupFiles = granule.files.filter(
      (file) => shouldBackupFile(file.name, granuleCollection)
    );

    log.info(`${JSON.stringify(granule)}: Backing up ${JSON.stringify(backupFiles)}`);
    return Promise.all(backupFiles.map((file) => makeBackupFileRequest({
      backupConfig,
      file,
      collectionId,
      granuleId: granule.granuleId,
    })));
  } catch (error) {
    if (error.name === 'CollectionNotDefinedError') {
      log.error(`${granule.granuleId}: Granule did not have a properly defined collection and version, or refer to a collection that does not exist in the database`);
      log.error(`${granule.granuleId}: Granule (${granule.granuleId}) will not be backed up.`);
    }
    error.message = `${granule.granuleId}: ${error.message}`;
    throw error;
  }
};

export const generateAccessCredentials = async () => {
  const params = {
    RoleArn: getRequiredEnvVar('backup_role_arn'),
    DurationSeconds: CREDS_EXPIRY_SECONDS,
    RoleSessionName: `${Date.now()}`,
  };
  const roleCreds = await sts().assumeRole(params).promise();
  return roleCreds as AWS.STS.AssumeRoleResponse;
};

export const getAuthToken = async () => {
  const api = getRequiredEnvVar('launchpad_api');
  const passphrase = await getSecretString(getRequiredEnvVar('launchpad_passphrase_secret_name'));
  if (!passphrase) {
    throw new GetAuthTokenError('The value stored in "launchpad_passphrase_secret_name" must be defined');
  }
  const certificate = getRequiredEnvVar('launchpad_certificate');
  const token = await getLaunchpadToken({
    api, passphrase, certificate,
  });
  return token;
};

export const backupGranulesToLzards = async (event: HandlerEvent) => {
  // Given an array of granules, submit each file for backup.
  log.warn(`Running backup on ${JSON.stringify(event)}`);
  const roleCreds = await generateAccessCredentials();
  const authToken = await getAuthToken();

  const backupConfig = {
    ...event.config,
    roleCreds,
    authToken,
  };

  const backupPromises = (event.input.granules.map(
    (granule) => backupGranule({ granule, backupConfig })
  ));

  const backupResults = await Promise.allSettled(backupPromises);

  // If there are uncaught exceptions, we want to fail the task.
  if (backupResults.some((result) => result.status === 'rejected')) {
    log.error('Some LZARDS backup results failed due to internal failure');
    log.error('Manual reconciliation required - some backup requests may have processed');
    log.error(`Full output: ${JSON.stringify(backupResults)}`);
    throw new Error(`${JSON.stringify(backupResults)}`);
  }
  const filteredResults = backupResults.filter(
    (result) => isFulfilledPromise(result)
  ) as PromiseFulfilledResult<makeBackupFileRequestResult[]>[];
  return {
    backupResults: filteredResults.map((result) => result.value).flat(),
    granules: event.input.granules,
  };
};

export const handler = async (
  event: CumulusMessage | CumulusRemoteMessage,
  context: Context
): Promise<CumulusMessageWithAssignedPayload
| CumulusRemoteMessage> => await runCumulusTask(backupGranulesToLzards, event, context);
