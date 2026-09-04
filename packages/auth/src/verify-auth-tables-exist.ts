import { sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  hearthkitAuthTableNames,
  type HearthkitAuthTableName,
  type VerifyAuthTablesExistOptions,
  type VerifyAuthTablesExistResult,
} from './auth-contract.ts'
import { thrownAuthErrorToFailure } from './thrown-auth-error-failure.ts'

// node-postgres answers with a QueryResult carrying `rows`; a driver that answers the rows directly
// is read the same way, so neither shape has to be assumed.
const tableNameRowsSchema = z.array(z.object({ table_name: z.string() }))
const queryResultSchema = z.union([
  tableNameRowsSchema,
  z.object({ rows: tableNameRowsSchema }).transform((queryResult) => queryResult.rows),
])

/**
 * One query against information_schema, so it is safe to call from a health check. It answers what
 * is there, which makes auth-tables-missing a result rather than a failure: a reachable database
 * with no auth tables in it is the ordinary first-run state of every project, and the function's
 * whole job is to report presence.
 *
 * It is also what makes the plan's "supports both user-scoped and org-scoped modes from the start"
 * checkable instead of aspirational: all seven tables exist in every project whatever
 * organizationsEnabled was set to, and this reports on all seven.
 *
 * Names are read back and compared here rather than filtered in SQL, because `information_schema`
 * types its identifiers as a domain and a bound array comparison against one needs a cast that adds
 * nothing: the seven names are known and the result set is small either way.
 */
export async function verifyAuthTablesExist(
  options: VerifyAuthTablesExistOptions,
): Promise<VerifyAuthTablesExistResult> {
  let queryResult: unknown
  try {
    queryResult = await options.drizzleClient.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )
  } catch (thrownValue) {
    return thrownAuthErrorToFailure(thrownValue)
  }

  const parsedRows = queryResultSchema.safeParse(queryResult)
  const tableNamesInDatabase = new Set((parsedRows.data ?? []).map((row) => row.table_name))

  const presentTableNames: HearthkitAuthTableName[] = []
  const missingTableNames: HearthkitAuthTableName[] = []
  for (const authTableName of hearthkitAuthTableNames) {
    if (tableNamesInDatabase.has(authTableName)) {
      presentTableNames.push(authTableName)
    } else {
      missingTableNames.push(authTableName)
    }
  }

  if (missingTableNames.length > 0) {
    return { kind: 'auth-tables-missing', missingTableNames }
  }
  return { kind: 'auth-tables-present', presentTableNames }
}
