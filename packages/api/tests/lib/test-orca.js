'use strict';

const test = require('ava');
const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { randomId } = require('@cumulus/common/test-utils');
const { fakeGranuleFactoryV2 } = require('../../lib/testUtils');

const sandbox = sinon.createSandbox();
const fakeListRequests = sandbox.stub();

const orca = proxyquire('../../lib/orca', {
  '@cumulus/api-client/orca': { listRequests: fakeListRequests },
});

const recoveryRequestFactory = (options) => (
  {
    granule_id: options.granuleId || randomId('granuleId'),
    files: options.files
    || [
      {
        file_name: randomId('file_name'),
        status: options.status || 'inprogress',
      },
    ],
  });

test.afterEach.always(() => {
  sandbox.reset();
});

test.after.always(() => {
  sandbox.restore();
});

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns undefined status when orca endpoint returns error',
  async (t) => {
    const granuleId = randomId('granId');
    fakeListRequests.resolves({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Function not found: prefix_request_status, please check if orca is deployed',
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, undefined);
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns undefined status when recovery request for granule is not found',
  async (t) => {
    const granuleId = randomId('granId');
    const recoveryRequests = [];
    fakeListRequests.resolves({
      statusCode: 200,
      body: JSON.stringify(recoveryRequests),
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, undefined);
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns running status when files are still in progress',
  async (t) => {
    const granuleId = randomId('granId');
    const files = [
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
      {
        file_name: randomId('file_name'),
        status: 'pending',
      },
      {
        file_name: randomId('file_name'),
        status: 'failed',
      },
    ];
    const recoveryRequests = recoveryRequestFactory({ granuleId, files });
    fakeListRequests.resolves({
      statusCode: 200,
      body: JSON.stringify(recoveryRequests),
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, 'running');
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns completed status when files are success',
  async (t) => {
    const granuleId = randomId('granId');
    const files = [
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
    ];
    const recoveryRequests = recoveryRequestFactory({ granuleId, files });
    fakeListRequests.resolves({
      statusCode: 200,
      body: JSON.stringify(recoveryRequests),
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, 'completed');
  }
);

test.serial(
  'getOrcaRecoveryStatusByGranuleId returns failed status when file restore has error',
  async (t) => {
    const granuleId = randomId('granId');
    const files = [
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
      {
        file_name: randomId('file_name'),
        status: 'failed',
      },
    ];
    const recoveryRequests = recoveryRequestFactory({ granuleId, files });
    fakeListRequests.resolves({
      statusCode: 200,
      body: JSON.stringify(recoveryRequests),
    });
    const status = await orca.getOrcaRecoveryStatusByGranuleId(granuleId);
    t.is(status, 'failed');
  }
);

test.serial(
  'addOrcaRecoveryStatus adds recovery status to granules',
  async (t) => {
    const granuleIds = [randomId('granId'), randomId('granId')];
    const inputResponse = {
      results: [
        fakeGranuleFactoryV2({ granuleId: granuleIds[0] }),
        fakeGranuleFactoryV2({ granuleId: granuleIds[1] })],
    };
    const filesForGranule1 = [
      {
        file_name: randomId('file_name'),
        status: 'pending',
      },
      {
        file_name: randomId('file_name'),
        status: 'staged',
      },
    ];
    const filesForGranule2 = [
      {
        file_name: randomId('file_name'),
        status: 'success',
      },
      {
        file_name: randomId('file_name'),
        status: 'failed',
      },
    ];
    const recoveryRequestsGranule1 = recoveryRequestFactory({
      granuleId: granuleIds[0], files: filesForGranule1,
    });

    const recoveryRequestsGranule2 = recoveryRequestFactory({
      granuleId: granuleIds[1], files: filesForGranule2,
    });

    fakeListRequests.onCall(0)
      .returns({ statusCode: 200, body: JSON.stringify(recoveryRequestsGranule1) });
    fakeListRequests.onCall(1)
      .returns({ statusCode: 200, body: JSON.stringify(recoveryRequestsGranule2) });

    const updatedResponse = await orca.addOrcaRecoveryStatus(inputResponse);
    const granules = updatedResponse.results;
    t.is(granules.length, 2);
    t.is(granules[0].recoveryStatus, 'running');
    t.is(granules[1].recoveryStatus, 'failed');
  }
);
