'use strict';
const _ = require('lodash');
const { Kinesis, StepFunctions } = require('aws-sdk');

const {
  LambdaStep,
  getWorkflowArn,
  timeout,
  waitForCompletedExecution,
} = require('@cumulus/integration-tests');

const { loadConfig } = require('../helpers/testUtils');

const config = loadConfig();

const lambdaStep = new LambdaStep();
const sfn = new StepFunctions({ region: config.awsRegion });
const kinesis = new Kinesis({ apiVersion: '2013-12-02', region: config.awsRegion });

const waitPeriodMs = 1000;

async function getLastExecution() {
  const kinesisTriggerTestStpFnArn = await getWorkflowArn(config.stackName, config.bucketName, 'KinesisTriggerTest');
  return new Promise((resolve, reject) => {
    sfn.listExecutions({ stateMachineArn: kinesisTriggerTestStpFnArn }, (err, data) => {
      if (err) {
        reject(err);
      }
      else {
        resolve(_.orderBy(data.executions, 'startDate', 'desc')[0]);
      }
    });
  });
}


async function waitForActiveStream(streamName, maxNumberElapsedPeriods = 30) {
  let streamStatus = 'Anything';
  let elapsedPeriods = 0;
  let stream;

  /* eslint-disable no-await-in-loop */
  while (streamStatus !== 'ACTIVE' && elapsedPeriods < maxNumberElapsedPeriods) {
    await timeout(waitPeriodMs);
    stream = await kinesis.describeStream({ StreamName: streamName }).promise();
    streamStatus = stream.StreamDescription.StreamStatus;
    elapsedPeriods += 1;
  }
  /* eslint-enable no-await-in-loop */

  if (streamStatus === 'ACTIVE') return streamStatus;
  throw new Error(streamStatus);
}


async function createNewTestStream(streamName) {
  return new Promise((resolve, reject) => {
    kinesis.describeStream({ StreamName: streamName }, (err, data) => {
      if (err && err.code === 'ResourceNotFoundException') {
        console.log('create the stream', streamName);
        kinesis.createStream({ StreamName: streamName, ShardCount: 1 }, (createErr, createData) => {
          if (createErr) reject(createErr);
          return resolve(createData);
        });
      }
      else if (err) {
        reject(err);
      }
      else {
        resolve(data);
      }
    });
  });
}


async function putRecordOnStream(streamName, record) {
  return new Promise((resolve, reject) => {
    kinesis.putRecord({
      Data: JSON.stringify(record),
      PartitionKey: '1',
      StreamName: streamName
    }, (err, data) => {
      if (err) reject(err);
      resolve(data);
    });
  });
}


// Wait until a we discover an execution has started which matches our record identifier.
// That will identify the execution we want to test.
async function waitForTestSfStarted(recordIdentifier, maxWaitTime) {

  let timeWaited = 0;
  let lastExecution;
  let workflowExecution;

  while (timeWaited < maxWaitTime && workflowExecution === undefined) {
    try {
      await timeout(waitPeriodMs);
      timeWaited += waitPeriodMs;
      try {
        lastExecution = await getLastExecution();
      }
      catch (error) {
        console.log(error);
        throw error;
      }
      // getLastExecution returns undefined if no previous execution exists
      if (lastExecution && lastExecution.executionArn) {
        try {
          const taskOutput = await lambdaStep.getStepOutput(lastExecution.executionArn, 'sf2snsStart');
          if (taskOutput.payload.identifier === recordIdentifier) {
            workflowExecution = lastExecution;
          }
        }
        catch (error) {
          console.log(error);
          throw error;
        }
      }
    }
    catch (error) {
      console.log(error);
      throw error;
    }
  }
  if (timeWaited < maxWaitTime) return workflowExecution;
  throw new Error('Workflow Never Started.');
}


module.exports = {
  createNewTestStream,
  putRecordOnStream,
  waitForActiveStream,
  waitForTestSfStarted
};
