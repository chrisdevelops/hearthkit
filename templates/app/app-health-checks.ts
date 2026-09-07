import type { NamedHealthCheck } from '@hearthkit/observability'

// hearthkit-section:begin @hearthkit/auth
import { verifyAuthTablesExist } from '@hearthkit/auth'
import { healthCheckNameSchema } from '@hearthkit/observability'
import { requireAppDatabaseClient } from './app-database-client.ts'

// hearthkit-section:end @hearthkit/auth
/**
 * The dependency checks `/health` runs on every request.
 *
 * This is the file a package with an external dependency extends. Append a named check and it
 * appears in the `/health` body; if it throws or times out the endpoint answers 503, and the
 * container healthcheck, plus any uptime monitor pointed at it, go red.
 *
 * To add one: bring in the package's check function at the top of this file and append an entry
 * such as `{ healthCheckName: 'database', runHealthCheck: runDatabaseHealthCheck }` to the array
 * below. Names are lowercase kebab-case and must be unique.
 *
 * Keep checks cheap: a single round trip each, never a query that scans a table.
 *
 * The `hearthkit-section` comments delimit the lines one optional package owns, and deleting between
 * them is the whole of what `@hearthkit/create` does to this file when that package was not selected.
 */

// hearthkit-section:begin @hearthkit/auth
/**
 * One round trip to Postgres, through the same query `@hearthkit/auth` uses to report table presence.
 *
 * Reachable-but-unmigrated is HEALTHY on purpose: `auth-tables-missing` is the ordinary first-run
 * state of every project, and failing on it would make `/health` red between `pnpm db:generate` and
 * `hearthkit db migrate`. Only a failure — an unreachable server, a rejected credential, a database
 * that does not exist — makes this throw, which is what turns `/health` into a 503.
 */
async function runDatabaseHealthCheck(): Promise<void> {
  const tablesResult = await verifyAuthTablesExist({ drizzleClient: requireAppDatabaseClient() })
  if (tablesResult.kind !== 'auth-tables-present' && tablesResult.kind !== 'auth-tables-missing') {
    throw new Error(tablesResult.message)
  }
}

// hearthkit-section:end @hearthkit/auth
/** Named health checks `/health` runs; empty until this app depends on something worth checking. */
export const appHealthCheckRegistry: readonly NamedHealthCheck[] = [
  // hearthkit-section:begin @hearthkit/auth
  {
    healthCheckName: healthCheckNameSchema.parse('database'),
    runHealthCheck: runDatabaseHealthCheck,
  },
  // hearthkit-section:end @hearthkit/auth
]
