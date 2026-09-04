import {
  authRuntimeConfigSchema,
  socialAuthProviderNameSchema,
  type AuthEnvValues,
  type IncompleteSocialProvider,
  type OauthClientId,
  type OauthClientSecret,
  type ResolveAuthRuntimeConfigOptions,
  type ResolveAuthRuntimeConfigResult,
  type SocialAuthProviderConfig,
  type SocialAuthProviderName,
} from './auth-contract.ts'
import {
  authOauthConfigIncompleteFailure,
  authRequestFailedFailure,
} from './auth-failure-results.ts'

type OauthCredentialPair = {
  clientIdVariableName: string
  clientSecretVariableName: string
  oauthClientId: OauthClientId | undefined
  oauthClientSecret: OauthClientSecret | undefined
}

/** The two variables each provider is configured by, read off the validated env in one place. */
function oauthCredentialPairs(
  authEnv: AuthEnvValues,
): Record<SocialAuthProviderName, OauthCredentialPair> {
  return {
    google: {
      clientIdVariableName: 'GOOGLE_CLIENT_ID',
      clientSecretVariableName: 'GOOGLE_CLIENT_SECRET',
      oauthClientId: authEnv.GOOGLE_CLIENT_ID,
      oauthClientSecret: authEnv.GOOGLE_CLIENT_SECRET,
    },
    github: {
      clientIdVariableName: 'GITHUB_CLIENT_ID',
      clientSecretVariableName: 'GITHUB_CLIENT_SECRET',
      oauthClientId: authEnv.GITHUB_CLIENT_ID,
      oauthClientSecret: authEnv.GITHUB_CLIENT_SECRET,
    },
  }
}

/**
 * Checks the OAuth pairing at boot and hands the server instance its secret, its base URL and the
 * providers whose credentials are complete.
 *
 * The pairing rule cannot live on the fragment. `composeEnvSchemaFragments` rebuilds a fresh
 * `z.object` from the per-variable schemas alone, so a `.refine` attached to a fragment is silently
 * discarded — not rejected, not errored, simply never run — and a half-filled Google pair would sail
 * through config as if no rule had been written. This function is where the rule actually runs.
 *
 * Contacts nothing. Call it once, immediately after config loads.
 */
export function resolveAuthRuntimeConfig(
  options: ResolveAuthRuntimeConfigOptions,
): ResolveAuthRuntimeConfigResult {
  const requestedSocialProviders = options.requestedSocialProviders ?? []
  const credentialPairs = oauthCredentialPairs(options.authEnv)
  const socialAuthProviders: SocialAuthProviderConfig[] = []
  const incompleteSocialProviders: IncompleteSocialProvider[] = []

  for (const socialProviderName of socialAuthProviderNameSchema.options) {
    const pair = credentialPairs[socialProviderName]

    if (pair.oauthClientId !== undefined && pair.oauthClientSecret !== undefined) {
      socialAuthProviders.push({
        socialProviderName,
        oauthClientId: pair.oauthClientId,
        oauthClientSecret: pair.oauthClientSecret,
      })
      continue
    }

    // A provider is requested when the app names it — the scaffold saying "this project needs
    // Google", so a deployment that forgot both variables fails at boot rather than silently
    // rendering no button — or when either half is set, because setting one half is always a mistake
    // and whoever set it clearly intended the provider.
    const isRequested =
      requestedSocialProviders.includes(socialProviderName) ||
      pair.oauthClientId !== undefined ||
      pair.oauthClientSecret !== undefined
    if (!isRequested) {
      continue
    }

    incompleteSocialProviders.push({
      socialProviderName,
      missingVariableNames: [
        ...(pair.oauthClientId === undefined ? [pair.clientIdVariableName] : []),
        ...(pair.oauthClientSecret === undefined ? [pair.clientSecretVariableName] : []),
      ],
    })
  }

  if (incompleteSocialProviders.length > 0) {
    return authOauthConfigIncompleteFailure(incompleteSocialProviders)
  }

  const parsedRuntimeConfig = authRuntimeConfigSchema.safeParse({
    authSecret: options.authEnv.AUTH_SECRET,
    authBaseUrl: options.authEnv.AUTH_BASE_URL,
    socialAuthProviders,
  })
  if (!parsedRuntimeConfig.success) {
    // Reachable only when authEnv did not come from config, so it names no value: the secret is one
    // of the values here and a message quoting the rejected input would print it.
    return authRequestFailedFailure({
      authFailureDetail:
        'AUTH_SECRET or AUTH_BASE_URL is not a value authEnvSchemaFragment accepts, so this env did not come from @hearthkit/config',
    })
  }

  return { kind: 'auth-runtime-config-resolved', authRuntimeConfig: parsedRuntimeConfig.data }
}
