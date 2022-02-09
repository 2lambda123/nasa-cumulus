const test = require('ava');

const { secretsManager } = require('@cumulus/aws-client/services');
const { randomString } = require('@cumulus/common/test-utils');

test.beforeEach(() => {
  process.env.dynamoTableNamesParameterName = 'fake-param-name';
});

test('handler sets environment variables based on configured secretsManager secret', async (t) => {
  process.env.INIT_ENV_VARS_FUNCTION_TEST = 'true';
  const secretId = randomString(10);
  await secretsManager().createSecret({
    Name: secretId,
    SecretString: JSON.stringify({
      randomTestVal: 'randomTestVal',
    }),
  }).promise();
  process.env.api_config_secret_id = secretId;

  const dynamoTableNames = {
    DynamoTableName: 'prefix-dynamoTableName',
  };
  const ssmClient = {
    getParameter: () => ({
      promise: () => Promise.resolve({
        Parameter: {
          Value: JSON.stringify(dynamoTableNames),
        },
      }),
    }),
  };
  // eslint-disable-next-line global-require
  const { handler } = require('../../app');
  await handler(
    {},
    {
      ssmClient,
    }
  );
  t.is(process.env.randomTestVal, 'randomTestVal');
});
