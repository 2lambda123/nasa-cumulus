import { Knex } from 'knex';

export const up = async (knex: Knex): Promise<void> => {
  // **Note** - this migration was removed due to production deployment timeouts.
  // A new ticket was added (CUMULUS-2962) to implement this instead.  To ensure all deployed
  // stacks reach the same migration state, this migration was updated to *not* add the index and
  // the next migration in sequence was added to drop the index *if it exists*.
  await knex.schema.table('files', (table) => {
    table.index('granule_cumulus_id');
  });
  return Promise.resolve();
};

export const down = async (knex: Knex): Promise<void> => {
  await knex.raw('DROP INDEX IF EXISTS files_granule_cumulus_id_index');
};
