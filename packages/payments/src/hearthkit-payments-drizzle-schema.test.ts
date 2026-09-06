import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { sortedGateNames } from '../test-fixtures/payments-gate-expectations.ts'
import { loadHearthkitPaymentsEntry } from '../test-fixtures/hearthkit-payments-entry.ts'
import { hearthkitPaymentsTableNames } from './payments-contract.ts'

/**
 * The conformance gate for the three tables CONTRACT.md specifies, and it touches no database at all.
 * Whether those tables were ever created is verifyPaymentsTablesExist's question, not this one: a
 * schema that conforms perfectly and was never migrated passes here and fails there, which is the
 * correct division.
 *
 * Assertions are on the Drizzle table object's PROPERTY names, not on SQL column names. The app runs
 * drizzle-kit over this schema and CONTRACT.md leaves the SQL spelling unconstrained, so a package
 * that names its column `billing_reference_id` underneath is conforming. What must match is the
 * property a caller reads, plus each column's nullability and uniqueness, which are the constraints
 * the contract does fix — the unique keys especially, because they are what makes a replayed webhook
 * delivery an upsert rather than a duplicate row.
 */

type GateExpectedColumn = {
  propertyName: string
  sqlTypeFamily: string
  notNull: boolean
  primary?: boolean
  unique?: boolean
}

const timestampColumn = (propertyName: string, notNull: boolean): GateExpectedColumn => ({
  propertyName,
  sqlTypeFamily: 'timestamp',
  notNull,
})

const expectedPaymentsColumns: Record<string, readonly GateExpectedColumn[]> = {
  payments_customer: [
    { propertyName: 'id', sqlTypeFamily: 'text', notNull: true, primary: true },
    {
      propertyName: 'billingReferenceId',
      sqlTypeFamily: 'text',
      notNull: true,
      // One Stripe customer per reference. Without it, two concurrent checkouts for one user each
      // create a Stripe customer and the second row silently orphans the first customer's money.
      unique: true,
    },
    { propertyName: 'billingScope', sqlTypeFamily: 'text', notNull: true },
    { propertyName: 'stripeCustomerId', sqlTypeFamily: 'text', notNull: true, unique: true },
    { propertyName: 'billingContactEmail', sqlTypeFamily: 'text', notNull: true },
    timestampColumn('createdAt', true),
    timestampColumn('updatedAt', true),
  ],
  payments_subscription: [
    { propertyName: 'id', sqlTypeFamily: 'text', notNull: true, primary: true },
    { propertyName: 'billingReferenceId', sqlTypeFamily: 'text', notNull: true },
    { propertyName: 'stripeCustomerId', sqlTypeFamily: 'text', notNull: true },
    // The idempotency key of the whole subscription path: a replayed customer.subscription.* event
    // writes the same values to the same row and the row count does not move.
    { propertyName: 'stripeSubscriptionId', sqlTypeFamily: 'text', notNull: true, unique: true },
    { propertyName: 'priceName', sqlTypeFamily: 'text', notNull: true },
    { propertyName: 'stripePriceId', sqlTypeFamily: 'text', notNull: true },
    { propertyName: 'status', sqlTypeFamily: 'text', notNull: true },
    { propertyName: 'quantity', sqlTypeFamily: 'integer', notNull: true },
    // Nullable because they come from the subscription ITEM, and a subscription can be reported
    // before an item exists. stripe@22.6.1's Subscription has no current_period_* field at all.
    timestampColumn('currentPeriodStart', false),
    timestampColumn('currentPeriodEnd', false),
    { propertyName: 'cancelAtPeriodEnd', sqlTypeFamily: 'boolean', notNull: true },
    timestampColumn('canceledAt', false),
    timestampColumn('endedAt', false),
    timestampColumn('trialStart', false),
    timestampColumn('trialEnd', false),
    timestampColumn('createdAt', true),
    timestampColumn('updatedAt', true),
  ],
  payments_purchase: [
    { propertyName: 'id', sqlTypeFamily: 'text', notNull: true, primary: true },
    { propertyName: 'billingReferenceId', sqlTypeFamily: 'text', notNull: true },
    { propertyName: 'stripeCustomerId', sqlTypeFamily: 'text', notNull: true },
    // The idempotency key of the purchase path, for the same reason.
    {
      propertyName: 'stripeCheckoutSessionId',
      sqlTypeFamily: 'text',
      notNull: true,
      unique: true,
    },
    // Nullable: a fully discounted order has no payment intent at all.
    { propertyName: 'stripePaymentIntentId', sqlTypeFamily: 'text', notNull: false },
    { propertyName: 'priceName', sqlTypeFamily: 'text', notNull: true },
    { propertyName: 'stripePriceId', sqlTypeFamily: 'text', notNull: true },
    { propertyName: 'currency', sqlTypeFamily: 'text', notNull: true },
    { propertyName: 'amountTotalMinorUnits', sqlTypeFamily: 'integer', notNull: true },
    { propertyName: 'quantity', sqlTypeFamily: 'integer', notNull: true },
    timestampColumn('purchasedAt', true),
    timestampColumn('createdAt', true),
    timestampColumn('updatedAt', true),
  ],
}

