import AWS from 'aws-sdk';
import Knex from 'knex';

export const getRequiredEnvVar = (name: string, env: NodeJS.ProcessEnv): string => {
  const value = env[name];
  if (value) return value;
  throw new Error(`The ${name} environment variable must be set`);
};

const localStackConnectionConfig: Knex.PgConnectionConfig = {
  host: 'localhost',
  user: 'postgres',
  password: 'password',
  database: 'postgres',
};

export const getSecretConnectionConfig = async (
  SecretId: string,
  secretsManager: AWS.SecretsManager
): Promise<Knex.PgConnectionConfig> => {
  const response = await secretsManager.getSecretValue(
    { SecretId } as AWS.SecretsManager.GetSecretValueRequest
  ).promise();
  if (response.SecretString === undefined) {
    throw new Error(`AWS Secret did not contain a stored value: ${SecretId}`);
  }
  const dbAccessMeta = JSON.parse(response.SecretString);

  ['host', 'username', 'password', 'database'].forEach((key) => {
    if (!(key in dbAccessMeta)) {
      throw new Error(`AWS Secret ${SecretId} is missing required key '${key}'`);
    }
  });
  return {
    host: dbAccessMeta.host,
    user: dbAccessMeta.username,
    password: dbAccessMeta.password,
    database: dbAccessMeta.database,
  };
};

export const getConnectionConfigEnv = (
  env: NodeJS.ProcessEnv
): Knex.PgConnectionConfig => ({
  host: getRequiredEnvVar('PG_HOST', env),
  user: getRequiredEnvVar('PG_USER', env),
  password: getRequiredEnvVar('PG_PASSWORD', env),
  database: getRequiredEnvVar('PG_DATABASE', env),
});

export const getConnectionConfig = async ({
  env,
  secretsManager = new AWS.SecretsManager(),
}: {
  env: NodeJS.ProcessEnv,
  secretsManager?: AWS.SecretsManager
}): Promise<Knex.PgConnectionConfig> => {
  // Using LocalStack
  if (env.NODE_ENV === 'test') {
    return localStackConnectionConfig;
  }

  // Storing credentials in Secrets Manager
  if (env.databaseCredentialSecretArn) {
    return getSecretConnectionConfig(
      env.databaseCredentialSecretArn,
      secretsManager
    );
  }

  // Getting credentials from environment variables
  return getConnectionConfigEnv(env);
};
