import { afterAll, describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/auth-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/auth-gate-file-context.ts'
import {
  createVerifiedGateAuthDatabase,
  type GateAuthDatabase,
} from '../test-fixtures/auth-gate-postgres-database.ts'
import {
  gateAuthBaseUrl,
  gateAuthPassword,
  gateAuthRuntimeConfig,
  gateAuthSmtpTransportConfig,
  reserveDeadLoopbackPort,
  uniqueGateAuthEmail,
  uniqueGateAuthUserName,
} from '../test-fixtures/auth-gate-values.ts'
import { loadHearthkitAuthEntry } from '../test-fixtures/hearthkit-auth-entry.ts'
import {
  authApiBasePath,
  authRouteHandlersSchema,
  type AuthRouteHandlers,
} from './auth-contract.ts'

const gateFile = defineGateFileContext<{
  gateDatabase: GateAuthDatabase
  routeHandlers: AuthRouteHandlers
}>(async () => {
  const authEntry = await loadHearthkitAuthEntry()
  const deadSmtpPortNumber = await reserveDeadLoopbackPort()
  const gateDatabase = await createVerifiedGateAuthDatabase('routes', authEntry)
  const created = expectResultKind(
    authEntry.createAuthServerInstance({
      authRuntimeConfig: gateAuthRuntimeConfig(),
      drizzleClient: gateDatabase.drizzleClient,
      emailTransportConfig: gateAuthSmtpTransportConfig(deadSmtpPortNumber),
      organizationsEnabled: false,
    }),
    'auth-server-instance-created',
  )
  return {
    gateDatabase,
    routeHandlers: authEntry.createAuthRouteHandlers({
      authServerInstance: created.authServerInstance,
    }),
  }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ gateDatabase }) => gateDatabase.removeGateAuthDatabase())
})

/** The request Cookie header built from a response's Set-Cookie lines, which carry attributes a request may not send back. */
function cookieHeaderFromResponse(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((setCookieLine) => setCookieLine.split(';')[0]?.trim() ?? '')
    .filter((cookiePair) => cookiePair.length > 0)
    .join('; ')
}

describe('createAuthRouteHandlers', () => {
  it('returns the five method handlers a Next.js catch-all route file re-exports', async () => {
    const { routeHandlers } = await gateFile.read()

    // Better Auth routes only GET and POST today. The other three are returned because
    // toNextJsHandler produces them, and returning fewer would silently break a future plugin that
    // adds a route on another method.
    authRouteHandlersSchema.parse(routeHandlers)
    expect(Object.keys(routeHandlers).toSorted()).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'PUT'])
  })

  it('routes a real sign up through POST and reads the same session back through GET', async () => {
    const { routeHandlers } = await gateFile.read()
    const email = uniqueGateAuthEmail('route')

    const signUpResponse = await routeHandlers.POST(
      new Request(`${String(gateAuthBaseUrl)}${authApiBasePath}/sign-up/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password: gateAuthPassword,
          name: uniqueGateAuthUserName('route'),
        }),
      }),
    )

    expect(signUpResponse.status).toBe(200)
    const cookieHeader = cookieHeaderFromResponse(signUpResponse)
    expect(cookieHeader).not.toBe('')

    const sessionResponse = await routeHandlers.GET(
      new Request(`${String(gateAuthBaseUrl)}${authApiBasePath}/get-session`, {
        headers: { cookie: cookieHeader },
      }),
    )
    expect(sessionResponse.status).toBe(200)
    const sessionBody = (await sessionResponse.json()) as { user?: { email?: string } } | null
    expect(sessionBody?.user?.email).toBe(email)
  })
})
