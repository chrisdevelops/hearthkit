import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { projectDatabaseNameSchema, type ProjectDatabaseName } from '@hearthkit/db'

const execFileAsync = promisify(execFile)

/**
 * Admin connection to the Postgres 17 service in the repo-root docker-compose.yml, which is also the
 * CLI's defaultLocalAdminDatabaseUrl; override the URL when the service is not on the default port.
 */
export const gateAdminDatabaseUrl =
  process.env.HEARTHKIT_GATE_ADMIN_DATABASE_URL ??
  'postgresql://hearthkit:hearthkit@localhost:5432/hearthkit'

/** A closed localhost port, so a reachability check fails immediately without stopping the compose service. */
export const unreachableAdminDatabaseUrl = 'postgresql://hearthkit:hearthkit@127.0.0.1:59999/hearthkit'

/** Database name unique to this process and call, so parallel gate files and repeated runs never collide. */
export function uniqueGateDatabaseName(purpose: string): ProjectDatabaseName {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
  return projectDatabaseNameSchema.parse(`gate_cli_${purpose}_${process.pid}_${suffix}`)
}

/** Same server and credentials, different database; the connection a gate uses to seed or read a project database. */
export function connectionStringForDatabase(
  connectionString: string,
  databaseName: string,
): string {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return url.toString()
}

/** What the host psql client reported; gates use it both for successful reads and for refused connections. */
export type PsqlOutcome = {
  exitCode: number
  standardOutput: string
  standardError: string
}

/**
 * Runs one statement through the host psql 17 client. Gates talk to Postgres this way so the CLI
 * package needs no database driver of its own, and so every check is against the real server.
 */
export async function runPsqlStatement(
  connectionString: string,
  statement: string,
): Promise<PsqlOutcome> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'psql',
      [
        '--no-psqlrc',
        '--quiet',
        '--tuples-only',
        '--no-align',
        '--variable',
        'ON_ERROR_STOP=1',
        '--dbname',
        connectionString,
        '--command',
        statement,
      ],
      { env: { ...process.env, PGCONNECT_TIMEOUT: '10' } },
    )
    return { exitCode: 0, standardOutput: stdout, standardError: stderr }
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string }
    return {
      exitCode: failure.code ?? 1,
      standardOutput: failure.stdout ?? '',
      standardError: failure.stderr ?? String(error),
    }
  }
}

/** Rows of a read as newline-separated psql lines, failing the gate when the statement did not run. */
export async function queryRowsAs(connectionString: string, statement: string): Promise<string[]> {
  const outcome = await runPsqlStatement(connectionString, statement)
  if (outcome.exitCode !== 0) {
    throw new Error(`gate could not run ${statement}: ${outcome.standardError}`)
  }
  return outcome.standardOutput.split('\n').filter((line) => line.trim().length > 0)
}

/** True when the server has a database with this name, read through the admin connection. */
export async function gateDatabaseExists(databaseName: string): Promise<boolean> {
  const rows = await queryRowsAs(
    gateAdminDatabaseUrl,
    `select 1 from pg_database where datname = '${databaseName}'`,
  )
  return rows.length === 1
}

/** Creates a plain throwaway database owned by the admin role, for gates that must not depend on hearthkit db create. */
export async function createAdminOwnedGateDatabase(databaseName: string): Promise<string> {
  const outcome = await runPsqlStatement(gateAdminDatabaseUrl, `CREATE DATABASE "${databaseName}"`)
  if (outcome.exitCode !== 0) {
    throw new Error(`gate could not create ${databaseName}: ${outcome.standardError}`)
  }
  return connectionStringForDatabase(gateAdminDatabaseUrl, databaseName)
}

/** Removes a gate database and its same-named role if they are still there; safe to call when neither exists. */
export async function removeGateDatabase(databaseName: string): Promise<void> {
  await runPsqlStatement(gateAdminDatabaseUrl, `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await runPsqlStatement(gateAdminDatabaseUrl, `DROP ROLE IF EXISTS "${databaseName}"`)
}
