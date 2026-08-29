import type { NamedHealthCheck } from '@hearthkit/observability'

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
 */

/** Named health checks `/health` runs; empty until this app depends on something worth checking. */
export const appHealthCheckRegistry: readonly NamedHealthCheck[] = []
