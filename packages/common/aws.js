'use strict';

const AWS = require('aws-sdk');
const concurrency = require('./concurrency');
const fs = require('fs');
const path = require('path');
const log = require('./log');
const string = require('./string');
const testUtils = require('./test-utils');

const region = exports.region = process.env.AWS_DEFAULT_REGION || 'us-east-1';
if (region) {
  AWS.config.update({ region: region });
}

// Workaround upload hangs. See: https://github.com/andrewrk/node-s3-client/issues/74'
AWS.util.update(AWS.S3.prototype, { addExpect100Continue: function addExpect100Continue() {} });
AWS.config.setPromisesDependency(Promise);

const S3_RATE_LIMIT = 20;

const memoize = (fn) => {
  let memo = null;
  return () => {
    if (!memo) memo = fn();
    return memo;
  };
};

/**
 * Return a function which, when called, will return an AWS service object
 *
 * Note: The returned service objects are cached, so there will only be one
 *       instance of each service object per process.
 *
 * @param {Function} Service - an AWS service object constructor function
 * @param {string} version - the API version to use
 * @returns {Function} - a function which, when called, will return an AWS service object
 */
const awsClient = (Service, version = null) => {
  const options = {};
  if (version) options.apiVersion = version;

  if (process.env.TEST) {
    return memoize(() => testUtils.testAwsClient(Service, options));
  }
  return memoize(() => new Service(options));
};

exports.ecs = awsClient(AWS.ECS, '2014-11-13');
exports.s3 = awsClient(AWS.S3, '2006-03-01');
exports.lambda = awsClient(AWS.Lambda, '2015-03-31');
exports.sqs = awsClient(AWS.SQS, '2012-11-05');
exports.cloudwatchlogs = awsClient(AWS.CloudWatchLogs, '2014-03-28');
exports.dynamodb = awsClient(AWS.DynamoDB, '2012-08-10');
exports.dynamodbDocClient = awsClient(AWS.DynamoDB.DocumentClient);
exports.sfn = awsClient(AWS.StepFunctions, '2016-11-23');
exports.cf = awsClient(AWS.CloudFormation, '2010-05-15');

exports.findResourceArn = (obj, fn, prefix, baseName, opts, callback) => {
  obj[fn](opts, (err, data) => {
    if (err) {
      callback(err, data);
      return;
    }

    let arns = null;
    for (const prop of Object.keys(data)) {
      if (prop.endsWith('Arns')) {
        arns = data[prop];
      }
    }
    if (!arns) {
      callback(`Could not find an 'Arn' property in response from ${fn}`, data);
      return;
    }

    const prefixRe = new RegExp(`^${prefix}-[A-Z0-9]`);
    const baseNameOnly = `-${baseName}-`;
    let matchingArn = null;
    for (const arn of arns) {
      const name = arn.split('/').pop();
      if (name.match(prefixRe) && name.indexOf(baseNameOnly) !== -1) {
        matchingArn = arn;
      }
    }
    if (matchingArn) {
      callback(null, matchingArn);
    }
    else if (data.NextToken) {
      const nextOpts = Object.assign({}, opts, { NextToken: data.NextToken });
      exports.findResourceArn(obj, fn, prefix, baseName, nextOpts, callback);
    }
    else {
      callback(`Could not find resource ${baseName} in ${fn}`);
    }
  });
};

exports.promiseS3Upload = (params) => {
  const uploadFn = exports.s3().upload.bind(exports.s3());
  return concurrency.toPromise(uploadFn, params);
};

/**
 * Check if an object exists in S3
 *
 * @param {Object} s3Object
 * @param {string} s3Object.Bucket - the bucket containing the S3 object
 * @param {string} s3Object.Key - the key where the S3 object is located
 * @returns {Promise.<boolean>} resolves to true if the object exists, false otherwise
 */
function s3ObjectExists(s3Object) {
  return exports.s3().headObject(s3Object).promise()
    .then(() => true)
    .catch((err) => {
      if (err.code === 'NotFound') return false;
      throw err;
    });
}
exports.s3ObjectExists = s3ObjectExists;

/**
 * Delete all objects from a bucket and then delete the bucket.
 *
 * @param {string} bucket - the bucket to be deleted
 * @returns {Promise} - resolves when the bucket has been deleted
 */
async function recursivelyDeleteS3Bucket(bucket) {
  const keys = await exports.s3().listObjects({ Bucket: bucket }).promise()
    .then((response) => response.Contents.map((o) => o.Key));

  await Promise.all(keys.map((key) =>
    exports.s3().deleteObject({ Bucket: bucket, Key: key }).promise()));

  try {
    await exports.s3().deleteBucket({ Bucket: bucket }).promise();
  }
  catch (err) {
    if (err.code !== 'NoSuchBucket') throw err;
  }
}
exports.recursivelyDeleteS3Bucket = recursivelyDeleteS3Bucket;

