import { createAuthServerInstance, resolveAuthRuntimeConfig } from '@hearthkit/auth'
import type { AuthServerInstance } from '@hearthkit/auth'
import { requireAppDatabaseClient } from './app-database-client.ts'
import { resolveAppEmailTransport } from './app-email-transport.ts'
import { requireAppRuntimeConfig } from './app-runtime-config.ts'

/**
 * The Better Auth server instance every auth route and every session read goes through.
 *
 * Built on first use and kept, for the same reason the Drizzle client is: it opens no connection, but
 * it reads config, and `next build` prerenders with an empty environment.
 *
 * Three things it needs and where each comes from: the runtime config, which is where the OAuth
 * pairing rule is enforced because a Zod fragment cannot express it; the app's Drizzle client, so
 * auth writes to the same database as everything else; and the email transport, because the magic
 * link is sent through `@hearthkit/email`. That last one is why a project selecting `@hearthkit/auth`
 * must also select `@hearthkit/email`.
 */

// A scaffold literal, never an environment variable. Making it a variable would let somebody flip the
// data model of a running deployment: user-scoped billing and org-scoped billing key their rows
// differently, and the tables exist in both modes either way.
/** Whether this project runs organization-scoped membership and billing; pass the same value everywhere. */
export const appOrganizationsEnabled = false

let cachedAuthServerInstance: AuthServerInstance | undefined

/** The auth server instance, or a thrown Error carrying the owning package's own prefixed message. */
export function requireAppAuthServerInstance(): AuthServerInstance {
  if (cachedAuthServerInstance !== undefined) {
    return cachedAuthServerInstance
  }

  const authRuntimeConfig = resolveAuthRuntimeConfig({ authEnv: requireAppRuntimeConfig() })
  if (authRuntimeConfig.kind !== 'auth-runtime-config-resolved') {
    throw new Error(authRuntimeConfig.message)
  }

  const emailTransport = resolveAppEmailTransport()
  if (emailTransport.kind !== 'email-transport-config-resolved') {
    throw new Error(emailTransport.message)
  }

  const created = createAuthServerInstance({
    authRuntimeConfig: authRuntimeConfig.authRuntimeConfig,
    drizzleClient: requireAppDatabaseClient(),
    emailTransportConfig: emailTransport.emailTransportConfig,
    organizationsEnabled: appOrganizationsEnabled,
  })
  if (created.kind !== 'auth-server-instance-created') {
    throw new Error(created.message)
  }

  cachedAuthServerInstance = created.authServerInstance
  return cachedAuthServerInstance
}
