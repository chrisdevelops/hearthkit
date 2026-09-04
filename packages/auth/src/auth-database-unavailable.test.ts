import type { PostgresConnectionString } from '@hearthkit/db'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { expectAuthFailure, expectResultKind } from '../test-fixtures/auth-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/auth-gate-file-context.ts'
import {
  absentGateDatabaseUrl,
  createGateAuthDatabaseWithoutTables,
  createGateDrizzleClientForUrl,
  unreachableGateDatabaseUrl,
  wrongPasswordGateDatabaseUrl,
  type GateAuthDatabase,
} from '../test-fixtures/auth-gate-postgres-database.ts'
import {
  gateAuthPassword,
  gateAuthRuntimeConfig,
  gateAuthSmtpTransportConfig,
  reserveDeadLoopbackPort,
  uniqueGateAuthEmail,
  uniqueGateAuthUserName,
} from '../test-fixtures/auth-gate-values.ts'
import {
  loadHearthkitAuthEntry,
  type HearthkitAuthEntry,
} from '../test-fixtures/hearthkit-auth-entry.ts'
import type { AuthServerInstance } from './auth-contract.ts'

/**
 * The four Postgres codes CONTRACT.md lists as an allowlist, each produced the cheapest way it can
 * be: two need only a changed connection string, one needs a closed port, one needs a real database
 * with no tables. Every producer arrives as a DrizzleQueryError carrying no code of its own, with the
 * real code exactly one .cause hop down, so classifying any of these as auth-database-unavailable at
 * all is what proves the implementation looked there.
 */

type DatabaseFailureGateFile = {
  authEntry: HearthkitAuthEntry
  deadSmtpPortNumber: number
  unmigratedDatabase: GateAuthDatabase
}

const gateFile = defineGateFileContext<DatabaseFailureGateFile>(async () => {
  const authEntry = await loadHearthkitAuthEntry()
  const deadSmtpPortNumber = await reserveDeadLoopbackPort()
  const unmigratedDatabase = await createGateAuthDatabaseWithoutTables(
    'dbfail',
    authEntry.hearthkitAuthDrizzleSchema,
  )
  return { authEntry, deadSmtpPortNumber, unmigratedDatabase }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ unmigratedDatabase }) =>
    unmigratedDatabase.removeGateAuthDatabase(),
  )
})

/** A lazy client over a connection string that is expected to fail, plus the close the pool needs. */
async function withDrizzleClientForUrl<TResult>(
  databaseUrl: PostgresConnectionString,
  run: (drizzleClient: NodePgDatabase<Record<string, unknown>>) => Promise<TResult>,
): Promise<TResult> {
  const { authEntry } = await gateFile.read()
  const { drizzleClient, closeDatabaseClient } = createGateDrizzleClientForUrl(
    databaseUrl,
    authEntry.hearthkitAuthDrizzleSchema,
  )
  try {
    return await run(drizzleClient)
  } finally {
    await closeDatabaseClient()
  }
}

/** An instance over a connection string that is expected to fail; building it opens no connection. */
async function withInstanceForUrl<TResult>(
  databaseUrl: PostgresConnectionString,
  run: (authServerInstance: AuthServerInstance) => Promise<TResult>,
): Promise<TResult> {
  const { authEntry, deadSmtpPortNumber } = await gateFile.read()
  return withDrizzleClientForUrl(databaseUrl, async (drizzleClient) => {
    const created = expectResultKind(
      authEntry.createAuthServerInstance({
        authRuntimeConfig: gateAuthRuntimeConfig(),
        drizzleClient,
        emailTransportConfig: gateAuthSmtpTransportConfig(deadSmtpPortNumber),
        organizationsEnabled: false,
      }),
      'auth-server-instance-created',
    )
    // The failure appears on the first call that queries, which is where the gate wants it.
    return run(created.authServerInstance)
  })
}

describe('auth-database-unavailable', () => {
  it('reports it when the connection string names a database that does not exist, and when its password is wrong', async () => {
    const { authEntry } = await gateFile.read()

    // Postgres 3D000, from the table check, which needs no instance at all. Nothing about the
    // environment is changed but the database name in the URL.
    const absentDatabase = await withDrizzleClientForUrl(absentGateDatabaseUrl, (drizzleClient) =>
      authEntry.verifyAuthTablesExist({ drizzleClient }),
    )
    const absentFailure = expectAuthFailure(absentDatabase, 'auth-database-unavailable')
    expect(absentFailure.databaseFailureDetail.length).toBeGreaterThan(0)

    // Postgres 28P01, on the same server and the same database, one wrong password apart. Read from
    // a different function on purpose: every database call maps this the same way.
    const wrongPassword = await withInstanceForUrl(
      wrongPasswordGateDatabaseUrl,
      (authServerInstance) =>
        authEntry.signInWithPassword({
          authServerInstance,
          email: uniqueGateAuthEmail('dbfail'),
          password: gateAuthPassword,
        }),
    )
    expectAuthFailure(wrongPassword, 'auth-database-unavailable')
  })

  it('reports it when Postgres refuses the connection outright', async () => {
    const { authEntry } = await gateFile.read()

    // Postgres never answers: ECONNREFUSED, and it arrives on an aggregate error rather than the pg
    // DatabaseError the other three produce, so one handler has to read two unrelated error families.
    const result = await withInstanceForUrl(unreachableGateDatabaseUrl, (authServerInstance) =>
      authEntry.signUpWithPassword({
        authServerInstance,
        email: uniqueGateAuthEmail('dbfail-refused'),
        password: gateAuthPassword,
        name: uniqueGateAuthUserName('dbfail-refused'),
      }),
    )
    const failure = expectAuthFailure(result, 'auth-database-unavailable')
    expect(failure.databaseFailureDetail.length).toBeGreaterThan(0)
  })

  it('reports it when the database is reachable but the auth tables were never created', async () => {
    const { authEntry, unmigratedDatabase } = await gateFile.read()

    // Postgres 42P01, the first-run state of every project before hearthkit db migrate. The same
    // database answers verifyAuthTablesExist with auth-tables-missing, which is a result rather than
    // a failure: asking whether the tables are there is not the same call as trying to use them.
    const result = await withInstanceForUrl(
      unmigratedDatabase.connectionString,
      (authServerInstance) =>
        authEntry.signUpWithPassword({
          authServerInstance,
          email: uniqueGateAuthEmail('dbfail-notables'),
          password: gateAuthPassword,
          name: uniqueGateAuthUserName('dbfail-notables'),
        }),
    )
    const failure = expectAuthFailure(result, 'auth-database-unavailable')
    expect(failure.databaseFailureDetail.length).toBeGreaterThan(0)
  })
})