/**
 * Downloads the given s3Obj to the given filename in a streaming manner
 * @param s3Obj The parameters to send to S3 getObject call
 * @param filename The output filename
 */
exports.downloadS3File = (s3Obj, filename) => {
  const s3 = exports.s3();
  const file = fs.createWriteStream(filename);
  return new Promise((resolve, reject) => {
    s3.getObject(s3Obj)
      .createReadStream()
      .pipe(file)
      .on('finish', () => resolve(filename))
      .on('error', reject);
  });
};

exports.downloadS3Files = (s3Objs, dir, s3opts = {}) => {
  // Scrub s3Ojbs to avoid errors from the AWS SDK
  const scrubbedS3Objs = s3Objs.map(s3Obj => ({
      Bucket: s3Obj.Bucket,
      Key: s3Obj.Key
    }));
  const s3 = exports.s3();
  let i = 0;
  const n = s3Objs.length;
  log.info(`Starting download of ${n} keys to ${dir}`);
  const promiseDownload = (s3Obj) => {
    const filename = path.join(dir, path.basename(s3Obj.Key));
    const file = fs.createWriteStream(filename);
    const opts = Object.assign(s3Obj, s3opts);
    return new Promise((resolve, reject) => {
      s3.getObject(opts)
        .createReadStream()
        .pipe(file)
        .on('finish', () => {
          log.info(`Progress: [${i++} of ${n}] s3://${s3Obj.Bucket}/${s3Obj.Key} -> ${filename}`);
          return resolve(s3Obj.Key);
        })
        .on('error', reject);
    });
  };
  const limitedDownload = concurrency.limit(S3_RATE_LIMIT, promiseDownload);
  return Promise.all(scrubbedS3Objs.map(limitedDownload));
};

/**
 * Delete files from S3
 * @param {Array} s3Objs An array of objects containing keys 'Bucket' and 'Key'
 * @param {Object} s3Opts An optional object containing options that influence the behavior of S3
 * @return A promise that resolves to an Array of the data returned from the deletion operations
 */
exports.deleteS3Files = (s3Objs, s3opts = {}) => {
  const s3 = exports.s3();
  let i = 0;
  const n = s3Objs.length;
  log.info(`Starting deletion of ${n} keys`);
  const promiseDelete = (s3Obj) => {
    const opts = Object.assign(s3Obj, s3opts);
    return new Promise((resolve, reject) => {
      s3.deleteObject(opts, (err, data) => {
        if (err) reject(err);
        log.info(`Progress: [${i++} of ${n}] s3://${s3Obj.Bucket}/${s3Obj.Key} -> ${s3Obj.key}`);
        resolve(data);
      });
    });
  };
  const limitedDelete = concurrency.limit(S3_RATE_LIMIT, promiseDelete);
  return Promise.all(s3Objs.map(limitedDelete));
};

exports.uploadS3Files = (files, defaultBucket, keyPath, s3opts = {}) => {
  let i = 0;
  const n = files.length;
  if (n > 1) {
    log.info(`Starting upload of ${n} keys`);
  }
  const promiseUpload = (filenameOrInfo) => {
    let fileInfo = filenameOrInfo;
    if (typeof fileInfo === 'string') {
      const filename = fileInfo;
      fileInfo = {
        key: (typeof keyPath === 'string') ?
                path.join(keyPath, path.basename(filename)) :
                keyPath(filename),
        filename: filename
      };
    }
    const bucket = fileInfo.bucket || defaultBucket;
    const filename = fileInfo.filename;
    const key = fileInfo.key;
    const body = fs.createReadStream(filename);
    const opts = Object.assign({ Bucket: bucket, Key: key, Body: body }, s3opts);
    return exports.promiseS3Upload(opts)
                  .then(() => {
                    log.info(`Progress: [${++i} of ${n}] ${filename} -> s3://${bucket}/${key}`);
                    return { key: key, bucket: bucket };
                  });
  };
  const limitedUpload = concurrency.limit(S3_RATE_LIMIT, promiseUpload);
  return Promise.all(files.map(limitedUpload));
};

/**
 * Upload the file associated with the given stream to an S3 bucket
 * @param {ReadableStream} fileStream The stream for the file's contents
 * @param {string} bucket The S3 bucket to which the file is to be uploaded
 * @param {string} key The key to the file in the bucket
 * @param s3opts {Object} Options to pass to the AWS sdk call (defaults to `{}`)
 * @return A promise
 */
