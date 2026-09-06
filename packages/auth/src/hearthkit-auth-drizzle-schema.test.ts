import { getAuthTables } from 'better-auth/db'
import { organization } from 'better-auth/plugins'
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { sortedGateNames } from '../test-fixtures/auth-gate-expectations.ts'
import { loadHearthkitAuthEntry } from '../test-fixtures/hearthkit-auth-entry.ts'
import { hearthkitAuthTableNames } from './auth-contract.ts'

/**
 * The conformance gate of CONTRACT.md Decision 10, and it touches no database at all. Whether those
 * tables were ever created is verifyAuthTablesExist's question, not this one: a schema that conforms
 * perfectly and was never migrated passes here and fails there, which is the correct division.
 *
 * getAuthTables(options) returns the pinned version's own authoritative model and field list, so this
 * re-checks on every dependency bump rather than once at authoring time. Run against a hand-written
 * seven-table schema it immediately reported `invitation.createdAt` missing, so it bites.
 */

// The organization plugin is passed because the shipped schema always defines the organization
// tables, whatever organizationsEnabled is set to. Magic link is deliberately absent: it adds no
// model of its own, it stores its tokens in `verification`, so including it would change nothing.
const betterAuthTablesAtThePin = getAuthTables({ plugins: [organization()] })

describe('hearthkitAuthDrizzleSchema', () => {
  it('defines a table for every model getAuthTables reports, carrying a property for every field name', async () => {
    const { hearthkitAuthDrizzleSchema } = await loadHearthkitAuthEntry()
    const shippedSchema = hearthkitAuthDrizzleSchema as Record<string, Record<string, unknown>>

    const missingTableNames = Object.keys(betterAuthTablesAtThePin).filter(
      (modelKey) => typeof shippedSchema[modelKey] !== 'object' || shippedSchema[modelKey] === null,
    )
    expect(
      missingTableNames,
      'better-auth reports these models at the pinned version and the shipped schema defines no table for them',
    ).toEqual([])

    // The comparison is on property keys, not on SQL column names. The Drizzle adapter resolves a
    // column as schema[modelName][fieldName], and this package overrides neither modelName nor
    // fields, so both sides reduce to Better Auth's own names. What the columns are called in SQL is
    // Drizzle's business and is not constrained here.
    const missingFieldNames: string[] = []
    for (const [modelKey, model] of Object.entries(betterAuthTablesAtThePin)) {
      const shippedTable = shippedSchema[modelKey]
      if (shippedTable === undefined) {
        continue
      }
      // getAuthTables never lists the implicit id, and the adapter reads it on every model, so it is
      // required here on top of the reported field names rather than instead of them.
      for (const fieldName of ['id', ...Object.keys(model.fields)]) {
        if (!(fieldName in shippedTable)) {
          missingFieldNames.push(`${modelKey}.${fieldName}`)
        }
      }
    }
    expect(
      missingFieldNames,
      'better-auth resolves each column as schema[modelName][fieldName], so every one of these is a column the adapter cannot find',
    ).toEqual([])
  })

  it('always defines all seven tables under their Better Auth model names, with activeOrganizationId on session', async () => {
    const { hearthkitAuthDrizzleSchema } = await loadHearthkitAuthEntry()
    const shippedSchema = hearthkitAuthDrizzleSchema as Record<string, Record<string, unknown>>

    // All seven exist in every project whatever organizationsEnabled is, because the flag decides
    // which endpoints exist, not which tables do; changing the tables later would be a data migration.
    expect(sortedGateNames(Object.keys(shippedSchema))).toEqual(
      sortedGateNames(hearthkitAuthTableNames),
    )
    expect(shippedSchema.session).toHaveProperty('activeOrganizationId')

    // verifyAuthTablesExist looks these names up in information_schema.tables, so the SQL table name
    // has to equal the model name even though the column names underneath are unconstrained.
    const sqlTableNames = Object.values(shippedSchema).map(
      (authTable) => getTableConfig(authTable as unknown as PgTable).name,
    )
    expect(sortedGateNames(sqlTableNames)).toEqual(sortedGateNames(hearthkitAuthTableNames))
  })
})
