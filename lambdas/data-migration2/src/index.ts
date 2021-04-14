import { getKnexClient } from '@cumulus/db';
import { MigrationSummary } from '@cumulus/types/migration';
import Logger from '@cumulus/logger';

import { migrateExecutions } from './executions';
import { migrateGranulesAndFiles } from './granulesAndFiles';
import { migratePdrs } from './pdrs';

const logger = new Logger({ sender: '@cumulus/data-migration2' });
export interface HandlerEvent {
  env?: NodeJS.ProcessEnv
}

export const handler = async (event: HandlerEvent): Promise<MigrationSummary> => {
  const env = event.env ?? process.env;
  const knex = await getKnexClient({ env });

  try {
    const executionsMigrationSummary = await migrateExecutions(env, knex);
    const granulesAndFilesMigrationSummary = await migrateGranulesAndFiles(env, knex);
    const pdrsMigrationSummary = await migratePdrs(env, knex);

    const summary: MigrationSummary = {
      MigrationSummary: {
        executions: {
          total_dynamo_db_records: executionsMigrationSummary.dynamoRecords,
          migrated: executionsMigrationSummary.success,
          skipped: executionsMigrationSummary.skipped,
          failed: executionsMigrationSummary.failed,
        },
        granules: {
          total_dynamo_db_records: granulesAndFilesMigrationSummary.granulesSummary.dynamoRecords,
          migrated: granulesAndFilesMigrationSummary.granulesSummary.success,
          skipped: granulesAndFilesMigrationSummary.granulesSummary.skipped,
          failed: granulesAndFilesMigrationSummary.granulesSummary.failed,
        },
        files: {
          total_dynamo_db_records: granulesAndFilesMigrationSummary.granulesSummary.dynamoRecords,
          migrated: granulesAndFilesMigrationSummary.filesSummary.success,
          skipped: granulesAndFilesMigrationSummary.filesSummary.skipped,
          failed: granulesAndFilesMigrationSummary.filesSummary.failed,
        },
        pdrs: {
          total_dynamo_db_records: pdrsMigrationSummary.dynamoRecords,
          migrated: pdrsMigrationSummary.success,
          skipped: pdrsMigrationSummary.skipped,
          failed: pdrsMigrationSummary.failed,
        },
      },
    };
    logger.info(JSON.stringify(summary));
    return summary;
  } finally {
    await knex.destroy();
  }
};
