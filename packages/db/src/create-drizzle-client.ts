import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { DrizzleClientHandle, PostgresConnectionString } from './db-contract.js'

/**
 * Builds a lazy typed Drizzle client over a node-postgres pool. Nothing connects here, so an
 * unreachable server surfaces as a thrown driver error on the first query. Always call
 * closeDatabaseClient when finished or the pool keeps the process alive.
 */
export function createDrizzleClient<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(options: {
  databaseUrl: PostgresConnectionString
  schema?: TSchema
}): DrizzleClientHandle<TSchema> {
  const pool = new Pool({ connectionString: options.databaseUrl })

  // The pool is not handed to the caller, so nobody else can listen for the error an idle backend
  // raises when the server closes it. Absorbing it here keeps that from killing the host process;
  // the next query opens a fresh connection and reports its own error.
  pool.on('error', () => undefined)

  const drizzleClient =
    options.schema === undefined
      ? drizzle<TSchema>({ client: pool })
      : drizzle<TSchema>({ client: pool, schema: options.schema })

  return {
    drizzleClient,
    closeDatabaseClient: async () => {
      await pool.end()
    },
  }
}
