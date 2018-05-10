'use strict';

const sinon = require('sinon');
const test = require('ava');
const publicIp = require('public-ip');

const { getIp } = require('../utils');

let stub;

test.afterEach(t => {
  stub.restore();
});

test('getIp returns public IP when available', async (t) => {
  const fakeIp = '123.456.78.9';
  stub = sinon.stub(publicIp, 'v4').resolves(fakeIp);
  t.is(await getIp(), fakeIp);
});

test('getIp returns fallback IP when no public IP is available', async (t) => {
  const fallbackIp = '10.0.0.0';
  stub = sinon.stub(publicIp, 'v4').rejects(new Error('Query timed out'));
  t.is(await getIp(), fallbackIp);
});

test('getIp throws an error when the error is unexpected', async (t) => {
  const errorMessage = 'Server is experiencing an identity crisis';
  stub = sinon.stub(publicIp, 'v4').rejects(new Error(errorMessage));
  await getIp().catch((e) => {
    t.is(e.message, errorMessage);
  });
});
