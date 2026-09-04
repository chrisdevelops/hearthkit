import { loadHearthkitConfig } from '@hearthkit/config'
import { dbEnvSchemaFragment } from '@hearthkit/db'
import { describe, expect, it } from 'vitest'
import {
  expectAuthFailure,
  expectContractStringExport,
  expectResultKind,
  sortedGateNames,
} from '../test-fixtures/auth-gate-expectations.ts'
import { loadHearthkitAuthEntry } from '../test-fixtures/hearthkit-auth-entry.ts'
import {
  authOauthConfigIncompleteErrorPrefix,
  resolveAuthRuntimeConfigResultSchema,
  type AuthEnvValues,
} from './auth-contract.ts'

const gateAuthSecretValue = '0123456789abcdef0123456789abcdef'
const gateAuthBaseUrlValue = 'http://localhost:3000'

const requiredAuthEnv = {
  AUTH_SECRET: gateAuthSecretValue,
  AUTH_BASE_URL: gateAuthBaseUrlValue,
}

/**
 * The env exactly as an app hands it over: validated by @hearthkit/config, composed alongside another
 * package's fragment, and passed straight through. The db fragment is here to prove the contract's
 * "extra keys are ignored" clause with a real extra key rather than a made-up one.
 */
async function loadGateAuthEnv(env: Record<string, string>): Promise<AuthEnvValues> {
  const { authEnvSchemaFragment } = await loadHearthkitAuthEntry()
  const loaded = expectResultKind(
    loadHearthkitConfig({
      fragments: [authEnvSchemaFragment, dbEnvSchemaFragment],
      env: { DATABASE_URL: 'postgresql://hearthkit:hearthkit@localhost:5432/hearthkit', ...env },
    }),
    'config-loaded',
  )
  return loaded.config as AuthEnvValues
}

describe('resolveAuthRuntimeConfig', () => {
  it('resolves the secret and base URL with no social providers when neither credential pair is set', async () => {
    const { resolveAuthRuntimeConfig } = await loadHearthkitAuthEntry()

    const result = resolveAuthRuntimeConfig({ authEnv: await loadGateAuthEnv(requiredAuthEnv) })
    resolveAuthRuntimeConfigResultSchema.parse(result)
    const resolved = expectResultKind(result, 'auth-runtime-config-resolved')

    expect(String(resolved.authRuntimeConfig.authSecret)).toBe(gateAuthSecretValue)
    expect(String(resolved.authRuntimeConfig.authBaseUrl)).toBe(gateAuthBaseUrlValue)
    // A local .env with no OAuth credentials is the normal case, not an error: plan section 6 says
    // password and magic link need no client IDs.
    expect(resolved.authRuntimeConfig.socialAuthProviders).toEqual([])
  })

  it('carries a provider whose pair is complete, whether the app named it or only the environment set it', async () => {
    const { resolveAuthRuntimeConfig } = await loadHearthkitAuthEntry()

    const bothPairsSet = await loadGateAuthEnv({
      ...requiredAuthEnv,
      GOOGLE_CLIENT_ID: '1234.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-gate-secret',
      GITHUB_CLIENT_ID: 'Iv23gate',
      GITHUB_CLIENT_SECRET: 'ghs_gate_secret',
    })

    // Neither provider is named here: setting both halves is itself the request, because setting one
    // half is always a mistake and the person who set it clearly intended the provider.
    const fromEnvironmentAlone = expectResultKind(
      resolveAuthRuntimeConfig({ authEnv: bothPairsSet }),
      'auth-runtime-config-resolved',
    )
    expect(
      fromEnvironmentAlone.authRuntimeConfig.socialAuthProviders
        .map((provider) => provider.socialProviderName)
        .toSorted(),
    ).toEqual(['github', 'google'])
    const googleProvider = fromEnvironmentAlone.authRuntimeConfig.socialAuthProviders.find(
      (provider) => provider.socialProviderName === 'google',
    )
    expect(String(googleProvider?.oauthClientId)).toBe('1234.apps.googleusercontent.com')
    expect(String(googleProvider?.oauthClientSecret)).toBe('GOCSPX-gate-secret')

    const alsoRequestedByName = expectResultKind(
      resolveAuthRuntimeConfig({
        authEnv: bothPairsSet,
        requestedSocialProviders: ['google', 'github'],
      }),
      'auth-runtime-config-resolved',
    )
    expect(alsoRequestedByName.authRuntimeConfig.socialAuthProviders).toHaveLength(2)
  })

  it('reports auth-oauth-provider-config-incomplete naming every missing variable for every broken provider at once', async () => {
    const { resolveAuthRuntimeConfig } = await loadHearthkitAuthEntry()

    const result = resolveAuthRuntimeConfig({
      authEnv: await loadGateAuthEnv({
        ...requiredAuthEnv,
        // One half of the GitHub pair, which is always a mistake, so GitHub counts as requested.
        GITHUB_CLIENT_ID: 'Iv23gate',
      }),
      // Google is named by the scaffold but has neither variable, so a deployment that forgot both
      // fails at boot rather than silently rendering no Google button.
      requestedSocialProviders: ['google'],
    })
    resolveAuthRuntimeConfigResultSchema.parse(result)
    const failure = expectAuthFailure(result, 'auth-oauth-provider-config-incomplete')

    // expectAuthFailure parses through authFailureSchema, which already requires the unique prefix;
    // this repeats it against the exported constant so the prefix is visible in the gate too.
    expect(
      failure.message.startsWith(
        expectContractStringExport(
          authOauthConfigIncompleteErrorPrefix,
          'authOauthConfigIncompleteErrorPrefix',
        ),
      ),
    ).toBe(true)
    expect(
      failure.incompleteSocialProviders
        .map((provider) => ({
          socialProviderName: provider.socialProviderName,
          missingVariableNames: sortedGateNames(provider.missingVariableNames),
        }))
        .toSorted((left, right) => left.socialProviderName.localeCompare(right.socialProviderName)),
    ).toEqual([
      { socialProviderName: 'github', missingVariableNames: ['GITHUB_CLIENT_SECRET'] },
      {
        socialProviderName: 'google',
        missingVariableNames: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
      },
    ])
    // The app's boot path throws this message, so the process has to fail to start with the variable
    // names in the text rather than only in a field a log line would drop.
    for (const missingVariableName of [
      'GITHUB_CLIENT_SECRET',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
    ]) {
      expect(failure.message).toContain(missingVariableName)
    }
  })
})
