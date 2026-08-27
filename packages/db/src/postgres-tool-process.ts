import { execFile } from 'node:child_process'
import { readPostgresErrorCode } from './postgres-error-classification.js'

/** The two Postgres client binaries this package shells out to; both are resolved from PATH at call time. */
export type PostgresToolName = 'pg_dump' | 'pg_restore'

/** Room for the diagnostic chatter pg_restore produces on a large archive; the archive itself goes to a file, not to a pipe. */
const postgresToolOutputBufferBytes = 32 * 1024 * 1024

/** What happened when a Postgres client binary was spawned; the missing case is separate because it is a named failure mode. */
export type PostgresToolOutcome =
  | { kind: 'postgres-tool-succeeded'; standardError: string }
  | { kind: 'postgres-tool-not-on-path' }
  | { kind: 'postgres-tool-failed'; standardError: string }

/**
 * Spawns a Postgres client binary by bare name so PATH is consulted on this call, not at import
 * time, and reports a missing binary as an outcome rather than an exception.
 */
export async function runPostgresToolCommand(
  toolName: PostgresToolName,
  commandArguments: readonly string[],
): Promise<PostgresToolOutcome> {
  return new Promise<PostgresToolOutcome>((resolve) => {
    execFile(
      toolName,
      [...commandArguments],
      { maxBuffer: postgresToolOutputBufferBytes },
      (error, _standardOutput, standardError) => {
        if (error === null) {
          resolve({ kind: 'postgres-tool-succeeded', standardError })
          return
        }
        if (readPostgresErrorCode(error) === 'ENOENT') {
          resolve({ kind: 'postgres-tool-not-on-path' })
          return
        }
        resolve({
          kind: 'postgres-tool-failed',
          standardError: standardError.trim() === '' ? error.message : standardError,
        })
      },
    )
  })
}
