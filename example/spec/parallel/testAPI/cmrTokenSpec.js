'use strict';

const { CMR } = require('@cumulus/cmr-client');
const { loadConfig } = require('../../helpers/testUtils');
const { EarthdataLogin } = require('../../../../packages/cmr-client/EarthdataLogin');
const { setDistributionApiEnvVars } = require('../../helpers/apiUtils');

describe('When using Earthdata Login Token from CMR', () => {
  let username;
  let password;
  let config;
  let earthdataLoginObject;
  let cmrObject;
  let beforeAllFailed = false;

  beforeAll(async () => {
    try {
      config = await loadConfig();
      process.env.stackName = config.stackName;
      setDistributionApiEnvVars();

      process.env.CMR_ENVIRONMENT = 'UAT';
      process.env.AWS_REGION = 'us-east-1';
      username = process.env.EARTHDATA_USERNAME;
      password = process.env.EARTHDATA_PASSWORD;

      cmrObject = new CMR({
        provider: 'provider',
        username: username,
        password: password,
      });

      earthdataLoginObject = new EarthdataLogin({
        username: username,
        password: password,
        edlEnv: process.env.CMR_ENVIRONMENT,
      });
    } catch (error) {
      beforeAllFailed = true;
      console.log(error);
    }
  });

  afterAll(async () => {
    await earthdataLoginObject.revokeEDLToken(earthdataLoginObject.getEDLToken());
  });

  describe('Request for getting an Earthdata Login Token for the user using Earthdata credentials', () => {
    it('gets an Earthdata login token, or creates one for the user if they are missing it', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const response = await earthdataLoginObject.getEDLToken();
        expect(response).toBeDefined();
        expect(response).toBeInstanceOf(String);
      }
    });
  });

  describe('Request for getting the EDL token through the CMR object', () => {
    it('gets an Earthdata login token the same way as the EarthdataLogin object', async () => {
      if (beforeAllFailed) {
        fail('beforeAll() failed');
      } else {
        const response = await cmrObject.getToken();
        expect(response).toBeDefined();
        expect(response).toBeInstanceOf(String);
      }
    });
  });
});
