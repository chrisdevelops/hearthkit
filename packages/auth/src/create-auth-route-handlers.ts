import { toNextJsHandler } from 'better-auth/next-js'
import type { AuthRouteHandlers, CreateAuthRouteHandlersOptions } from './auth-contract.ts'

/**
 * The five method handlers a Next.js catch-all route file re-exports:
 *
 * ```ts
 * export const { GET, POST, PUT, PATCH, DELETE } = createAuthRouteHandlers({ authServerInstance })
 * ```
 *
 * Better Auth routes only GET and POST today. The other three are returned because
 * `toNextJsHandler` produces them, and returning fewer would silently break a future plugin that
 * adds a route on another method. Cannot fail.
 */
export function createAuthRouteHandlers(
  options: CreateAuthRouteHandlersOptions,
): AuthRouteHandlers {
  const { GET, POST, PUT, PATCH, DELETE } = toNextJsHandler(options.authServerInstance)
  // Rebuilt key by key rather than returned whole, so the five names a route file re-exports are
  // this package's promise rather than whatever toNextJsHandler happens to produce.
  return { GET, POST, PUT, PATCH, DELETE }
}
