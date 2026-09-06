import { afterAll, describe, expect, it } from 'vitest'
import { expectAuthFailure, expectResultKind } from '../test-fixtures/auth-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/auth-gate-file-context.ts'
import {
  createGateDrizzleClientForUrl,
  createVerifiedGateAuthDatabase,
  readGateAuthTableRows,
  unreachableGateDatabaseUrl,
  type GateAuthDatabase,
} from '../test-fixtures/auth-gate-postgres-database.ts'
import {
  gateAuthPassword,
  gateAuthRuntimeConfig,
  gateAuthSmtpTransportConfig,
  gateTooShortAuthPassword,
  gateWrongAuthPassword,
  reserveDeadLoopbackPort,
  uniqueGateAuthEmail,
  uniqueGateAuthUserName,
} from '../test-fixtures/auth-gate-values.ts'
import {
  loadHearthkitAuthEntry,
  type HearthkitAuthEntry,
} from '../test-fixtures/hearthkit-auth-entry.ts'
import {
  signInWithPasswordResultSchema,
  signUpWithPasswordResultSchema,
  type AuthServerInstance,
} from './auth-contract.ts'

const gateFile = defineGateFileContext<{
  authEntry: HearthkitAuthEntry
  gateDatabase: GateAuthDatabase
  authServerInstance: AuthServerInstance
}>(async () => {
  const authEntry = await loadHearthkitAuthEntry()
  const deadSmtpPortNumber = await reserveDeadLoopbackPort()
  const gateDatabase = await createVerifiedGateAuthDatabase('password', authEntry)
  // Built with the configuration this package ships and nothing overridden. That matters for the
  // duplicate sign up gate below: measured at better-auth@1.7.2, emailAndPassword.autoSignIn set to
  // false, or requireEmailVerification set to true, makes a duplicate sign up return a generic
  // success with a populated user and token: null instead of throwing. Either one deletes
  // auth-email-already-registered's only producer, and autoSignIn is the one nobody would check.
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

describe('signUpWithPassword', () => {
  it('creates the user and the first session, returning a request Cookie header rather than a Set-Cookie line', async () => {
    const { authEntry, gateDatabase, authServerInstance } = await gateFile.read()
    const email = uniqueGateAuthEmail('signup')
    const name = uniqueGateAuthUserName('signup')

    const result = await authEntry.signUpWithPassword({
      authServerInstance,
      email,
      password: gateAuthPassword,
      name,
    })
    signUpWithPasswordResultSchema.parse(result)
    const signedUp = expectResultKind(result, 'auth-signed-up')

    expect(String(signedUp.authUser.email)).toBe(email)
    expect(signedUp.authUser.name).toBe(name)
    expect(signedUp.authUser.emailVerified).toBe(false)
    expect(String(signedUp.authUser.id).length).toBeGreaterThan(0)
    // The schema coerces, so the check has to be on the value the package returned, not on the parse.
    expect(signedUp.authUser.createdAt).toBeInstanceOf(Date)

    // A request Cookie header value, ready for new Headers({ cookie }). A raw Set-Cookie line carries
    // attributes and cannot be sent back as-is, so finding one here means the wrong value was returned.
    const authSessionCookie = String(signedUp.authSessionCookie)
    expect(authSessionCookie).toMatch(/^[^=;\s]+=[^;]+/u)
    expect(authSessionCookie.toLowerCase()).not.toContain('httponly')
    expect(authSessionCookie.toLowerCase()).not.toContain('path=')

    const userRows = (
      await readGateAuthTableRows(
        gateDatabase.drizzleClient,
        authEntry.hearthkitAuthDrizzleSchema.user,
      )
    ).filter((row) => row.email === email)
    expect(userRows).toHaveLength(1)
    expect(userRows[0]?.id).toBe(String(signedUp.authUser.id))
  })

  it('reports auth-email-already-registered when the address already has an account', async () => {
    const { authEntry, authServerInstance } = await gateFile.read()
    const email = uniqueGateAuthEmail('duplicate')
    expectResultKind(
      await authEntry.signUpWithPassword({
        authServerInstance,
        email,
        password: gateAuthPassword,
        name: uniqueGateAuthUserName('duplicate'),
      }),
      'auth-signed-up',
    )

    const result = await authEntry.signUpWithPassword({
      authServerInstance,
      email,
      password: gateAuthPassword,
      name: uniqueGateAuthUserName('duplicate'),
    })
    signUpWithPasswordResultSchema.parse(result)
    // Better Auth throws USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL at HTTP 422 for this, and the shorter
    // USER_ALREADY_EXISTS is a separate entry in the same object that this endpoint never throws. A
    // substring match on the short one would appear to work, which is why the contract requires exact
    // equality and why this gate exists to pin it.
    expectAuthFailure(result, 'auth-email-already-registered')
  })

  it('rejects a malformed email, a short password and an empty name before any service is contacted', async () => {
    const { authEntry } = await gateFile.read()
    // Aimed at a dead port on purpose. Anything that reached Postgres would come back as
    // auth-database-unavailable, so auth-input-invalid here proves the value was rejected first.
    const { drizzleClient, closeDatabaseClient } = createGateDrizzleClientForUrl(
      unreachableGateDatabaseUrl,
      authEntry.hearthkitAuthDrizzleSchema,
    )
    try {
      const unreachableInstance = expectResultKind(
        authEntry.createAuthServerInstance({
          authRuntimeConfig: gateAuthRuntimeConfig(),
          drizzleClient,
          emailTransportConfig: gateAuthSmtpTransportConfig(await reserveDeadLoopbackPort()),
          organizationsEnabled: false,
        }),
        'auth-server-instance-created',
      ).authServerInstance

      const emailFailure = expectAuthFailure(
        await authEntry.signUpWithPassword({
          authServerInstance: unreachableInstance,
          email: 'not-a-mailbox',
          password: gateAuthPassword,
          name: uniqueGateAuthUserName('invalid'),
        }),
        'auth-input-invalid',
      )
      expect(emailFailure.invalidFieldName).toBe('email')

      const passwordFailure = expectAuthFailure(
        await authEntry.signUpWithPassword({
          authServerInstance: unreachableInstance,
          email: uniqueGateAuthEmail('invalid'),
          password: gateTooShortAuthPassword,
          name: uniqueGateAuthUserName('invalid'),
        }),
        'auth-input-invalid',
      )
      expect(passwordFailure.invalidFieldName).toBe('password')
      // Never echoes the rejected value, and a password is a secret with no exceptions.
      expect(passwordFailure.invalidFieldReason).not.toContain(gateTooShortAuthPassword)
      expect(passwordFailure.message).not.toContain(gateTooShortAuthPassword)

      const nameFailure = expectAuthFailure(
        await authEntry.signUpWithPassword({
          authServerInstance: unreachableInstance,
          email: uniqueGateAuthEmail('invalid'),
          password: gateAuthPassword,
          name: '',
        }),
        'auth-input-invalid',
      )
      expect(nameFailure.invalidFieldName).toBe('name')
    } finally {
      await closeDatabaseClient()
    }
  })
})

describe('signInWithPassword', () => {
  it('signs an existing user in and returns the same user with a session cookie', async () => {
    const { authEntry, authServerInstance } = await gateFile.read()
    const email = uniqueGateAuthEmail('signin')
    const signedUp = expectResultKind(
      await authEntry.signUpWithPassword({
        authServerInstance,
        email,
        password: gateAuthPassword,
        name: uniqueGateAuthUserName('signin'),
      }),
      'auth-signed-up',
    )

    const result = await authEntry.signInWithPassword({
      authServerInstance,
      email,
      password: gateAuthPassword,
    })
    signInWithPasswordResultSchema.parse(result)
    const signedIn = expectResultKind(result, 'auth-signed-in')

    expect(String(signedIn.authUser.id)).toBe(String(signedUp.authUser.id))
    expect(String(signedIn.authUser.email)).toBe(email)
    expect(String(signedIn.authSessionCookie).length).toBeGreaterThan(0)
  })

  it('reports auth-invalid-credentials for a wrong password and for an address with no account alike', async () => {
    const { authEntry, authServerInstance } = await gateFile.read()
    const email = uniqueGateAuthEmail('credentials')
    expectResultKind(
      await authEntry.signUpWithPassword({
        authServerInstance,
        email,
        password: gateAuthPassword,
        name: uniqueGateAuthUserName('credentials'),
      }),
      'auth-signed-up',
    )

    // Better Auth answers both with INVALID_EMAIL_OR_PASSWORD at HTTP 401, and this package keeps
    // them one kind: saying which half was wrong would make sign in a user-enumeration oracle.
    const wrongPassword = await authEntry.signInWithPassword({
      authServerInstance,
      email,
      password: gateWrongAuthPassword,
    })
    signInWithPasswordResultSchema.parse(wrongPassword)
    expectAuthFailure(wrongPassword, 'auth-invalid-credentials')

    const unknownAddress = await authEntry.signInWithPassword({
      authServerInstance,
      email: uniqueGateAuthEmail('nobody'),
      password: gateAuthPassword,
    })
    signInWithPasswordResultSchema.parse(unknownAddress)
    expectAuthFailure(unknownAddress, 'auth-invalid-credentials')
  })
})
