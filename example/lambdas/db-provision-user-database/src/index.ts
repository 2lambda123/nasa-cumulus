import AWS from 'aws-sdk';
import Knex from 'knex';

import { config, connection } from '@cumulus/db';

export interface HandlerEvent {
  rootLoginSecret: string,
  userLoginSecret: string,
  prefix: string,
  dbPassword: string,
  engine: string,
  dbClusterIdentifier: string,
  env?: NodeJS.ProcessEnv,
}

export const dbExists = async (tableName: string, knex: Knex) =>
  knex('pg_database').select('datname').where(knex.raw(`datname = CAST('${tableName}' as name)`));

export const userExists = async (userName: string, knex: Knex) =>
  knex('pg_catalog.pg_user').where(knex.raw(`usename = CAST('${userName}' as name)`));

const validateEvent = (event: HandlerEvent): void => {
  if (event.dbPassword === undefined || event.prefix === undefined) {
    throw new Error(`This lambda requires 'dbPassword' and 'prefix' to be defined on the event: ${event}`);
  }
};

export const handler = async (event: HandlerEvent): Promise<void> => {
  validateEvent(event);
  let knex;
  try {
    const env = {
      databaseCredentialSecretArn: event.rootLoginSecret,
    };
    const connectionConfig = await config.getConnectionConfig({ env });
    const knexConfig = await connection.getKnexConfig(env, connectionConfig);
    knex = Knex(knexConfig);

    const dbUser = event.prefix.replace(/-/g, '_');
    [dbUser, event.dbPassword].forEach((input) => {
      if (!(/^\w+$/.test(input))) {
        throw new Error(`Attempted to create database user ${dbUser} - username/password must be [a-zA-Z0-9_] only`);
      }
    });

    const userExistsResults = await userExists(dbUser, knex);
    const dbExistsResults = await dbExists(`${dbUser}_db`, knex);

    if (userExistsResults.length === 0) {
      await knex.raw(`create user "${dbUser}" with encrypted password '${event.dbPassword}'`);
    } else {
      await knex.raw(`alter user "${dbUser}" with encrypted password '${event.dbPassword}'`);
    }

    if (dbExistsResults.length !== 0) {
      await knex.raw(`alter database "${dbUser}_db" connection limit 0;`);
      await knex.raw(`select pg_terminate_backend(pg_stat_activity.pid) from pg_stat_activity where pg_stat_activity.datname = '${dbUser}_db'`);
      await knex.raw(`drop database "${dbUser}_db";`);
    }
    await knex.raw(`create database "${dbUser}_db";`);
    await knex.raw(`grant all privileges on database "${dbUser}_db" to "${dbUser}"`);

    const secretsManager = new AWS.SecretsManager();
    await secretsManager.putSecretValue({
      SecretId: event.userLoginSecret,
      SecretString: JSON.stringify({
        username: dbUser,
        password: event.dbPassword,
        engine: 'postgres',
        database: `${dbUser}_db`,
        host: connectionConfig.host,
        port: 5432,
      }),
    }).promise();
  } finally {
    if (knex) {
      await knex.destroy();
    }
  }
};
