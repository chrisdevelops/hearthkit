import {
  createDrizzleClient,
  createProjectDatabase,
  dropProjectDatabase,
  postgresConnectionStringSchema,
  projectDatabaseNameSchema,
  type PostgresConnectionString,
  type ProjectDatabaseName,
} from '@hearthkit/db'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { Client } from 'pg'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { HearthkitAuthDrizzleSchema } from '../src/auth-contract.ts'
import { uniqueGateAuthToken } from './auth-gate-values.ts'
import type { HearthkitAuthEntry } from './hearthkit-auth-entry.ts'

/**
 * A throwaway Postgres database per gate file, created through @hearthkit/db's own public API and
 * dropped again afterwards. Isolation here is per database, so borrowing the repo-root Postgres from
 * docker-compose.yml costs nothing: no two gate files, and no two runs, share a mutable row.
 *
 * The auth tables inside it are built from hearthkitAuthDrizzleSchema itself, per CONTRACT.md
 * Decision 9. No drizzle-kit, and no committed SQL fixture: a fixture can drift from the schema the
 * package exports, and then every gate below it is testing a table set the package does not ship.
 */

/** Admin connection to the Postgres 17 service in the repo-root docker-compose.yml; the role needs CREATEDB and CREATEROLE. */
export const gateAdminDatabaseUrl: PostgresConnectionString = postgresConnectionStringSchema.parse(
  process.env.HEARTHKIT_GATE_ADMIN_DATABASE_URL ??
    'postgresql://hearthkit:hearthkit@localhost:5432/hearthkit',
)

/** A closed loopback port, so reaching it fails at once with ECONNREFUSED without stopping the compose service. */
export const unreachableGateDatabaseUrl: PostgresConnectionString =
  postgresConnectionStringSchema.parse('postgresql://hearthkit:hearthkit@127.0.0.1:59999/hearthkit')

/** The same server and role with a password that is not the right one, which is Postgres error 28P01. */
export const wrongPasswordGateDatabaseUrl: PostgresConnectionString = (() => {
  const url = new URL(String(gateAdminDatabaseUrl))
  url.password = 'definitely-not-the-password'
  return postgresConnectionStringSchema.parse(url.toString())
})()

/** The same server and role pointed at a database name that was never created, which is Postgres error 3D000. */
export const absentGateDatabaseUrl: PostgresConnectionString = (() => {
  const url = new URL(String(gateAdminDatabaseUrl))
  url.pathname = `/gate_auth_absent_database_${uniqueGateAuthToken()}`
  return postgresConnectionStringSchema.parse(url.toString())
})()

/** Database name unique to this process and call, so parallel gate files and repeated runs never collide. */
export function uniqueGateAuthDatabaseName(purpose: string): ProjectDatabaseName {
  return projectDatabaseNameSchema.parse(
    `gate_auth_${purpose}_${process.pid}_${uniqueGateAuthToken()}`,
  )
}

/** Everything a database-backed gate file needs, and the one call that takes it all away again. */
export type GateAuthDatabase = {
  projectDatabaseName: ProjectDatabaseName
  connectionString: PostgresConnectionString
  drizzleClient: NodePgDatabase<Record<string, unknown>>
  removeGateAuthDatabase: () => Promise<void>
}

function quoteGateIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

/**
 * One CREATE TABLE statement derived from one Drizzle table definition. getTableConfig is a public
 * export of drizzle-orm/pg-core and reports each column's name, SQL type, not-null and primary flags,
 * which is everything the auth tables need; foreign keys and indexes are deliberately left out,
 * because no gate asserts referential integrity and every one of them would only be a second way for
 * this fixture to disagree with the app's own drizzle-kit output. `user` is a reserved word in
 * Postgres, so every identifier is quoted.
 */
