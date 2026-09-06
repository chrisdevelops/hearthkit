import { afterAll, describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/auth-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/auth-gate-file-context.ts'
import {
  createVerifiedGateAuthDatabase,
  type GateAuthDatabase,
} from '../test-fixtures/auth-gate-postgres-database.ts'
import {
  gateAuthPassword,
  gateAuthRuntimeConfig,
  gateAuthSmtpTransportConfig,
  reserveDeadLoopbackPort,
  uniqueGateAuthEmail,
  uniqueGateAuthUserName,
} from '../test-fixtures/auth-gate-values.ts'
import {
  loadHearthkitAuthEntry,
  type HearthkitAuthEntry,
} from '../test-fixtures/hearthkit-auth-entry.ts'
import { readAuthSessionResultSchema, type AuthServerInstance } from './auth-contract.ts'

const gateFile = defineGateFileContext<{
  authEntry: HearthkitAuthEntry
  gateDatabase: GateAuthDatabase
  authServerInstance: AuthServerInstance
}>(async () => {
  const authEntry = await loadHearthkitAuthEntry()
  const deadSmtpPortNumber = await reserveDeadLoopbackPort()
  const gateDatabase = await createVerifiedGateAuthDatabase('session', authEntry)
  const created = expectResultKind(
    authEntry.createAuthServerInstance({
      authRuntimeConfig: gateAuthRuntimeConfig(),
      drizzleClient: gateDatabase.drizzleClient,
      emailTransportConfig: gateAuthSmtpTransportConfig(deadSmtpPortNumber),
      organizationsEnabled: false,
    }),
    'auth-server-instance-created',
  )
  return { authEntry, gateDatabase, authServerInstance: created.authServerInstance }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ gateDatabase }) => gateDatabase.removeGateAuthDatabase())
})

describe('readAuthSession', () => {
  it('reports the live session and user for the cookie a sign up returned, without the session token', async () => {
    const { authEntry, authServerInstance } = await gateFile.read()
    const email = uniqueGateAuthEmail('read')
    const signedUp = expectResultKind(
      await authEntry.signUpWithPassword({
        authServerInstance,
        email,
        password: gateAuthPassword,
        name: uniqueGateAuthUserName('read'),
      }),
      'auth-signed-up',
    )
    const requestHeaders = new Headers({ cookie: String(signedUp.authSessionCookie) })

    const result = await authEntry.readAuthSession({ authServerInstance, requestHeaders })
    readAuthSessionResultSchema.parse(result)
    const active = expectResultKind(result, 'auth-session-active')

    expect(String(active.authUser.id)).toBe(String(signedUp.authUser.id))
    expect(String(active.authUser.email)).toBe(email)
    expect(String(active.authSession.userId)).toBe(String(signedUp.authUser.id))
    expect(active.authSession.expiresAt).toBeInstanceOf(Date)
    // Null in user-scoped mode and set in org-scoped mode; the column exists in both, which is what
    // makes switching a project between the two a re-homing of rows rather than a schema change.
    expect(active.authSession.activeOrganizationId ?? null).toBeNull()
    // Deliberately absent: a result value is exactly the sort of thing that ends up in a log line,
    // and the session token authenticates a request.
    expect('token' in active.authSession).toBe(false)

    // Next's await headers() returns a read-only object that behaves like Headers without being an
    // instanceof one, so the same read has to work through a stand-in that is structurally a Headers
    // and nothing more. Measured at better-auth@1.7.2: an object carrying only .get reads no cookie
    // at all, so this stand-in carries the whole iteration surface Next's object carries.
    const nextStyleHeaders = {
      get: (headerName: string) => requestHeaders.get(headerName),
      has: (headerName: string) => requestHeaders.has(headerName),
      forEach: (visit: Parameters<Headers['forEach']>[0]) => requestHeaders.forEach(visit),
      entries: () => requestHeaders.entries(),
      keys: () => requestHeaders.keys(),
      values: () => requestHeaders.values(),
      [Symbol.iterator]: () => requestHeaders[Symbol.iterator](),
    } as unknown as Headers
    expect(nextStyleHeaders instanceof Headers).toBe(false)
    const throughNextHeaders = expectResultKind(
      await authEntry.readAuthSession({ authServerInstance, requestHeaders: nextStyleHeaders }),
      'auth-session-active',
    )
    expect(String(throughNextHeaders.authUser.id)).toBe(String(signedUp.authUser.id))
  })

  it('reports auth-session-absent, which is a normal answer and not a failure, for no cookie and for a cookie that is not a session', async () => {
    const { authEntry, authServerInstance } = await gateFile.read()

    // Nobody being signed in is the ordinary answer to "who is signed in". Modelling it as an error
    // would send every server component's happy path through a catch.
    const noCookie = await authEntry.readAuthSession({
      authServerInstance,
      requestHeaders: new Headers(),
    })
    readAuthSessionResultSchema.parse(noCookie)
    expectResultKind(noCookie, 'auth-session-absent')

    const staleCookie = await authEntry.readAuthSession({
      authServerInstance,
      requestHeaders: new Headers({
        cookie: 'better-auth.session_token=gate-token-that-was-never-issued',
      }),
    })
    readAuthSessionResultSchema.parse(staleCookie)
    expectResultKind(staleCookie, 'auth-session-absent')
  })
})
