import type { EmailFailure } from '@hearthkit/email/email-contract'
import {
  authDatabaseUnavailableErrorPrefix,
  authEmailAlreadyRegisteredErrorPrefix,
  authEmailSendFailedErrorPrefix,
  authInputInvalidErrorPrefix,
  authInvalidCredentialsErrorPrefix,
  authMagicLinkInvalidErrorPrefix,
  authOauthConfigIncompleteErrorPrefix,
  authOrganizationsDisabledErrorPrefix,
  authRequestFailedErrorPrefix,
  maximumAuthPasswordLength,
  maximumMagicLinkExpirySeconds,
  minimumAuthPasswordLength,
  type AuthFailure,
  type AuthInvalidFieldName,
  type IncompleteSocialProvider,
} from './auth-contract.ts'

/**
 * The one place a failure value is built, so every message keeps its unique literal prefix and no
 * variant is ever assembled twice with two different wordings.
 */

/** One variant of the failure union, selected by its kind, so a producer states which failure it returns. */
export type AuthFailureOfKind<TKind extends AuthFailure['kind']> = Extract<
  AuthFailure,
  { kind: TKind }
>

// The rule that was broken, never the value that broke it. That is what makes the no-echo rule
// absolute with no exceptions to remember: a password, a secret and a client secret can all reach
// one of these fields, and a reason that quotes its input would leak whichever one it was.
/** Why each caller-supplied field was rejected, stated as the rule and never as the rejected value. */
export const authInvalidFieldReasons: Record<AuthInvalidFieldName, string> = {
  email: 'must be a single valid mailbox',
  password: `must be from ${String(minimumAuthPasswordLength)} to ${String(maximumAuthPasswordLength)} characters`,
  name: 'must be from 1 to 128 characters and carry no control characters',
  'callback-url': 'must be an absolute http or https URL, or a path beginning with a slash',
  'magic-link-url': 'must be an absolute URL carrying a token query parameter',
  'product-name': 'must be from 1 to 64 characters and carry no control characters',
  'magic-link-expiry-seconds': `must be a whole number of seconds from 1 to ${String(maximumMagicLinkExpirySeconds)}`,
  'organization-name': 'must be from 1 to 128 characters and carry no control characters',
  'organization-slug': 'must be lowercase kebab-case of at most 63 characters',
  'member-role': 'must be owner, admin or member',
  'user-id': 'must be a non-empty identifier that Better Auth generated',
  'organization-id': 'must be a non-empty identifier that Better Auth generated',
}

/** Failure for a caller-supplied value rejected before any database or transport is contacted. */
export function authInputInvalidFailure(
  invalidFieldName: AuthInvalidFieldName,
): AuthFailureOfKind<'auth-input-invalid'> {
  const invalidFieldReason = authInvalidFieldReasons[invalidFieldName]
  return {
    kind: 'auth-input-invalid',
    invalidFieldName,
    invalidFieldReason,
    message: `${authInputInvalidErrorPrefix} ${invalidFieldName} ${invalidFieldReason}`,
  }
}

/** Failure naming every variable missing from every requested social provider, in one value. */
export function authOauthConfigIncompleteFailure(
  incompleteSocialProviders: readonly IncompleteSocialProvider[],
): AuthFailureOfKind<'auth-oauth-provider-config-incomplete'> {
  const perProvider = incompleteSocialProviders.map(
    (provider) =>
      `${provider.socialProviderName} is missing ${provider.missingVariableNames.join(', ')}`,
  )
  return {
    kind: 'auth-oauth-provider-config-incomplete',
    incompleteSocialProviders: incompleteSocialProviders.map((provider) => ({
      socialProviderName: provider.socialProviderName,
      missingVariableNames: [...provider.missingVariableNames],
    })),
    message: `${authOauthConfigIncompleteErrorPrefix} ${perProvider.join('; ')}`,
  }
}

/** Failure when the email and password pair matched no account; it never says which half was wrong. */
export function authInvalidCredentialsFailure(): AuthFailureOfKind<'auth-invalid-credentials'> {
  return {
    kind: 'auth-invalid-credentials',
    message: `${authInvalidCredentialsErrorPrefix} that email and password do not match an account`,
  }
}

/** Failure when a sign up named an address that already has an account. */
export function authEmailAlreadyRegisteredFailure(): AuthFailureOfKind<'auth-email-already-registered'> {
  return {
    kind: 'auth-email-already-registered',
    message: `${authEmailAlreadyRegisteredErrorPrefix} that address already has an account, so offer sign in instead`,
  }
}

/** Failure when a magic link token was expired, already consumed, or unknown; Better Auth reports all three alike. */
export function authMagicLinkInvalidFailure(
  betterAuthErrorValue: string,
): AuthFailureOfKind<'auth-magic-link-invalid'> {
  return {
    kind: 'auth-magic-link-invalid',
    betterAuthErrorValue,
    message: `${authMagicLinkInvalidErrorPrefix} the link was rejected as ${betterAuthErrorValue}, so it is expired, already used, or unknown`,
  }
}

/** Failure when the email package could not deliver; it carries email's own kind and message unchanged. */
export function authEmailSendFailedFailure(
  emailFailure: EmailFailure,
): AuthFailureOfKind<'auth-email-send-failed'> {
  return {
    kind: 'auth-email-send-failed',
    emailFailureKind: emailFailure.kind,
    emailFailureDetail: emailFailure.message,
    message: `${authEmailSendFailedErrorPrefix} ${emailFailure.kind}: ${emailFailure.message}`,
  }
}

/** Failure when an organization call reached an instance built with organizations off; the tables still exist. */
export function authOrganizationsDisabledFailure(
  absentEndpointName: string,
): AuthFailureOfKind<'auth-organizations-disabled'> {
  return {
    kind: 'auth-organizations-disabled',
    message: `${authOrganizationsDisabledErrorPrefix} this auth server instance carries no ${absentEndpointName} endpoint, so it was built with organizationsEnabled false`,
  }
}

/** Failure when Postgres refused, the password or database name is wrong, or the migrations never ran. */
export function authDatabaseUnavailableFailure(
  databaseFailureDetail: string,
): AuthFailureOfKind<'auth-database-unavailable'> {
  return {
    kind: 'auth-database-unavailable',
    databaseFailureDetail,
    message: `${authDatabaseUnavailableErrorPrefix} ${databaseFailureDetail}`,
  }
}

/** Catch-all failure carrying whatever Better Auth supplied, so nothing throws and no cause is lost. */
export function authRequestFailedFailure(details: {
  authFailureDetail: string
  authErrorCode?: string
  authErrorStatus?: number
}): AuthFailureOfKind<'auth-request-failed'> {
  return {
    kind: 'auth-request-failed',
    ...(details.authErrorCode === undefined ? {} : { authErrorCode: details.authErrorCode }),
    ...(details.authErrorStatus === undefined ? {} : { authErrorStatus: details.authErrorStatus }),
    authFailureDetail: details.authFailureDetail,
    message: `${authRequestFailedErrorPrefix} ${details.authFailureDetail}`,
  }
}
