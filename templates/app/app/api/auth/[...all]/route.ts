import { createAuthRouteHandlers } from '@hearthkit/auth'
import type { AuthRouteHandlers } from '@hearthkit/auth'
import { requireAppAuthServerInstance } from '../../../../app-auth-server.ts'

/**
 * Every Better Auth endpoint, under `/api/auth`.
 *
 * Sign up, sign in, sign out, the session read and the magic link verification all land here, which
 * is why the emailed sign-in link points at this route rather than at a page.
 *
 * The five handlers are built on the first request rather than at module scope. `next build` runs with
 * an empty environment, and building the server instance reads config, so doing it at module scope
 * would fail the build. Better Auth routes only GET and POST today; the other three are exported
 * because `createAuthRouteHandlers` produces them and a future plugin may use one.
 */

/** Never prerendered: the route segment config is stated for every section page and handler alike. */
export const dynamic = 'force-dynamic'

/** Defers building the auth server instance to the first request that actually needs it. */
function authRouteHandler(
  methodName: keyof AuthRouteHandlers,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> =>
    createAuthRouteHandlers({ authServerInstance: requireAppAuthServerInstance() })[methodName](
      request,
    )
}

export const GET = authRouteHandler('GET')
export const POST = authRouteHandler('POST')
export const PUT = authRouteHandler('PUT')
export const PATCH = authRouteHandler('PATCH')
export const DELETE = authRouteHandler('DELETE')
