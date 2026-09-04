import { afterAll, describe, expect, it } from 'vitest'
import { expectAuthFailure, expectResultKind } from '../test-fixtures/auth-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/auth-gate-file-context.ts'
import {
  createVerifiedGateAuthDatabase,
  type GateAuthDatabase,
} from '../test-fixtures/auth-gate-postgres-database.ts'
import {
  gateAuthRuntimeConfig,
  gateAuthRuntimeConfigWithProvider,
  gateAuthSmtpTransportConfig,
  gateOauthClientId,
  reserveDeadLoopbackPort,
} from '../test-fixtures/auth-gate-values.ts'
import {
  loadHearthkitAuthEntry,
  type HearthkitAuthEntry,
} from '../test-fixtures/hearthkit-auth-entry.ts'
import {
  createAuthServerInstanceResultSchema,
  maximumMagicLinkExpirySeconds,
  type AuthServerInstance,
  type CreateAuthServerInstanceOptions,
} from './auth-contract.ts'

type InstanceGateFile = {
  authEntry: HearthkitAuthEntry
  gateDatabase: GateAuthDatabase
  buildGateInstance: (
    overrides?: Partial<CreateAuthServerInstanceOptions>,
  ) => ReturnType<HearthkitAuthEntry['createAuthServerInstance']>
}

const gateFile = defineGateFileContext<InstanceGateFile>(async () => {
  const authEntry = await loadHearthkitAuthEntry()
  const deadSmtpPortNumber = await reserveDeadLoopbackPort()
  const gateDatabase = await createVerifiedGateAuthDatabase('instance', authEntry)

  return {
    authEntry,
    gateDatabase,
    // One instance built the way an app builds it, with only the option under test changed.
    buildGateInstance: (overrides = {}) =>
      authEntry.createAuthServerInstance({
        authRuntimeConfig: gateAuthRuntimeConfig(),
        drizzleClient: gateDatabase.drizzleClient,
        emailTransportConfig: gateAuthSmtpTransportConfig(deadSmtpPortNumber),
        organizationsEnabled: false,
        ...overrides,
      }),
  }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ gateDatabase }) => gateDatabase.removeGateAuthDatabase())
})

describe('createAuthServerInstance', () => {
  it('builds an instance in both modes, echoes the flag back, and carries the organization endpoints only when it is on', async () => {
    const { buildGateInstance } = await gateFile.read()

    const orgResult = buildGateInstance({ organizationsEnabled: true })
    createAuthServerInstanceResultSchema.parse(orgResult)
    const orgMode = expectResultKind(orgResult, 'auth-server-instance-created')
    expect(orgMode.organizationsEnabled).toBe(true)

    const userResult = buildGateInstance({ organizationsEnabled: false })
    createAuthServerInstanceResultSchema.parse(userResult)
    const userMode = expectResultKind(userResult, 'auth-server-instance-created')
    // Echoed back so a caller holding only the result can tell which mode it built.
    expect(userMode.organizationsEnabled).toBe(false)

    const orgApi = orgMode.authServerInstance.api as Record<string, unknown>
    const userApi = userMode.authServerInstance.api as Record<string, unknown>

    // The scaffold flag's observable effect on the server: the endpoints are genuinely absent, not
    // present and erroring, which is what auth-organizations-disabled is detected from.
    expect(typeof orgApi.createOrganization).toBe('function')
    expect(typeof orgApi.addMember).toBe('function')
    expect(typeof userApi.createOrganization).toBe('undefined')
    expect(typeof userApi.addMember).toBe('undefined')

    // Email and password and magic link are always enabled, in both modes.
    for (const api of [orgApi, userApi]) {
      expect(typeof api.signUpEmail).toBe('function')
      expect(typeof api.signInEmail).toBe('function')
      expect(typeof api.signInMagicLink).toBe('function')
    }
    expect(typeof orgMode.authServerInstance.handler).toBe('function')
  })

  it('registers a configured social provider, proved by the authorization URL it builds from the client id', async () => {
    const { buildGateInstance } = await gateFile.read()
    const created = expectResultKind(
      buildGateInstance({ authRuntimeConfig: gateAuthRuntimeConfigWithProvider('google') }),
      'auth-server-instance-created',
    )

    // Completing a Google sign in needs a real client id at a real provider, which plan section 6
    // puts outside local development. Fake credentials are enough to prove the provider is
    // registered: Better Auth builds the authorization URL locally, from the id it was configured
    // with, so a provider that was never registered cannot produce this answer.
    const signInSocialEndpoint = (created.authServerInstance as AuthServerInstance).api.signInSocial
    if (signInSocialEndpoint === undefined) {
      throw new Error('gate expected the auth server instance to carry the signInSocial endpoint')
    }
    const socialSignIn = (await signInSocialEndpoint({
      body: { provider: 'google', callbackURL: '/' },
    })) as { url?: string }

    expect(String(socialSignIn.url)).toContain('https://accounts.google.com/')
    expect(String(socialSignIn.url)).toContain(`client_id=${String(gateOauthClientId)}`)
  })

  it('rejects a product name and a magic link expiry the contract refuses, naming the field without echoing the value', async () => {
    const { buildGateInstance } = await gateFile.read()

    // One character past email's own product name rule, which this option is parsed by.
    const tooLongProductName = 'Gate Product '.padEnd(65, 'x')
    const productNameFailure = expectAuthFailure(
      buildGateInstance({ productName: tooLongProductName }),
      'auth-input-invalid',
    )
    expect(productNameFailure.invalidFieldName).toBe('product-name')
    // The reason states the rule that was broken, never the input, which is what makes the no-echo
    // rule absolute with no exceptions to remember.
    expect(productNameFailure.invalidFieldReason).not.toContain(tooLongProductName)
    expect(productNameFailure.message).not.toContain(tooLongProductName)

    const expiryFailure = expectAuthFailure(
      buildGateInstance({ magicLinkExpirySeconds: maximumMagicLinkExpirySeconds + 1 }),
      'auth-input-invalid',
    )
    expect(expiryFailure.invalidFieldName).toBe('magic-link-expiry-seconds')
  })
})
