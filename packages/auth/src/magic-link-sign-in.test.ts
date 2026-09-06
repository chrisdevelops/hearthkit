import { afterAll, describe, expect, it } from 'vitest'
import { expectAuthFailure, expectResultKind } from '../test-fixtures/auth-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/auth-gate-file-context.ts'
import {
  findGateMailpitMessageBySubject,
  readMagicLinkFromMailpitTextPart,
  startGateMailpitContainer,
  type GateMailpitContainer,
} from '../test-fixtures/auth-gate-mailpit-container.ts'
import {
  createVerifiedGateAuthDatabase,
  readGateAuthTableRows,
  type GateAuthDatabase,
} from '../test-fixtures/auth-gate-postgres-database.ts'
import {
  gateAuthEmailSenderAddress,
  gateAuthRuntimeConfig,
  gateAuthSmtpTransportConfig,
  magicLinkSubjectForProductName,
  reserveDeadLoopbackPort,
  uniqueGateAuthEmail,
  uniqueGateProductName,
} from '../test-fixtures/auth-gate-values.ts'
import {
  loadHearthkitAuthEntry,
  type HearthkitAuthEntry,
} from '../test-fixtures/hearthkit-auth-entry.ts'
import {
  betterAuthInvalidTokenErrorValue,
  completeMagicLinkSignInResultSchema,
  magicLinkTokenQueryParameterName,
  requestMagicLinkSignInResultSchema,
  type AuthServerInstance,
} from './auth-contract.ts'

type MagicLinkGateFile = {
  authEntry: HearthkitAuthEntry
  gateDatabase: GateAuthDatabase
  gateMailpit: GateMailpitContainer
  deadSmtpPortNumber: number
  /**
   * One instance per test, each with a product name of its own. email's magicLinkEmailTemplate builds
   * the subject from the product name, so a unique one per test makes the message this test sent the
   * only message that subject can match: no inbox clearing, and no chance of reading an earlier
   * test's already-consumed token.
   */
  buildMagicLinkInstance: (options: {
    productName: string
    smtpPortNumber?: number
    magicLinkExpirySeconds?: number
  }) => AuthServerInstance
}

const gateFile = defineGateFileContext<MagicLinkGateFile>(async () => {
  const authEntry = await loadHearthkitAuthEntry()
  const deadSmtpPortNumber = await reserveDeadLoopbackPort()
  const gateMailpit = await startGateMailpitContainer('magic')
  let gateDatabase: GateAuthDatabase
  try {
    gateDatabase = await createVerifiedGateAuthDatabase('magic', authEntry)
  } catch (error) {
    await gateMailpit.stopGateMailpitContainer()
    throw error
  }

  return {
    authEntry,
    gateDatabase,
    gateMailpit,
    deadSmtpPortNumber,
    buildMagicLinkInstance: (options) =>
      expectResultKind(
        authEntry.createAuthServerInstance({
          authRuntimeConfig: gateAuthRuntimeConfig(),
          drizzleClient: gateDatabase.drizzleClient,
          emailTransportConfig: gateAuthSmtpTransportConfig(
            options.smtpPortNumber ?? gateMailpit.smtpPortNumber,
          ),
          organizationsEnabled: false,
          productName: options.productName,
          ...(options.magicLinkExpirySeconds === undefined
            ? {}
            : { magicLinkExpirySeconds: options.magicLinkExpirySeconds }),
        }),
        'auth-server-instance-created',
      ).authServerInstance,
  }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(async ({ gateDatabase, gateMailpit }) => {
    await gateDatabase.removeGateAuthDatabase()
    await gateMailpit.stopGateMailpitContainer()
  })
})

