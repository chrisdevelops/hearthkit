import { createDrizzleClient } from '@hearthkit/db'
import { appDrizzleSchema } from './app-drizzle-schema.ts'
import { requireAppRuntimeConfig } from './app-runtime-config.ts'

/**
 * The one Drizzle client this app hands to `@hearthkit/auth` and `@hearthkit/payments`.
 *
 * Built on first use rather than at module scope, so `next build` can prerender with an empty
 * environment: `createDrizzleClient` opens no connection, but reading `DATABASE_URL` out of config
 * would fail a build that has none. Built once and kept, because a pool per request would open a
 * fresh TCP connection on every page view.
 *
 * `closeDatabaseClient` is deliberately dropped. A long-running server wants the pool to outlive every
 * request, and the process exiting is what closes it; a script that needs a client it can close should
 * call `createDrizzleClient` itself.
 */

/** The Drizzle client type both packages take, named without the app depending on drizzle-orm directly. */
type AppDatabaseClient = ReturnType<
  typeof createDrizzleClient<Record<string, unknown>>
>['drizzleClient']

let cachedAppDatabaseClient: AppDatabaseClient | undefined

/** The app's Drizzle client, opened lazily against DATABASE_URL and reused for the life of the server. */
export function requireAppDatabaseClient(): AppDatabaseClient {
  // The schema type parameter is given rather than inferred, so the client is typed exactly as
  // @hearthkit/auth and @hearthkit/payments declare they take it; inferring the concrete table map
  // would make it structurally unassignable to both.
  cachedAppDatabaseClient ??= createDrizzleClient<Record<string, unknown>>({
    databaseUrl: requireAppRuntimeConfig().DATABASE_URL,
    schema: appDrizzleSchema,
  }).drizzleClient

  return cachedAppDatabaseClient
}
