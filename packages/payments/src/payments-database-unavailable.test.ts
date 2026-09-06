import type { PostgresConnectionString } from '@hearthkit/db'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { expectPaymentsFailure } from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  absentGateDatabaseUrl,
  createGateDrizzleClientForUrl,
  createGatePaymentsDatabaseWithoutTables,
  unreachableGateDatabaseUrl,
  wrongPasswordGateDatabaseUrl,
  type GatePaymentsDatabase,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  gatePaymentsCatalog,
  uniqueGateBillingReferenceId,
  uniqueGatePaymentsCatalogNames,
} from '../test-fixtures/payments-gate-values.ts'
import {
  createGatePaymentsClient,
  loadHearthkitPaymentsEntry,
  type HearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import type { PaymentsClient } from './payments-contract.ts'

/**
 * The four Postgres codes CONTRACT.md allowlists, reused verbatim from @hearthkit/auth, each produced
 * the cheapest way it can be: two need only a changed connection string, one needs a closed port, one
 * needs a real database with no tables. Every producer arrives as a DrizzleQueryError carrying no
 * code of its own, with the real code exactly one .cause hop down and arriving from two unrelated
 * error families — an AggregateError for the refused connection and pg's DatabaseError for the rest —
 * so classifying any of these as payments-database-unavailable at all is what proves the
 * implementation looked there.
 */

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  unmigratedDatabase: GatePaymentsDatabase
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const unmigratedDatabase = await createGatePaymentsDatabaseWithoutTables(
    'dbfail',
    paymentsEntry.hearthkitPaymentsDrizzleSchema,
  )
  return { paymentsEntry, unmigratedDatabase }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ unmigratedDatabase }) =>
    unmigratedDatabase.removeGatePaymentsDatabase(),
  )
})

/** A lazy client over a connection string that is expected to fail, plus the close the pool needs. */
async function withDrizzleClientForUrl<TResult>(
  databaseUrl: PostgresConnectionString,
  run: (drizzleClient: NodePgDatabase<Record<string, unknown>>) => Promise<TResult>,
): Promise<TResult> {
  const { paymentsEntry } = await gateFile.read()
  const { drizzleClient, closeDatabaseClient } = createGateDrizzleClientForUrl(
    databaseUrl,
    paymentsEntry.hearthkitPaymentsDrizzleSchema,
  )
  try {
    return await run(drizzleClient)
  } finally {
    await closeDatabaseClient()
  }
}

/** A payments client over a connection string that is expected to fail; building it opens no connection. */
async function withPaymentsClientForUrl<TResult>(
  databaseUrl: PostgresConnectionString,
  run: (paymentsClient: PaymentsClient) => Promise<TResult>,
): Promise<TResult> {
  const { paymentsEntry } = await gateFile.read()
  return withDrizzleClientForUrl(databaseUrl, (drizzleClient) =>
    // The failure appears on the first call that queries, which is where the gate wants it.
    run(
      createGatePaymentsClient({
        paymentsEntry,
        drizzleClient,
        paymentsCatalog: gatePaymentsCatalog(uniqueGatePaymentsCatalogNames('dbfail')),
      }),
    ),
  )
}

describe('payments-database-unavailable', () => {
  it('reports it when the connection string names a database that does not exist, and when its password is wrong', async () => {
    const { paymentsEntry } = await gateFile.read()

    // Postgres 3D000, from the table check, which needs no payments client and no Stripe key at all.
    // Nothing about the environment is changed but the database name in the URL.
    const absentDatabase = await withDrizzleClientForUrl(absentGateDatabaseUrl, (drizzleClient) =>
      paymentsEntry.verifyPaymentsTablesExist({ drizzleClient }),
    )
    expect(
      expectPaymentsFailure(absentDatabase, 'payments-database-unavailable').databaseFailureDetail
        .length,
    ).toBeGreaterThan(0)

    // Postgres 28P01, on the same server and the same database, one wrong password apart. Read from
    // a different function on purpose: every database call maps this the same way.
    const wrongPassword = await withPaymentsClientForUrl(
      wrongPasswordGateDatabaseUrl,
      (paymentsClient) =>
        paymentsEntry.listPaymentsPurchases({
          paymentsClient,
          billingReferenceId: uniqueGateBillingReferenceId('dbfail-password'),
        }),
    )
    expectPaymentsFailure(wrongPassword, 'payments-database-unavailable')
  })

  it('reports it when Postgres refuses the connection outright', async () => {
    const { paymentsEntry } = await gateFile.read()

    // ECONNREFUSED, which arrives on an AggregateError rather than the pg DatabaseError the other
    // three produce, so one handler has to read two unrelated error families.
    const result = await withPaymentsClientForUrl(unreachableGateDatabaseUrl, (paymentsClient) =>
      paymentsEntry.readPaymentsSubscription({
        paymentsClient,
        billingReferenceId: uniqueGateBillingReferenceId('dbfail-refused'),
      }),
    )
    expect(
      expectPaymentsFailure(result, 'payments-database-unavailable').databaseFailureDetail.length,
    ).toBeGreaterThan(0)
  })

  it('reports it when the database is reachable but the payments tables were never created, without quoting the query parameters back', async () => {
    const { paymentsEntry, unmigratedDatabase } = await gateFile.read()
    const billingReferenceId = uniqueGateBillingReferenceId('dbfail-notables')

    // Postgres 42P01, the first-run state of every project before hearthkit db migrate. The same
    // database answers verifyPaymentsTablesExist with payments-tables-missing, which is a result and
    // not a failure: asking whether the tables are there is not the same call as trying to use them.
    const result = await withPaymentsClientForUrl(
      unmigratedDatabase.connectionString,
      (paymentsClient) =>
        paymentsEntry.readPaymentsSubscription({ paymentsClient, billingReferenceId }),
    )
    const failure = expectPaymentsFailure(result, 'payments-database-unavailable')
    expect(failure.databaseFailureDetail.length).toBeGreaterThan(0)

    // The detail is built from the .cause, never from the DrizzleQueryError wrapper: the wrapper's
    // message repeats the failing SQL AND its bound parameters, which on this package's tables would
    // put a customer's email address and Stripe ids into a failure a caller is likely to log.
    expect(JSON.stringify(failure)).not.toContain(billingReferenceId)
  })
})
