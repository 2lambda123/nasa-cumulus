/**
 * PostgresProvider
 *
 * This interface describes a Provider object in postgres compatible format that
 * is ready for write to Cumulus's postgres database instance
 */

export interface PostgresProvider {
  certificate_uri?: string | null,
  cm_key_id?: string | null,
  created_at?: Date | null,
  cumulus_id?: number | null,
  global_connection_limit?: number | null,
  host: string,
  name: string,
  password?: string,
  port?: number| null,
  private_key?: string | null,
  protocol: string,
  updated_at?: Date | null,
  username?: string | null,
  allowed_redirects?: string[]
}

/**
 * PostgresProviderRecord
 *
 * This interface describes a Provider Record that has been retrieved from
 * postgres for reading.  It differs from the PostgresProvider interface in that it types
 * the autogenerated/required fields in the Postgres database as required
 */
export interface PostgresProviderRecord extends PostgresProvider {
  cumulus_id: number,
  created_at: Date,
  updated_at: Date
}
