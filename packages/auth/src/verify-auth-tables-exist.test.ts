import { afterAll, describe, expect, it } from 'vitest'
import { expectResultKind, sortedGateNames } from '../test-fixtures/auth-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/auth-gate-file-context.ts'
import {
  createGateAuthDatabase,
  createGateAuthDatabaseWithoutTables,
  gateDatabaseExists,
  type GateAuthDatabase,
} from '../test-fixtures/auth-gate-postgres-database.ts'
import {
  loadHearthkitAuthEntry,
  type HearthkitAuthEntry,
} from '../test-fixtures/hearthkit-auth-entry.ts'
import { hearthkitAuthTableNames, verifyAuthTablesExistResultSchema } from './auth-contract.ts'

const gateFile = defineGateFileContext<{
  authEntry: HearthkitAuthEntry
  migratedDatabase: GateAuthDatabase
  unmigratedDatabase: GateAuthDatabase
}>(async () => {
  const authEntry = await loadHearthkitAuthEntry()
  // Not createVerifiedGateAuthDatabase: this file is where that check itself is the subject, so it
  // builds the tables and then asks the question rather than assuming the answer during setup.
  const migratedDatabase = await createGateAuthDatabase(
    'tables',
    authEntry.hearthkitAuthDrizzleSchema,
  )
  const unmigratedDatabase = await createGateAuthDatabaseWithoutTables(
    'notables',
    authEntry.hearthkitAuthDrizzleSchema,
  )
  return { authEntry, migratedDatabase, unmigratedDatabase }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(async ({ migratedDatabase, unmigratedDatabase }) => {
    await migratedDatabase.removeGateAuthDatabase()
    await unmigratedDatabase.removeGateAuthDatabase()
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

describe('verifyAuthTablesExist', () => {
  it('reports all seven tables present in a database built from the shipped Drizzle schema', async () => {
    const { authEntry, migratedDatabase } = await gateFile.read()

    const result = await authEntry.verifyAuthTablesExist({
      drizzleClient: migratedDatabase.drizzleClient,
    })
    verifyAuthTablesExistResultSchema.parse(result)
    const present = expectResultKind(result, 'auth-tables-present')

    // All seven exist in every project, whatever organizationsEnabled was set to. This is the plan's
    // "supports both user-scoped and org-scoped modes from the start" made checkable rather than
    // aspirational: no instance was built here at all, only the schema was used.
    expect(sortedGateNames(present.presentTableNames)).toEqual(
      sortedGateNames(hearthkitAuthTableNames),
    )
  })

  it('reports auth-tables-missing, which is a successful check and not a failure, when migrations never ran', async () => {
    const { authEntry, unmigratedDatabase } = await gateFile.read()

    const result = await authEntry.verifyAuthTablesExist({
      drizzleClient: unmigratedDatabase.drizzleClient,
    })
    verifyAuthTablesExistResultSchema.parse(result)
    // The function's whole job is to report presence, so a negative answer is a result. A database
    // that is reachable and empty is the ordinary first-run state of every project.
    const missing = expectResultKind(result, 'auth-tables-missing')
    expect(sortedGateNames(missing.missingTableNames)).toEqual(
      sortedGateNames(hearthkitAuthTableNames),
    )
  })
})
