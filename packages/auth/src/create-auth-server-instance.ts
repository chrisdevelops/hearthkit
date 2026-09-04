import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { emailProductNameSchema } from '@hearthkit/email'
import type { EmailProductName } from '@hearthkit/email/email-contract'
import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { magicLink, organization } from 'better-auth/plugins'
import {
  authServerInstanceSchema,
  defaultMagicLinkExpirySeconds,
  magicLinkExpirySecondsSchema,
  maximumAuthPasswordLength,
  minimumAuthPasswordLength,
  type CreateAuthServerInstanceOptions,
  type CreateAuthServerInstanceResult,
  type SocialAuthProviderConfig,
} from './auth-contract.ts'
import { authInputInvalidFailure, authRequestFailedFailure } from './auth-failure-results.ts'
import { hearthkitAuthDrizzleSchema } from './hearthkit-auth-drizzle-schema.ts'
import { createMagicLinkEmailCallback } from './magic-link-email-callback.ts'
import {
  createMagicLinkEmailSendRecorder,
  registerMagicLinkEmailSendRecorder,
} from './magic-link-email-send-record.ts'
import { createPasswordResetEmailCallback } from './password-reset-email-callback.ts'
import { readThrownAuthErrorDetails } from './thrown-auth-error-details.ts'

type BetterAuthSocialProviders = {
  google?: { clientId: string; clientSecret: string }
  github?: { clientId: string; clientSecret: string }
}

function betterAuthSocialProviders(
  socialAuthProviders: readonly SocialAuthProviderConfig[],
): BetterAuthSocialProviders {
  const providers: BetterAuthSocialProviders = {}
  for (const provider of socialAuthProviders) {
    providers[provider.socialProviderName] = {
      clientId: String(provider.oauthClientId),
      clientSecret: String(provider.oauthClientSecret),
    }
  }
  return providers
}

/**
 * Builds the Better Auth server instance an app keeps at module scope. Synchronous and opens no
 * connection: the Drizzle client is lazy, so an unreachable database surfaces on the first call that
 * queries rather than here.
 *
 * Three things about the configuration are load-bearing and measured at better-auth@1.7.2, so none of
 * them may be "tidied":
 *
 * - `emailAndPassword.autoSignIn` stays on and `requireEmailVerification` stays off. Either one
 *   changed makes a duplicate sign up return a generic success with a populated user and a null
 *   token instead of throwing, which deletes auth-email-already-registered's only producer. That
 *   suppression is a deliberate anti-enumeration measure upstream, not a defect to patch around, so
 *   anyone turning one on has to re-home that failure at the same time.
 * - `nextCookies()` is LAST in the plugin list, which is what lets a Next server action's Set-Cookie
 *   reach the browser.
 * - `drizzleAdapter` is passed `schema`. It is mandatory rather than conventional: without it the
 *   call throws `BetterAuthError: The model "user" was not found in the schema object.`
 *
 * `secret` and `baseURL` are always passed explicitly. Better Auth would read AUTH_SECRET from the
 * environment on its own and fall back to a hardcoded literal, and it has no ambient fallback named
 * AUTH_BASE_URL at all, so dropping either pass would be invisible in development and a production
 * boot error.
 */
export function createAuthServerInstance(
  options: CreateAuthServerInstanceOptions,
): CreateAuthServerInstanceResult {
  let productName: EmailProductName | undefined
  if (options.productName !== undefined) {
    const parsedProductName = emailProductNameSchema.safeParse(options.productName)
    if (!parsedProductName.success) {
      return authInputInvalidFailure('product-name')
    }
    productName = parsedProductName.data
  }

  let magicLinkExpirySeconds = defaultMagicLinkExpirySeconds
  if (options.magicLinkExpirySeconds !== undefined) {
    const parsedExpiry = magicLinkExpirySecondsSchema.safeParse(options.magicLinkExpirySeconds)
    if (!parsedExpiry.success) {
      return authInputInvalidFailure('magic-link-expiry-seconds')
    }
    magicLinkExpirySeconds = parsedExpiry.data
  }

  const recorder = createMagicLinkEmailSendRecorder()

  try {
    const built: unknown = betterAuth({
      secret: String(options.authRuntimeConfig.authSecret),
      baseURL: String(options.authRuntimeConfig.authBaseUrl),
      database: drizzleAdapter(options.drizzleClient, {
        provider: 'pg',
        schema: hearthkitAuthDrizzleSchema,
      }),
      emailAndPassword: {
        enabled: true,
        autoSignIn: true,
        requireEmailVerification: false,
        minPasswordLength: minimumAuthPasswordLength,
        maxPasswordLength: maximumAuthPasswordLength,
        sendResetPassword: createPasswordResetEmailCallback({
          emailTransportConfig: options.emailTransportConfig,
          productName,
        }),
      },
      socialProviders: betterAuthSocialProviders(options.authRuntimeConfig.socialAuthProviders),
      plugins: [
        magicLink({
          expiresIn: magicLinkExpirySeconds,
          sendMagicLink: createMagicLinkEmailCallback({
            emailTransportConfig: options.emailTransportConfig,
            productName,
            magicLinkExpirySeconds,
            recorder,
          }),
        }),
        ...(options.organizationsEnabled ? [organization()] : []),
        nextCookies(),
      ],
    })

    // Narrowed through the contract's own runtime check rather than by assertion, so the value this
    // function hands back is one that satisfies the schema a gate parses it with.
    const parsedInstance = authServerInstanceSchema.safeParse(built)
    if (!parsedInstance.success) {
      return authRequestFailedFailure({
        authFailureDetail: 'betterAuth() answered a value carrying no handler and api pair',
      })
    }

    registerMagicLinkEmailSendRecorder(parsedInstance.data, recorder)

    return {
      kind: 'auth-server-instance-created',
      authServerInstance: parsedInstance.data,
      organizationsEnabled: options.organizationsEnabled,
    }
  } catch (thrownValue) {
    return authRequestFailedFailure({
      authFailureDetail: readThrownAuthErrorDetails(thrownValue).authFailureDetail,
    })
  }
}
