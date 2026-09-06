import { afterAll, describe, expect, it } from 'vitest'
import { expectResultKind, sortedGateNames } from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  createGatePaymentsDatabase,
  createGatePaymentsDatabaseWithoutTables,
  gateDatabaseExists,
  type GatePaymentsDatabase,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  loadHearthkitPaymentsEntry,
  type HearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import {
  hearthkitPaymentsTableNames,
  verifyPaymentsTablesExistResultSchema,
} from './payments-contract.ts'

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  migratedDatabase: GatePaymentsDatabase
  unmigratedDatabase: GatePaymentsDatabase
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  // Not createVerifiedGatePaymentsDatabase: this file is where that check itself is the subject, so
  // it builds the tables and then asks the question rather than assuming the answer during setup.
  const migratedDatabase = await createGatePaymentsDatabase(
    'tables',
    paymentsEntry.hearthkitPaymentsDrizzleSchema,
  )
  const unmigratedDatabase = await createGatePaymentsDatabaseWithoutTables(
    'notables',
    paymentsEntry.hearthkitPaymentsDrizzleSchema,
  )
  return { paymentsEntry, migratedDatabase, unmigratedDatabase }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(async ({ migratedDatabase, unmigratedDatabase }) => {
    await migratedDatabase.removeGatePaymentsDatabase()
    await unmigratedDatabase.removeGatePaymentsDatabase()
    // Both scratch databases are gone when this file is done, so a repeated run starts from nothing.
    for (const gateDatabase of [migratedDatabase, unmigratedDatabase]) {
      if (await gateDatabaseExists(String(gateDatabase.projectDatabaseName))) {
        throw new Error(
          `gate left the scratch database ${String(gateDatabase.projectDatabaseName)} behind`,
        )
      }
    }
  })
})

describe('verifyPaymentsTablesExist', () => {
  it('reports all three tables present in a database built from the shipped Drizzle schema', async () => {
    const { paymentsEntry, migratedDatabase } = await gateFile.read()

    // It takes the Drizzle client rather than the payments client on purpose, so observability's
    // /health can call it with no Stripe key at all. No payments client is built in this gate.
    const result = await paymentsEntry.verifyPaymentsTablesExist({
      drizzleClient: migratedDatabase.drizzleClient,
    })
    verifyPaymentsTablesExistResultSchema.parse(result)
    const present = expectResultKind(result, 'payments-tables-present')

    expect(sortedGateNames(present.presentTableNames)).toEqual(
      sortedGateNames(hearthkitPaymentsTableNames),
    )
  })

  it('reports payments-tables-missing, which is a successful check and not a failure, when migrations never ran', async () => {
    const { paymentsEntry, unmigratedDatabase } = await gateFile.read()

    // The function's whole job is to report presence, so a negative answer is a result. A database
    // that is reachable and empty is the ordinary first-run state of every project.
    const result = await paymentsEntry.verifyPaymentsTablesExist({
      drizzleClient: unmigratedDatabase.drizzleClient,
    })
    verifyPaymentsTablesExistResultSchema.parse(result)
    const missing = expectResultKind(result, 'payments-tables-missing')
    expect(sortedGateNames(missing.missingTableNames)).toEqual(
      sortedGateNames(hearthkitPaymentsTableNames),
    )
  })
})