export function buildAuthTableCreateStatement(authTableName: string, authTable: unknown): string {
  let tableConfig: ReturnType<typeof getTableConfig>
  try {
    tableConfig = getTableConfig(authTable as PgTable)
  } catch (error) {
    throw new Error(
      `gate could not read a Drizzle table config for hearthkitAuthDrizzleSchema.${authTableName}; it must be a pgTable definition: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const columnDefinitions = tableConfig.columns.map((column) => {
    const parts = [quoteGateIdentifier(column.name), column.getSQLType()]
    if (column.primary) {
      parts.push('PRIMARY KEY')
    } else if (column.notNull) {
      parts.push('NOT NULL')
    }
    if (column.isUnique && !column.primary) {
      parts.push('UNIQUE')
    }
    return parts.join(' ')
  })
  for (const uniqueConstraint of tableConfig.uniqueConstraints) {
    columnDefinitions.push(
      `UNIQUE (${uniqueConstraint.columns.map((column) => quoteGateIdentifier(column.name)).join(', ')})`,
    )
  }
  for (const primaryKey of tableConfig.primaryKeys) {
    columnDefinitions.push(
      `PRIMARY KEY (${primaryKey.columns.map((column) => quoteGateIdentifier(column.name)).join(', ')})`,
    )
  }

  return `CREATE TABLE ${quoteGateIdentifier(tableConfig.name)} (\n  ${columnDefinitions.join(',\n  ')}\n)`
}

/** Every CREATE TABLE the shipped schema implies, one per table, in the order the schema lists them. */
export function buildAuthTableCreateStatements(
  hearthkitAuthDrizzleSchema: HearthkitAuthDrizzleSchema,
): string[] {
  return Object.entries(hearthkitAuthDrizzleSchema).map(([authTableName, authTable]) =>
    buildAuthTableCreateStatement(authTableName, authTable),
  )
}

async function runStatementsAsProjectRole(
  connectionString: PostgresConnectionString,
  statements: readonly string[],
): Promise<void> {
  const client = new Client({ connectionString: String(connectionString) })
  client.on('error', () => undefined)
  await client.connect()
  try {
    for (const statement of statements) {
      await client.query(statement)
    }
  } finally {
    await client.end()
  }
}

async function createEmptyGateProjectDatabase(purpose: string): Promise<{
  projectDatabaseName: ProjectDatabaseName
  connectionString: PostgresConnectionString
}> {
  const projectDatabaseName = uniqueGateAuthDatabaseName(purpose)
  const created = await createProjectDatabase({
    adminDatabaseUrl: gateAdminDatabaseUrl,
    projectDatabaseName,
  })
  if (created.kind !== 'project-database-created') {
    throw new Error(
      `gate could not create its scratch database ${projectDatabaseName}: ${JSON.stringify(created)}. Start Postgres from the repo root with "docker compose up -d --wait postgres".`,
    )
  }
  return { projectDatabaseName, connectionString: created.connectionString }
}

/**
 * A scratch database with no auth tables in it at all, for the gates about a database that was never
 * migrated: verifyAuthTablesExist answering auth-tables-missing, and a sign up answering
 * auth-database-unavailable with Postgres code 42P01.
 */
export async function createGateAuthDatabaseWithoutTables(
  purpose: string,
  hearthkitAuthDrizzleSchema: HearthkitAuthDrizzleSchema,
): Promise<GateAuthDatabase> {
  const { projectDatabaseName, connectionString } = await createEmptyGateProjectDatabase(purpose)
  const { drizzleClient, closeDatabaseClient } = createDrizzleClient({
    databaseUrl: connectionString,
    schema: hearthkitAuthDrizzleSchema as Record<string, unknown>,
  })

  return {
    projectDatabaseName,
    connectionString,
    drizzleClient,
    removeGateAuthDatabase: async () => {
      await closeDatabaseClient()
      await dropProjectDatabase({ adminDatabaseUrl: gateAdminDatabaseUrl, projectDatabaseName })
    },
  }
}

/**
 * A scratch database with the seven auth tables created from the shipped schema. Callers should run
 * verifyAuthTablesExist against it once before relying on it, which is the second job CONTRACT.md
 * Decision 2 gives that function: a broken fixture then fails once by name instead of making every
 * gate below it fail with `relation "user" does not exist`.
 */
export async function createGateAuthDatabase(
  purpose: string,
  hearthkitAuthDrizzleSchema: HearthkitAuthDrizzleSchema,
): Promise<GateAuthDatabase> {
  const gateDatabase = await createGateAuthDatabaseWithoutTables(
    purpose,
    hearthkitAuthDrizzleSchema,
  )
  try {
    await runStatementsAsProjectRole(
      gateDatabase.connectionString,
      buildAuthTableCreateStatements(hearthkitAuthDrizzleSchema),
    )
  } catch (error) {
    await gateDatabase.removeGateAuthDatabase()
    throw error
  }
  return gateDatabase
}

/**
 * The scratch database a gate file runs against, with the seven tables created and then checked with
 * verifyAuthTablesExist itself. That check is the second job CONTRACT.md Decision 2 gives that
 * function: a schema or a DDL that did not produce all seven fails here once, loudly and by name,
 * instead of making every gate below it fail with `relation "user" does not exist`.
 */
export async function createVerifiedGateAuthDatabase(
  purpose: string,
  authEntry: HearthkitAuthEntry,
): Promise<GateAuthDatabase> {
  const gateDatabase = await createGateAuthDatabase(purpose, authEntry.hearthkitAuthDrizzleSchema)
  const tables = await authEntry.verifyAuthTablesExist({
    drizzleClient: gateDatabase.drizzleClient,
  })
  if (tables.kind !== 'auth-tables-present') {
    await gateDatabase.removeGateAuthDatabase()
    throw new Error(
      `gate built the auth tables from hearthkitAuthDrizzleSchema and verifyAuthTablesExist did not report them present: ${JSON.stringify(tables)}`,
    )
  }
  return gateDatabase
}

/**
 * A lazy Drizzle client over any connection string, for the four auth-database-unavailable producers.
 * Nothing connects here, so a client aimed at a dead port or a wrong password is built without error
 * and fails on the first query, which is where the gate wants the failure to appear.
 */
export function createGateDrizzleClientForUrl(
  databaseUrl: PostgresConnectionString,
  hearthkitAuthDrizzleSchema: HearthkitAuthDrizzleSchema,
): {
  drizzleClient: NodePgDatabase<Record<string, unknown>>
  closeDatabaseClient: () => Promise<void>
} {
  return createDrizzleClient({
    databaseUrl,
    schema: hearthkitAuthDrizzleSchema as Record<string, unknown>,
  })
}

/**
 * Every row of one shipped auth table, read through Drizzle rather than raw SQL. The keys are the
 * table definition's property names, so a gate never has to guess whether the SQL column under
 * `userId` is called `userId` or `user_id`: that naming is the app's drizzle-kit output to decide and
 * CONTRACT.md leaves it unconstrained. The scratch database holds one file's rows, so reading a whole
 * table and filtering in the gate is cheaper than it looks.
 */
export async function readGateAuthTableRows(
  drizzleClient: NodePgDatabase<Record<string, unknown>>,
  authTable: unknown,
): Promise<Record<string, unknown>[]> {
  const selectFrom = drizzleClient.select() as unknown as {
    from: (table: PgTable) => Promise<Record<string, unknown>[]>
  }
  return selectFrom.from(authTable as PgTable)
}

/** Rows of a read run as the project role, so a gate can confirm a row Better Auth wrote really exists. */
export async function readGateDatabaseRows(
  connectionString: PostgresConnectionString,
  statement: string,
  values: readonly unknown[] = [],
): Promise<Record<string, unknown>[]> {
  const client = new Client({ connectionString: String(connectionString) })
  client.on('error', () => undefined)
  await client.connect()
  try {
    const result = await client.query(statement, [...values])
    return result.rows as Record<string, unknown>[]
  } finally {
    await client.end()
  }
}

/** True when the server still has a database with this name; used to prove a gate file left nothing behind. */
export async function gateDatabaseExists(databaseName: string): Promise<boolean> {
  const rows = await readGateDatabaseRows(
    gateAdminDatabaseUrl,
    'select 1 from pg_database where datname = $1',
    [databaseName],
  )
  return rows.length === 1
}
