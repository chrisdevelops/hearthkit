import {
  createDrizzleClient,
  createProjectDatabase,
  dropProjectDatabase,
  postgresConnectionStringSchema,
  projectDatabaseNameSchema,
  type PostgresConnectionString,
  type ProjectDatabaseName,
} from '@hearthkit/db'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { Client } from 'pg'
import type {
  HearthkitPaymentsDrizzleSchema,
  HearthkitPaymentsTableName,
} from '../src/payments-contract.ts'
import type { HearthkitPaymentsEntry } from './hearthkit-payments-entry.ts'
import { uniqueGatePaymentsToken } from './payments-gate-values.ts'

/**
 * A throwaway Postgres database per gate file, created through @hearthkit/db's own public API and
 * dropped again afterwards. Isolation here is per database, so borrowing the repo-root Postgres from
 * docker-compose.yml costs nothing: no two gate files, and no two runs, share a mutable row.
 *
 * The payments tables inside it are built from hearthkitPaymentsDrizzleSchema itself, per CONTRACT.md
 * Dependencies. No drizzle-kit, and no committed SQL fixture: a fixture can drift from the schema the
 * package exports, and then every gate below it is testing a table set the package does not ship.
 */

/** Admin connection to the Postgres 17 service in the repo-root docker-compose.yml; the role needs CREATEDB and CREATEROLE. */
export const gateAdminDatabaseUrl: PostgresConnectionString = postgresConnectionStringSchema.parse(
  process.env.HEARTHKIT_GATE_ADMIN_DATABASE_URL ??
    'postgresql://hearthkit:hearthkit@localhost:5432/hearthkit',
)

/** A closed loopback port, so reaching it fails at once with ECONNREFUSED without stopping the compose service. */
export const unreachableGateDatabaseUrl: PostgresConnectionString =
  postgresConnectionStringSchema.parse('postgresql://hearthkit:hearthkit@127.0.0.1:59998/hearthkit')

/** The same server and role with a password that is not the right one, which is Postgres error 28P01. */
export const wrongPasswordGateDatabaseUrl: PostgresConnectionString = (() => {
  const url = new URL(String(gateAdminDatabaseUrl))
  url.password = 'definitely-not-the-password'
  return postgresConnectionStringSchema.parse(url.toString())
})()

/** The same server and role pointed at a database name that was never created, which is Postgres error 3D000. */
export const absentGateDatabaseUrl: PostgresConnectionString = (() => {
  const url = new URL(String(gateAdminDatabaseUrl))
  url.pathname = `/gate_payments_absent_database_${uniqueGatePaymentsToken()}`
  return postgresConnectionStringSchema.parse(url.toString())
})()

/** Database name unique to this process and call, so parallel gate files and repeated runs never collide. */
export function uniqueGatePaymentsDatabaseName(purpose: string): ProjectDatabaseName {
  return projectDatabaseNameSchema.parse(
    `gate_pay_${purpose}_${process.pid}_${uniqueGatePaymentsToken()}`,
  )
}

/** Everything a database-backed gate file needs, and the one call that takes it all away again. */
export type GatePaymentsDatabase = {
  projectDatabaseName: ProjectDatabaseName
  connectionString: PostgresConnectionString
  drizzleClient: NodePgDatabase<Record<string, unknown>>
  removeGatePaymentsDatabase: () => Promise<void>
}

function quoteGateIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

// Only a primitive default is emitted. A .defaultNow() or a .$defaultFn() reports hasDefault with a
// SQL object or nothing at all, and Drizzle supplies those from JavaScript on the way in, so a
// half-rendered DEFAULT would be a second way for this fixture to disagree with the app's own
// drizzle-kit output.
function renderGateColumnDefault(columnDefault: unknown): string | undefined {
  if (typeof columnDefault === 'boolean' || typeof columnDefault === 'number') {
    return String(columnDefault)
  }
  if (typeof columnDefault === 'string') {
    return `'${columnDefault.replaceAll("'", "''")}'`
  }
  return undefined
}

/**
 * One CREATE TABLE statement derived from one Drizzle table definition. getTableConfig is a public
 * export of drizzle-orm/pg-core and reports each column's name, SQL type, not-null, primary and
 * unique flags, which is everything the three payments tables need; foreign keys and indexes are
 * deliberately left out, because CONTRACT.md says there are no foreign keys here at all and no gate
 * asserts an index.
 */