describe('requestMagicLinkSignIn and completeMagicLinkSignIn', () => {
  it('sends the link to Mailpit and completes sign in from the URL in the plain text part', async () => {
    const { authEntry, gateDatabase, gateMailpit, buildMagicLinkInstance } = await gateFile.read()
    const productName = uniqueGateProductName('magic-happy')
    const authServerInstance = buildMagicLinkInstance({ productName })
    // An address with no account. Better Auth creates the user on verification, so reporting "no such
    // user" from this endpoint would turn it into a user-enumeration oracle; success is the contract.
    const email = uniqueGateAuthEmail('magic')
    expect(
      (
        await readGateAuthTableRows(
          gateDatabase.drizzleClient,
          authEntry.hearthkitAuthDrizzleSchema.user,
        )
      ).filter((row) => row.email === email),
    ).toHaveLength(0)

    const requested = await authEntry.requestMagicLinkSignIn({ authServerInstance, email })
    requestMagicLinkSignInResultSchema.parse(requested)
    const sent = expectResultKind(requested, 'auth-magic-link-sent')
    expect(String(sent.to)).toBe(email)
    expect(String(sent.transportMessageId).length).toBeGreaterThan(0)

    const delivered = await findGateMailpitMessageBySubject(
      gateMailpit.apiBaseUrl,
      magicLinkSubjectForProductName(productName),
    )
    expect(delivered.To.map((address) => address.Address)).toEqual([email])
    expect(delivered.From.Address).toBe(gateAuthEmailSenderAddress)

    const magicLinkUrl = readMagicLinkFromMailpitTextPart(delivered)
    const magicLinkParameters = new URL(magicLinkUrl).searchParams
    // The emailed link always carries both parameters, callbackURL defaulting to %2F even when none
    // was asked for. That is what makes "read the text part" unconditional: React Email escapes the
    // & between them to &amp;, so a two-parameter URL is verbatim in the text part and nowhere else.
    expect(magicLinkParameters.get(magicLinkTokenQueryParameterName)).toBeTruthy()
    expect(magicLinkParameters.get('callbackURL')).toBe('/')
    expect(delivered.HTML).not.toContain(magicLinkUrl)

    // The link is a single-use sign-in credential, so the send result withholds it.
    const magicLinkToken = String(magicLinkParameters.get(magicLinkTokenQueryParameterName))
    expect(JSON.stringify(sent)).not.toContain(magicLinkToken)

    const completed = await authEntry.completeMagicLinkSignIn({ authServerInstance, magicLinkUrl })
    completeMagicLinkSignInResultSchema.parse(completed)
    const signedIn = expectResultKind(completed, 'auth-signed-in')
    expect(String(signedIn.authUser.email)).toBe(email)

    const session = expectResultKind(
      await authEntry.readAuthSession({
        authServerInstance,
        requestHeaders: new Headers({ cookie: String(signedIn.authSessionCookie) }),
      }),
      'auth-session-active',
    )
    expect(String(session.authUser.id)).toBe(String(signedIn.authUser.id))
  })

  it('puts the callbackUrl the caller asked for into the emailed link and still completes sign in from it', async () => {
    const { authEntry, gateMailpit, buildMagicLinkInstance } = await gateFile.read()
    const productName = uniqueGateProductName('magic-callback')
    const authServerInstance = buildMagicLinkInstance({ productName })

    expectResultKind(
      await authEntry.requestMagicLinkSignIn({
        authServerInstance,
        email: uniqueGateAuthEmail('magic-callback'),
        callbackUrl: '/dashboard',
      }),
      'auth-magic-link-sent',
    )

    const magicLinkUrl = readMagicLinkFromMailpitTextPart(
      await findGateMailpitMessageBySubject(
        gateMailpit.apiBaseUrl,
        magicLinkSubjectForProductName(productName),
      ),
    )
    expect(new URL(magicLinkUrl).searchParams.get('callbackURL')).toBe('/dashboard')

    // completeMagicLinkSignIn sends only the token and drops the link's callbackURL, which is what
    // makes a good token answer 200 with JSON rather than a 302 this function would have to follow.
    expectResultKind(
      await authEntry.completeMagicLinkSignIn({ authServerInstance, magicLinkUrl }),
      'auth-signed-in',
    )
  })

  it('reports auth-magic-link-invalid the second time the same link is used', async () => {
    const { authEntry, gateMailpit, buildMagicLinkInstance } = await gateFile.read()
    const productName = uniqueGateProductName('magic-consumed')
    const authServerInstance = buildMagicLinkInstance({ productName })

    expectResultKind(
      await authEntry.requestMagicLinkSignIn({
        authServerInstance,
        email: uniqueGateAuthEmail('magic-consumed'),
      }),
      'auth-magic-link-sent',
    )
    const magicLinkUrl = readMagicLinkFromMailpitTextPart(
      await findGateMailpitMessageBySubject(
        gateMailpit.apiBaseUrl,
        magicLinkSubjectForProductName(productName),
      ),
    )
    expectResultKind(
      await authEntry.completeMagicLinkSignIn({ authServerInstance, magicLinkUrl }),
      'auth-signed-in',
    )

    // A token is consumed atomically on the first verification, so the second call always fails.
    const result = await authEntry.completeMagicLinkSignIn({ authServerInstance, magicLinkUrl })
    completeMagicLinkSignInResultSchema.parse(result)
    const failure = expectAuthFailure(result, 'auth-magic-link-invalid')
    // The value exists in exactly one place: the error query parameter of the redirect location. The
    // rejection throws a plain Error with statusCode 302, an empty message and no code anywhere, so
    // asserting on it is asserting that the implementation reached the location header.
    expect(failure.betterAuthErrorValue).toBe(betterAuthInvalidTokenErrorValue)
  })

  it('reports auth-magic-link-invalid for a link whose one second expiry has passed', async () => {
    const { authEntry, gateMailpit, buildMagicLinkInstance } = await gateFile.read()
    const productName = uniqueGateProductName('magic-expired')
    const authServerInstance = buildMagicLinkInstance({ productName, magicLinkExpirySeconds: 1 })

    // The send has to succeed for this gate to reach its point, and that is the assertion: with a one
    // second expiry, Math.floor(1 / 60) is 0, which email's expiry rule has no representable value
    // for, so the prop must be omitted rather than passed as 0 and failing to render.
    expectResultKind(
      await authEntry.requestMagicLinkSignIn({
        authServerInstance,
        email: uniqueGateAuthEmail('magic-expired'),
      }),
      'auth-magic-link-sent',
    )
    const magicLinkUrl = readMagicLinkFromMailpitTextPart(
      await findGateMailpitMessageBySubject(
        gateMailpit.apiBaseUrl,
        magicLinkSubjectForProductName(productName),
      ),
    )

    await new Promise((resolve) => setTimeout(resolve, 2_000))

    // Better Auth cannot tell an expired token from a consumed or unknown one: all three produce the
    // identical INVALID_TOKEN redirect, so this variant honestly covers all three.
    const failure = expectAuthFailure(
      await authEntry.completeMagicLinkSignIn({ authServerInstance, magicLinkUrl }),
      'auth-magic-link-invalid',
    )
    expect(failure.betterAuthErrorValue).toBe(betterAuthInvalidTokenErrorValue)
  })

  it('reports auth-email-send-failed carrying the email package failure when SMTP refuses the connection', async () => {
    const { authEntry, deadSmtpPortNumber, buildMagicLinkInstance } = await gateFile.read()
    const authServerInstance = buildMagicLinkInstance({
      productName: uniqueGateProductName('magic-dead-smtp'),
      smtpPortNumber: deadSmtpPortNumber,
    })

    const result = await authEntry.requestMagicLinkSignIn({
      authServerInstance,
      email: uniqueGateAuthEmail('magic-dead-smtp'),
    })
    requestMagicLinkSignInResultSchema.parse(result)
    const failure = expectAuthFailure(result, 'auth-email-send-failed')

    // Without this variant a magic link request against a dead SMTP server would report success and
    // the user would wait for mail that never comes. The detail is email's own message, which already
    // starts with one of its six prefixes, so the real cause survives without restating its taxonomy.
    expect(failure.emailFailureKind).toBe('email-transport-unreachable')
    expect(failure.emailFailureDetail.startsWith('hearthkit email transport unreachable:')).toBe(
      true,
    )
  })

  it('rejects a malformed address, a relative callbackUrl and a link with no token, naming the field', async () => {
    const { authEntry, buildMagicLinkInstance } = await gateFile.read()
    const authServerInstance = buildMagicLinkInstance({
      productName: uniqueGateProductName('magic-invalid'),
    })

    const emailFailure = expectAuthFailure(
      await authEntry.requestMagicLinkSignIn({ authServerInstance, email: 'not-a-mailbox' }),
      'auth-input-invalid',
    )
    expect(emailFailure.invalidFieldName).toBe('email')

    // A callback is an absolute http(s) URL or a path beginning with a slash; a bare word is neither.
    const callbackFailure = expectAuthFailure(
      await authEntry.requestMagicLinkSignIn({
        authServerInstance,
        email: uniqueGateAuthEmail('magic-invalid'),
        callbackUrl: 'dashboard',
      }),
      'auth-input-invalid',
    )
    expect(callbackFailure.invalidFieldName).toBe('callback-url')

    const linkFailure = expectAuthFailure(
      await authEntry.completeMagicLinkSignIn({
        authServerInstance,
        magicLinkUrl: 'https://example.test/api/auth/magic-link/verify',
      }),
      'auth-input-invalid',
    )
    expect(linkFailure.invalidFieldName).toBe('magic-link-url')
  })
})
