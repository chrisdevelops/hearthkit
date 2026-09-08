import { magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import {
  authBrowserClientSchema,
  type AuthBrowserClient,
  type CreateAuthBrowserClientOptions,
} from './auth-contract.ts'

/**
 * The Better Auth browser client, exactly as `createAuthClient` builds it, carrying the session
 * hooks. `magicLinkClient()` is always in the plugin list because magic link is always enabled;
 * `organizationClient()` is added only when organizationsEnabled is true.
 *
 * The flag has no effect an app can read off the returned value. The client is a Proxy whose target
 * is a function and it answers every property access, so `typeof client.organization` is 'function'
 * in both modes and so is `typeof client.definitelyNotAPlugin`; `'organization' in client` is false
 * in both. Feature detection on this client does not work, and an app that needs to know which mode
 * it is in branches on the same organizations literal it passed to this function and to
 * createAuthServerInstance. The flag's observable effect is at the network boundary: routed to a
 * server built with organizations off, `organization.create` gets a 404, because that server has no
 * such route.
 *
 * Omit baseUrl for a same-origin app, which is every hearthkit project; it exists only for a split
 * deployment. Cannot fail, and contacts nothing until a hook or a call runs.
 */
export function createAuthBrowserClient(
  options: CreateAuthBrowserClientOptions,
): AuthBrowserClient {
  const authBrowserClient = createAuthClient({
    ...(options.baseUrl === undefined ? {} : { baseURL: String(options.baseUrl) }),
    plugins: [magicLinkClient(), ...(options.organizationsEnabled ? [organizationClient()] : [])],
  })
  // Narrowed through the contract schema rather than a cast. Better Auth's own session type is
  // structurally close to AuthBrowserClient but not assignable to it: the contract brands
  // activeOrganizationId, and a plain string is not a branded one. The schema's one check, that the
  // root value is a function, holds for every client createAuthClient builds, so this cannot throw.
  return authBrowserClientSchema.parse(authBrowserClient)
}