export function buildPaymentsTableCreateStatement(
  paymentsTableName: string,
  paymentsTable: unknown,
): string {
  let tableConfig: ReturnType<typeof getTableConfig>
  try {
    tableConfig = getTableConfig(paymentsTable as PgTable)
  } catch (error) {
    throw new Error(
      `gate could not read a Drizzle table config for hearthkitPaymentsDrizzleSchema.${paymentsTableName}; it must be a pgTable definition: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const columnDefinitions = tableConfig.columns.map((column) => {
    const parts = [quoteGateIdentifier(column.name), column.getSQLType()]
    if (column.primary) {
      parts.push('PRIMARY KEY')
    } else if (column.notNull) {
      parts.push('NOT NULL')
    }
    const columnDefault = renderGateColumnDefault(column.default)
    if (columnDefault !== undefined) {
      parts.push(`DEFAULT ${columnDefault}`)
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
export function buildPaymentsTableCreateStatements(
  hearthkitPaymentsDrizzleSchema: HearthkitPaymentsDrizzleSchema,
): string[] {
  return Object.entries(hearthkitPaymentsDrizzleSchema).map(([paymentsTableName, paymentsTable]) =>
    buildPaymentsTableCreateStatement(paymentsTableName, paymentsTable),
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
  const projectDatabaseName = uniqueGatePaymentsDatabaseName(purpose)
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
 * A scratch database with no payments tables in it at all, for the gates about a database that was
 * never migrated: verifyPaymentsTablesExist answering payments-tables-missing, and a read answering
 * payments-database-unavailable with Postgres code 42P01.
 */
export async function createGatePaymentsDatabaseWithoutTables(
  purpose: string,
  hearthkitPaymentsDrizzleSchema: HearthkitPaymentsDrizzleSchema,
): Promise<GatePaymentsDatabase> {
  const { projectDatabaseName, connectionString } = await createEmptyGateProjectDatabase(purpose)
  const { drizzleClient, closeDatabaseClient } = createDrizzleClient({
    databaseUrl: connectionString,
    schema: hearthkitPaymentsDrizzleSchema as Record<string, unknown>,
  })

  return {
    projectDatabaseName,
    connectionString,
    drizzleClient,
    removeGatePaymentsDatabase: async () => {
      await closeDatabaseClient()
      await dropProjectDatabase({ adminDatabaseUrl: gateAdminDatabaseUrl, projectDatabaseName })
    },
  }
}

/** A scratch database with the three payments tables created from the shipped schema, and nothing else. */
export async function createGatePaymentsDatabase(
  purpose: string,
  hearthkitPaymentsDrizzleSchema: HearthkitPaymentsDrizzleSchema,
): Promise<GatePaymentsDatabase> {
  const gateDatabase = await createGatePaymentsDatabaseWithoutTables(
    purpose,
    hearthkitPaymentsDrizzleSchema,
  )
  try {
    await runStatementsAsProjectRole(
      gateDatabase.connectionString,
      buildPaymentsTableCreateStatements(hearthkitPaymentsDrizzleSchema),
    )
  } catch (error) {
    await gateDatabase.removeGatePaymentsDatabase()
    throw error
  }
  return gateDatabase
}

/**
 * The scratch database a gate file runs against, with the three tables created and then checked with
 * verifyPaymentsTablesExist itself. That check is the second job CONTRACT.md Decision 1 gives that
 * function: a schema or a DDL that did not produce all three fails here once, loudly and by name,
 * instead of making every gate below it fail with `relation "payments_customer" does not exist`.
 */
export async function createVerifiedGatePaymentsDatabase(
  purpose: string,
  paymentsEntry: HearthkitPaymentsEntry,
): Promise<GatePaymentsDatabase> {
  const gateDatabase = await createGatePaymentsDatabase(
    purpose,
    paymentsEntry.hearthkitPaymentsDrizzleSchema,
  )
  const tables = await paymentsEntry.verifyPaymentsTablesExist({
    drizzleClient: gateDatabase.drizzleClient,
  })
  if (tables.kind !== 'payments-tables-present') {
    await gateDatabase.removeGatePaymentsDatabase()
    throw new Error(
      `gate built the payments tables from hearthkitPaymentsDrizzleSchema and verifyPaymentsTablesExist did not report them present: ${JSON.stringify(tables)}`,
    )
  }
  return gateDatabase
}

/**
 * A lazy Drizzle client over any connection string, for the four payments-database-unavailable
 * producers. Nothing connects here, so a client aimed at a dead port or a wrong password is built
 * without error and fails on the first query, which is where the gate wants the failure to appear.
 */
export function createGateDrizzleClientForUrl(
  databaseUrl: PostgresConnectionString,
  hearthkitPaymentsDrizzleSchema: HearthkitPaymentsDrizzleSchema,
): {
  drizzleClient: NodePgDatabase<Record<string, unknown>>
  closeDatabaseClient: () => Promise<void>
} {
  return createDrizzleClient({
    databaseUrl,
    schema: hearthkitPaymentsDrizzleSchema as Record<string, unknown>,
  })
}

/**
 * Every row of one shipped payments table, read through Drizzle rather than raw SQL. The keys are the
 * table definition's property names, so a gate never has to guess whether the SQL column under
 * `billingReferenceId` is called `billingReferenceId` or `billing_reference_id`: that naming is the
 * app's drizzle-kit output to decide and CONTRACT.md leaves it unconstrained. The scratch database
 * holds one file's rows, so reading a whole table and filtering in the gate is cheaper than it looks.
 */
export async function readGatePaymentsTableRows(
  drizzleClient: NodePgDatabase<Record<string, unknown>>,
  paymentsTable: unknown,
): Promise<Record<string, unknown>[]> {
  const selectFrom = drizzleClient.select() as unknown as {
    from: (table: PgTable) => Promise<Record<string, unknown>[]>
  }
  return selectFrom.from(paymentsTable as PgTable)
}

/** How many rows each shipped table holds; the shape the replay gates assert, since a replay must move no count. */
export async function countGatePaymentsRows(
  drizzleClient: NodePgDatabase<Record<string, unknown>>,
  hearthkitPaymentsDrizzleSchema: HearthkitPaymentsDrizzleSchema,
): Promise<Record<HearthkitPaymentsTableName, number>> {
  const counts = {} as Record<HearthkitPaymentsTableName, number>
  for (const [paymentsTableName, paymentsTable] of Object.entries(hearthkitPaymentsDrizzleSchema)) {
    const rows = await readGatePaymentsTableRows(drizzleClient, paymentsTable)
    counts[paymentsTableName as HearthkitPaymentsTableName] = rows.length
  }
  return counts
}

/** Rows of a read run as the project role, so a gate can confirm what is really on the server. */
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
