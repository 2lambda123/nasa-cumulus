const test = require('ava');
const sinon = require('sinon');

const {
  getExecutionProcessingTimeInfo,
  getGranuleProductVolume,
  getGranuleTimeToArchive,
  getGranuleTimeToPreprocess,
  moveGranuleFilesAndUpdateDatastore,
} = require('../../lib/granules');

test('getExecutionProcessingTimeInfo() returns empty object if startDate is not provided', (t) => {
  t.deepEqual(
    getExecutionProcessingTimeInfo({}),
    {}
  );
});

test('getExecutionProcessingTimeInfo() returns correct object if stopDate is provided', (t) => {
  const startDate = new Date();
  const stopDate = new Date();
  t.deepEqual(
    getExecutionProcessingTimeInfo({
      startDate,
      stopDate,
    }),
    {
      processingStartDateTime: startDate.toISOString(),
      processingEndDateTime: stopDate.toISOString(),
    }
  );
});

test('getExecutionProcessingTimeInfo() returns correct object if stopDate is not provided', (t) => {
  const startDate = new Date();
  const now = new Date();
  t.deepEqual(
    getExecutionProcessingTimeInfo({
      startDate,
      now,
    }),
    {
      processingStartDateTime: startDate.toISOString(),
      processingEndDateTime: now.toISOString(),
    }
  );
});

test('getGranuleTimeToArchive() returns 0 if post_to_cmr_duration is missing from granule', (t) => {
  t.is(getGranuleTimeToArchive(), 0);
});

test('getGranuleTimeToArchive() returns correct duration', (t) => {
  const postToCmrDuration = 5000;
  t.is(
    getGranuleTimeToArchive({
      post_to_cmr_duration: postToCmrDuration,
    }),
    5
  );
});

test('getGranuleTimeToPreprocess() returns 0 if sync_granule_duration is missing from granule', (t) => {
  t.is(getGranuleTimeToPreprocess(), 0);
});

test('getGranuleTimeToPreprocess() returns correct duration', (t) => {
  const syncGranuleDuration = 3000;
  t.is(
    getGranuleTimeToPreprocess({
      sync_granule_duration: syncGranuleDuration,
    }),
    3
  );
});

test('getGranuleProductVolume() returns correct product volume', (t) => {
  t.is(
    getGranuleProductVolume([{
      size: 1,
    }, {
      size: 2,
    }]),
    3
  );

  t.is(
    getGranuleProductVolume([{
      foo: '1',
    }, {
      size: 'not-a-number',
    }]),
    0
  );
});

test('moveGranuleFilesAndUpdateDatastore throws if granulePgModel.getRecordCumulusId throws unexpected error', async (t) => {
  const updateStub = sinon.stub().returns(Promise.resolve());
  const granulesModel = {
    update: updateStub,
  };

  const granulePgModel = {
    getRecordCumulusId: () => {
      const thrownError = new Error('Test error');
      thrownError.name = 'TestError';
      return Promise.reject(thrownError);
    },
  };

  const collectionPgModel = {
    getRecordCumulusId: () => Promise.resolve(1),
  };

  const apiGranule = { granuleId: 'fakeGranule', collectionId: 'fakeCollection___001' };
  await t.throwsAsync(moveGranuleFilesAndUpdateDatastore({
    apiGranule,
    granulesModel,
    destinations: undefined,
    granulePgModel,
    collectionPgModel,
    dbClient: {},
  }));
});
