'use strict';

const test = require('ava');
const { recursivelyDeleteS3Bucket, s3 } = require('@cumulus/common/aws');
const { publishSnsMessage } = require('../index');
const { cloneDeep } = require('lodash');
const { randomString } = require('@cumulus/common/test-utils');

test('send report when sfn is running', (t) => {
  const event = {
    input: {
      meta: { topic_arn: 'test_topic_arn' },
      anykey: 'anyvalue'
    }
  };

  return publishSnsMessage(cloneDeep(event))
    .then((output) => {
      event.input.meta.status = 'running';
      t.deepEqual(output, event.input);
    });
});

test('send report when sfn is running with exception', (t) => {
  const event = {
    input: {
      meta: { topic_arn: 'test_topic_arn' },
      exception: {
        Error: 'TheError',
        Cause: 'bucket not found'
      },
      anykey: 'anyvalue'
    }
  };

  return publishSnsMessage(cloneDeep(event))
    .catch((e) => {
      t.is(e.message, event.input.exception.Cause);
    });
});

test('send report when sfn is running with error', (t) => {
  const event = {
    input: {
      meta: { topic_arn: 'test_topic_arn' },
      error: {
        Error: 'TypeError',
        Cause: 'bucket not found'
      },
      anykey: 'anyvalue'
    }
  };

  return publishSnsMessage(cloneDeep(event))
    .catch((e) => {
      t.is(e.message, event.input.error.Cause);
    });
});


test('send report when sfn is finished and granule has succeeded', async (t) => {
  const input = {
    meta: {
      topic_arn: 'test_topic_arn',
      granuleId: randomString()
    },
    anykey: 'anyvalue'
  };
  const event = {};
  event.input = input;
  event.config = {};
  event.config.sfnEnd = true;
  event.config.stack = 'test_stack';
  event.config.bucket = randomString();
  event.config.stateMachine =
    'arn:aws:states:us-east-1:596205514787:stateMachine:TestCumulusParsePdrStateMach-K5Qk90fc8w4U';
  event.config.executionName = '7c543392-1da9-47f0-9c34-f43f6519412a';

  await s3().createBucket({ Bucket: event.config.bucket }).promise();
  return publishSnsMessage(cloneDeep(event))
    .then((output) => {
      event.input.meta.status = 'completed';
      t.deepEqual(output, event.input);
    })
    .then(() => recursivelyDeleteS3Bucket(event.config.bucket))
    .catch(() => recursivelyDeleteS3Bucket(event.config.bucket).then(t.fail));
});