exports.uploadS3FileStream = (fileStream, bucket, key, s3opts = {}) => {
  const opts = Object.assign({ Bucket: bucket, Key: key, Body: fileStream }, s3opts);
  return exports.promiseS3Upload(opts);
};

/**
 * List the objects in an S3 bucket
 * @param {string} bucket The name of the bucket
 * @param {string} prefix Only objects with keys starting with this prefix will be included
 * (useful for searching folders in buckets, e.g., '/PDR')
 * @param {boolean} skipFolders If true don't return objects that are folders (defaults to true)
 * @return A promise that resolves to the list of objects. Each S3 object is represented
 * as a JS object with the following attributes:
 * `Key`, `ETag`, `LastModified`, `Owner`, `Size`, `StorageClass`
 */
exports.listS3Objects = (bucket, prefix = null, skipFolders = true) => {
  log.info(`Listing objects in s3://${bucket}`);
  const params = {
    Bucket: bucket
  };
  if (prefix) params.Prefix = prefix;

  return new Promise((resolve, reject) => {
    exports.s3().listObjects(params, (err, data) => {
      if (err) reject(err);

      let contents = data.Contents || [];
      if (skipFolders) {
        // Filter out any references to folders
        contents = contents.filter((obj) => !obj.Key.endsWith('/'));
      }

      resolve(contents);
    });
  });
};

exports.syncUrl = async (url, bucket, destKey) => {
  const response = await concurrency.promiseUrl(url);
  await exports.promiseS3Upload({ Bucket: bucket, Key: destKey, Body: response });
};

exports.getQueueUrl = (sourceArn, queueName) => {
  const arnParts = sourceArn.split(':');
  return `https://sqs.${arnParts[3]}.amazonaws.com/${arnParts[4]}/${queueName}`;
};

exports.getPossiblyRemote = async (obj) => {
  if (obj && obj.Key && obj.Bucket) {
    const s3Obj = await exports.s3().getObject(obj).promise();
    return s3Obj.Body.toString();
  }
  return obj;
};

exports.getSfnExecutionByName = (stateMachineArn, executionName) =>
  [stateMachineArn.replace(':stateMachine:', ':execution:'), executionName].join(':');

exports.getCurrentSfnTask = async (stateMachineArn, executionName) => {
  const sfn = exports.sfn();
  const executionArn = exports.getSfnExecutionByName(stateMachineArn, executionName);
  const executionHistory = await sfn.getExecutionHistory({
    executionArn: executionArn,
    maxResults: 10,
    reverseOrder: true
  }).promise();
  for (const step of executionHistory.events) {
    // Avoid iterating past states that have ended
    if (step.type.endsWith('StateExited')) break;
    if (step.type === 'TaskStateEntered') return step.stateEnteredEventDetails.name;
  }
  throw new Error(`No task found for ${stateMachineArn}#${executionName}`);
};

/**
 * Given an array of fields, returns that a new string that's safe for use as a StepFunction,
 * execution name, where all fields are joined by a StepFunction-safe delimiter
 * Important: This transformation isn't entirely two-way. Names longer than 80 characters
 *            will be truncated.
 *
 * @param{string} fields - The fields to be injected into an execution name
 * @param{string} delimiter - An optional delimiter string to replace, pass null to make
 *   no replacements
 * @return - A string that's safe to use as a StepFunctions execution name
 */
exports.toSfnExecutionName = (fields, delimiter = '__') => {
  let sfnUnsafeChars = '[^\\w-=+_.]';
  if (delimiter) {
    sfnUnsafeChars = `(${delimiter}|${sfnUnsafeChars})`;
  }
  const regex = new RegExp(sfnUnsafeChars, 'g');
  return fields.map((s) => s.replace(regex, string.unicodeEscape).replace(/\\/g, '!'))
               .join(delimiter)
               .substring(0, 80);
};

/**
 * Opposite of toSfnExecutionName. Given a delimited StepFunction execution name, returns
 * an array of its original fields
 * Important: This value may be truncated from the original because of the 80-char limit on
 *            execution names
 *
 * @param{string} str - The string to make stepfunction safe
 * @param{string} delimiter - An optional delimiter string to replace, pass null to make
 *   no replacements
 * @param{string} sfnDelimiter - The string to replace delimiter with
 * @return - An array of the original fields
 */
exports.fromSfnExecutionName = (str, delimiter = '__') =>
  str.split(delimiter)
     .map((s) => s.replace(/!/g, '\\').replace('"', '\\"'))
     .map((s) => JSON.parse(`"${s}"`));

// Test code
// const prom = exports.listS3Objects('gitc-jn-sips-mock', 'PDR/');
// prom.then((list) => {
//   log.info(list);
// });
