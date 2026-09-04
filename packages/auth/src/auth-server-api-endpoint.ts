import type { AuthServerApiCallOptions, AuthServerInstance } from './auth-contract.ts'

/**
 * Reads one endpoint off a Better Auth server instance by name. The organization endpoints are
 * genuinely absent when the plugin was left out — measured at the pin, `typeof
 * api.createOrganization` is 'function' with it and 'undefined' without it — so an absent endpoint
 * is how organizations-disabled is detected, structurally, rather than from a flag stored beside the
 * instance.
 */
export type AuthServerApiEndpoint = (callOptions?: AuthServerApiCallOptions) => Promise<unknown>

/** The named endpoint, or undefined when this instance was built without the plugin that defines it. */
export function readAuthServerApiEndpoint(
  authServerInstance: AuthServerInstance,
  endpointName: string,
): AuthServerApiEndpoint | undefined {
  const { api } = authServerInstance
  // Guarded rather than trusted, because the contract types an instance structurally and an app may
  // hold one it built by hand.
  if (typeof api !== 'object' || api === null) {
    return undefined
  }
  const endpoint = api[endpointName]
  return typeof endpoint === 'function' ? endpoint : undefined
}
