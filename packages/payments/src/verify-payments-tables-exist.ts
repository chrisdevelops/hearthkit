import { sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  hearthkitPaymentsTableNames,
  paymentsDrizzleClientSchema,
  type HearthkitPaymentsTableName,
  type VerifyPaymentsTablesExistOptions,
  type VerifyPaymentsTablesExistResult,
} from './payments-contract.ts'
import { paymentsInputInvalidFailure } from './payments-failure-results.ts'
import { thrownPaymentsErrorToFailure } from './thrown-payments-error-failure.ts'

// node-postgres answers with a QueryResult carrying `rows`; a driver that answers the rows directly
// is read the same way, so neither shape has to be assumed.
const tableNameRowsSchema = z.array(z.object({ table_name: z.string() }))
const queryResultSchema = z.union([
  tableNameRowsSchema,
  z.object({ rows: tableNameRowsSchema }).transform((queryResult) => queryResult.rows),
])

/**
 * One query against information_schema, so it is safe to call from a health check. It takes the
 * Drizzle client rather than the payments client precisely so observability's /health can call it
 * with no Stripe key at all.
 *
 * payments-tables-missing is a result rather than a failure: the function's whole job is to report
 * presence, and a reachable database with no payments tables in it is the ordinary first-run state of
 * every project. A database that cannot be reached is a different answer, and that one is a failure.
 *
 * Names are read back and compared here rather than filtered in SQL, because information_schema types
 * its identifiers as a domain and a bound array comparison against one needs a cast that adds
 * nothing: the three names are known and the result set is small either way.
 */
export async function verifyPaymentsTablesExist(
  options: VerifyPaymentsTablesExistOptions,
): Promise<VerifyPaymentsTablesExistResult> {
  if (!paymentsDrizzleClientSchema.safeParse(options.drizzleClient).success) {
    return paymentsInputInvalidFailure('drizzle-client')
  }

  let queryResult: unknown
  try {
    queryResult = await options.drizzleClient.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
  } catch (thrownValue) {
    return thrownPaymentsErrorToFailure(thrownValue, undefined)
  }

  const parsedRows = queryResultSchema.safeParse(queryResult)
  const tableNamesInDatabase = new Set((parsedRows.data ?? []).map((row) => row.table_name))

  const presentTableNames: HearthkitPaymentsTableName[] = []
  const missingTableNames: HearthkitPaymentsTableName[] = []
  for (const paymentsTableName of hearthkitPaymentsTableNames) {
    if (tableNamesInDatabase.has(paymentsTableName)) {
      presentTableNames.push(paymentsTableName)
    } else {
      missingTableNames.push(paymentsTableName)
    }
  }

  if (missingTableNames.length > 0) {
    return { kind: 'payments-tables-missing', missingTableNames }
  }
  return { kind: 'payments-tables-present', presentTableNames }
}
