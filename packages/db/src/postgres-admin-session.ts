import { Client } from 'pg'
import type { PostgresConnectionString } from './db-contract.ts'

/** How long to wait for the admin connection before treating the server as unreachable. */
const adminConnectionTimeoutMilliseconds = 10_000

/**
 * Opens one admin connection, runs the callback on it, and always closes it so a CLI process can
 * exit. Connection errors propagate for the caller to classify into a returned failure.
 */
export async function withPostgresAdminSession<TResult>(
  adminDatabaseUrl: PostgresConnectionString,
  runOnAdminSession: (adminClient: Client) => Promise<TResult>,
): Promise<TResult> {
  const adminClient = new Client({
    connectionString: adminDatabaseUrl,
    connectionTimeoutMillis: adminConnectionTimeoutMilliseconds,
  })
  await adminClient.connect()
  try {
    return await runOnAdminSession(adminClient)
  } finally {
    await adminClient.end()
  }
}

/** Runs one statement and swallows any error, for the best-effort cleanup after a half-finished create. */
export async function runAdminStatementIgnoringErrors(
  adminClient: Client,
  statement: string,
): Promise<void> {
  try {
    await adminClient.query(statement)
  } catch {
    // Cleanup is best effort: the failure the caller is about to return is the one that matters.
  }
}
