import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import {
  postgresConnectionStringSchema,
  projectDatabaseNameSchema,
  type PostgresConnectionString,
  type ProjectDatabaseName,
} from '../src/db-contract.ts'

/**
 * Admin connection to the Postgres 17 service in the repo-root docker-compose.yml. Gates need a
 * role with CREATEDB and CREATEROLE; override the URL when the service is not on the default port.
 */
export const gateAdminDatabaseUrl: PostgresConnectionString = postgresConnectionStringSchema.parse(
  process.env.HEARTHKIT_GATE_ADMIN_DATABASE_URL ??
    'postgresql://hearthkit:hearthkit@localhost:5432/hearthkit',
)

/** A closed localhost port, so reaching it fails immediately without stopping the compose service. */
export const unreachableDatabaseUrl: PostgresConnectionString =
  postgresConnectionStringSchema.parse('postgresql://hearthkit:hearthkit@127.0.0.1:59999/hearthkit')

/** Database name unique to this process and call, so parallel gate files and repeated runs never collide. */
export function uniqueGateDatabaseName(purpose: string): ProjectDatabaseName {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
  return projectDatabaseNameSchema.parse(`gate_${purpose}_${process.pid}_${suffix}`)
}

/** Same server and credentials, different database; used to prove one project's role cannot reach another's database. */
export function connectionStringForDatabase(
  connectionString: string,
  databaseName: string,
): PostgresConnectionString {
  const url = new URL(connectionString)
  url.pathname = `/${databaseName}`
  return postgresConnectionStringSchema.parse(url.toString())
}

/** Opens a client, runs the callback, and always closes the connection so vitest can exit. */
export async function withPostgresClient<TResult>(
  connectionString: string,
  run: (client: Client) => Promise<TResult>,
): Promise<TResult> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 })
  await client.connect()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

/**
 * Opens a connection the caller keeps alive, for gates about live connections. The error listener
 * swallows the socket error Postgres raises when a forced drop terminates the backend, which would
 * otherwise crash the worker as an unhandled 'error' event.
 */
export async function openPostgresClient(connectionString: string): Promise<Client> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 })
  client.on('error', () => undefined)
  await client.connect()
  return client
}

/** Runs one statement as the admin role; one statement per call because DROP DATABASE cannot run inside a transaction block. */
export async function runAdminStatement(statement: string): Promise<void> {
  await withPostgresClient(gateAdminDatabaseUrl, async (client) => {
    await client.query(statement)
  })
}

/** Rows of an arbitrary read, run with whichever role the connection string names. */
export async function queryRowsAs(
  connectionString: string,
  statement: string,
): Promise<Record<string, unknown>[]> {
  return withPostgresClient(connectionString, async (client) => {
    const result = await client.query(statement)
    return result.rows as Record<string, unknown>[]
  })
}

/** True when the server has a database with this name, read through the admin connection. */
export async function gateDatabaseExists(databaseName: string): Promise<boolean> {
  const rows = await withPostgresClient(gateAdminDatabaseUrl, async (client) => {
    const result = await client.query('select 1 from pg_database where datname = $1', [
      databaseName,
    ])
    return result.rows
  })
  return rows.length === 1
}

/** True when the server has a login role with this name, read through the admin connection. */
export async function gateRoleExists(roleName: string): Promise<boolean> {
  const rows = await withPostgresClient(gateAdminDatabaseUrl, async (client) => {
    const result = await client.query('select 1 from pg_roles where rolname = $1', [roleName])
    return result.rows
  })
  return rows.length === 1
}

/** Creates a plain throwaway database owned by the admin role, for gates that must not depend on createProjectDatabase. */
export async function createAdminOwnedGateDatabase(
  databaseName: string,
): Promise<PostgresConnectionString> {
  await runAdminStatement(`CREATE DATABASE "${databaseName}"`)
  return connectionStringForDatabase(gateAdminDatabaseUrl, databaseName)
}

/** Removes a gate database and its same-named role if they are still there; safe to call when neither exists. */
export async function removeGateDatabase(databaseName: string): Promise<void> {
  await runAdminStatement(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`)
  await runAdminStatement(`DROP ROLE IF EXISTS "${databaseName}"`)
}

/** The refusal message Postgres returns for a connection that must not be allowed; fails the gate when the connection is accepted. */
export async function expectConnectionRefused(connectionString: string): Promise<string> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 })
  try {
    await client.connect()
  } catch (error) {
    await client.end().catch(() => undefined)
    return error instanceof Error ? error.message : String(error)
  }
  await client.end()
  throw new Error(`gate expected this connection to be refused: ${connectionString}`)
}