type GateDrizzleColumn = {
  name: string
  notNull: boolean
  primary: boolean
  isUnique: boolean
  getSQLType: () => string
}

/** Every SQL column name the table declares unique, whether on the column or as a table constraint. */
function uniqueSqlColumnNames(paymentsTable: unknown): Set<string> {
  const tableConfig = getTableConfig(paymentsTable as PgTable)
  const uniqueNames = new Set<string>()
  for (const column of tableConfig.columns) {
    if (column.isUnique) {
      uniqueNames.add(column.name)
    }
  }
  for (const uniqueConstraint of tableConfig.uniqueConstraints) {
    // Destructured rather than indexed after a length check, because a length check narrows nothing
    // for the type checker. The condition is the same one: exactly one column, so a composite unique
    // constraint is still not counted — a two-column key would not make either column unique.
    const [onlyColumn, ...furtherColumns] = uniqueConstraint.columns
    if (onlyColumn !== undefined && furtherColumns.length === 0) {
      uniqueNames.add(onlyColumn.name)
    }
  }
  return uniqueNames
}

describe('hearthkitPaymentsDrizzleSchema', () => {
  it('always defines all three tables under keys equal to their SQL table names, in both user-scoped and org-scoped mode', async () => {
    const { hearthkitPaymentsDrizzleSchema } = await loadHearthkitPaymentsEntry()
    const shippedSchema = hearthkitPaymentsDrizzleSchema as Record<string, unknown>

    // All three exist in every project whatever organizationsEnabled is, because the flag decides
    // the billingScope written on a customer row and never which tables exist; changing the tables
    // with the flag later would be a data migration.
    expect(sortedGateNames(Object.keys(shippedSchema))).toEqual(
      sortedGateNames(hearthkitPaymentsTableNames),
    )

    // verifyPaymentsTablesExist looks these same names up in information_schema.tables, so the SQL
    // table name has to equal the schema key even though the column names underneath are free.
    const sqlTableNames = Object.values(shippedSchema).map(
      (paymentsTable) => getTableConfig(paymentsTable as PgTable).name,
    )
    expect(sortedGateNames(sqlTableNames)).toEqual(sortedGateNames(hearthkitPaymentsTableNames))
  })

  it('carries every column CONTRACT.md lists, with the stated nullability and the three unique keys idempotency depends on', async () => {
    const { hearthkitPaymentsDrizzleSchema } = await loadHearthkitPaymentsEntry()
    const shippedSchema = hearthkitPaymentsDrizzleSchema as Record<
      string,
      Record<string, GateDrizzleColumn>
    >

    const missingColumns: string[] = []
    const wrongTypeColumns: string[] = []
    const wrongNullabilityColumns: string[] = []
    const missingUniqueColumns: string[] = []
    const missingPrimaryKeyColumns: string[] = []

    for (const [paymentsTableName, expectedColumns] of Object.entries(expectedPaymentsColumns)) {
      const shippedTable = shippedSchema[paymentsTableName]
      if (typeof shippedTable !== 'object' || shippedTable === null) {
        missingColumns.push(`${paymentsTableName} (whole table)`)
        continue
      }
      const uniqueNames = uniqueSqlColumnNames(shippedTable)

      for (const expectedColumn of expectedColumns) {
        const column = shippedTable[expectedColumn.propertyName]
        if (typeof column !== 'object' || column === null) {
          missingColumns.push(`${paymentsTableName}.${expectedColumn.propertyName}`)
          continue
        }
        if (!column.getSQLType().startsWith(expectedColumn.sqlTypeFamily)) {
          wrongTypeColumns.push(
            `${paymentsTableName}.${expectedColumn.propertyName} is ${column.getSQLType()}, expected ${expectedColumn.sqlTypeFamily}`,
          )
        }
        // A primary key column is not-null by definition, and Drizzle reports notNull false on some
        // primary key declarations, so nullability is only asserted where the contract has a choice.
        if (expectedColumn.primary !== true && column.notNull !== expectedColumn.notNull) {
          wrongNullabilityColumns.push(
            `${paymentsTableName}.${expectedColumn.propertyName} notNull is ${column.notNull}, expected ${expectedColumn.notNull}`,
          )
        }
        if (expectedColumn.primary === true && !column.primary) {
          missingPrimaryKeyColumns.push(`${paymentsTableName}.${expectedColumn.propertyName}`)
        }
        if (expectedColumn.unique === true && !uniqueNames.has(column.name)) {
          missingUniqueColumns.push(`${paymentsTableName}.${expectedColumn.propertyName}`)
        }
      }
    }

    expect(
      missingColumns,
      'CONTRACT.md lists these columns and the shipped schema has none',
    ).toEqual([])
    expect(
      wrongTypeColumns,
      'these columns are a different type family than CONTRACT.md states',
    ).toEqual([])
    expect(
      wrongNullabilityColumns,
      'CONTRACT.md fixes each column as nullable or not, and these disagree',
    ).toEqual([])
    expect(missingPrimaryKeyColumns, 'each table needs its id as the primary key').toEqual([])
    expect(
      missingUniqueColumns,
      'idempotency here is structural rather than a bookkeeping table, so these unique keys are what stops a replayed delivery writing a second row',
    ).toEqual([])
  })
})
