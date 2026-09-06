/** Public entry point of @hearthkit/auth: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Checks the OAuth pairing at boot; the fragment cannot carry that rule, because config discards a refinement attached to one. */
export { resolveAuthRuntimeConfig } from './resolve-auth-runtime-config.ts'

/** Builds the Better Auth server instance; synchronous, and opens no connection. */
export { createAuthServerInstance } from './create-auth-server-instance.ts'

/** The five method handlers a Next.js catch-all route file re-exports; cannot fail. */
export { createAuthRouteHandlers } from './create-auth-route-handlers.ts'

/** The Better Auth browser client carrying the session hooks; cannot fail, and contacts nothing until a call runs. */
export { createAuthBrowserClient } from './create-auth-browser-client.ts'

/** Who is signed in for this request; a missing or expired cookie is a result, not a failure. */
export { readAuthSession } from './read-auth-session.ts'

/** Creates the user and the first session in one call. */
export { signUpWithPassword } from './sign-up-with-password.ts'

/** Signs an existing user in; a wrong password and an unknown address are reported alike. */
export { signInWithPassword } from './sign-in-with-password.ts'

/** Sends the one-time sign-in link through @hearthkit/email; the link itself is never returned. */
export { requestMagicLinkSignIn } from './request-magic-link-sign-in.ts'

/** Consumes a magic link from the whole URL; the token is spent on the first call. */
export { completeMagicLinkSignIn } from './complete-magic-link-sign-in.ts'

/** Server-side organization provisioning; needs no session headers and gives the named user an owner membership. */
export { createAuthOrganization } from './create-auth-organization.ts'

/** Server-side membership provisioning; the user must already exist, because this invites nobody. */
export { addAuthOrganizationMember } from './add-auth-organization-member.ts'

/** One query against information_schema reporting which of the seven auth tables exist. */
export { verifyAuthTablesExist } from './verify-auth-tables-exist.ts'

/** The Drizzle table map, always carrying all seven tables whatever the organizations flag is. */
export { hearthkitAuthDrizzleSchema } from './hearthkit-auth-drizzle-schema.ts'

/** Contract values: the unique literal prefix every returned failure message starts with. */
export {
  authDatabaseUnavailableErrorPrefix,
  authEmailAlreadyRegisteredErrorPrefix,
  authEmailSendFailedErrorPrefix,
  authInputInvalidErrorPrefix,
  authInvalidCredentialsErrorPrefix,
  authMagicLinkInvalidErrorPrefix,
  authOauthConfigIncompleteErrorPrefix,
  authOrganizationsDisabledErrorPrefix,
  authRequestFailedErrorPrefix,
} from './auth-contract.ts'

/** Contract values: this package's env fragment, the seven table names, and the constants that pin every path, default and limit. */
export {
  authApiBasePath,
  authEnvSchemaFragment,
  authEnvVariableNameSchema,
  defaultMagicLinkExpirySeconds,
  hearthkitAuthTableNameSchema,
  hearthkitAuthTableNames,
  magicLinkErrorQueryParameterName,
  magicLinkTokenQueryParameterName,
  magicLinkVerifyPathSuffix,
  maximumAuthPasswordLength,
  maximumMagicLinkExpirySeconds,
  minimumAuthPasswordLength,
  minimumAuthSecretLength,
} from './auth-contract.ts'

/** Contract values: the Better Auth literals this package matches by exact equality, and the HTTP statuses it pins. */
export {
  betterAuthEmailAlreadyRegisteredErrorCode,
  betterAuthInvalidCredentialsErrorCode,
  betterAuthInvalidTokenErrorValue,
  betterAuthOrganizationAlreadyExistsErrorCode,
  betterAuthOrganizationAlreadyExistsHttpStatus,
  organizationRouteAbsentHttpStatus,
  organizationRouteUnauthorizedHttpStatus,
} from './auth-contract.ts'

/** Contract values: the branded vocabulary schemas, so an app can parse a user-supplied value before calling anything here. */
export {
  authBaseUrlSchema,
  authMemberIdSchema,
  authMemberRoleSchema,
  authOrganizationIdSchema,
  authOrganizationNameSchema,
  authOrganizationSlugSchema,
  authPasswordSchema,
  authSecretSchema,
  authSessionCookieSchema,
  authSessionIdSchema,
  authSessionSchema,
  authUserEmailSchema,
  authUserIdSchema,
  authUserNameSchema,
  authUserSchema,
  magicLinkExpirySecondsSchema,
  oauthClientIdSchema,
  oauthClientSecretSchema,
  socialAuthProviderConfigSchema,
  socialAuthProviderNameSchema,
} from './auth-contract.ts'

/** Contract values: the runtime checks for the three structural values this package hands back or takes in. */
export {
  authBrowserClientSchema,
  authDrizzleClientSchema,
  authRequestHeadersSchema,
  authRouteHandlersSchema,
  authRuntimeConfigSchema,
  authServerInstanceSchema,
} from './auth-contract.ts'

/** Contract values: each failure variant's schema, the field-name enum, and the union of all nine. */
export {
  authDatabaseUnavailableFailureSchema,
  authEmailAlreadyRegisteredFailureSchema,
  authEmailSendFailedFailureSchema,
  authFailureSchema,
  authInputInvalidFailureSchema,
  authInvalidCredentialsFailureSchema,
  authInvalidFieldNameSchema,
  authMagicLinkInvalidFailureSchema,
  authOauthConfigIncompleteFailureSchema,
  authOrganizationsDisabledFailureSchema,
  authRequestFailedFailureSchema,
  incompleteSocialProviderSchema,
} from './auth-contract.ts'

/** Contract values: each function's options, success-only and full result schemas, so a narrowed result can be validated without rebuilding the schema. */
export {
  addAuthOrganizationMemberOptionsSchema,
  addAuthOrganizationMemberResultSchema,
  authMagicLinkSentSchema,
  authOrganizationCreatedSchema,
  authOrganizationMemberAddedSchema,
  authRuntimeConfigResolvedSchema,
  authServerInstanceCreatedSchema,
  authSessionAbsentSchema,
  authSessionActiveSchema,
  authSignedInSchema,
  authSignedUpSchema,
  authTablesMissingSchema,
  authTablesPresentSchema,
  completeMagicLinkSignInOptionsSchema,
  completeMagicLinkSignInResultSchema,
  createAuthBrowserClientOptionsSchema,
  createAuthOrganizationOptionsSchema,
  createAuthOrganizationResultSchema,
  createAuthRouteHandlersOptionsSchema,
  createAuthServerInstanceOptionsSchema,
  createAuthServerInstanceResultSchema,
  readAuthSessionOptionsSchema,
  readAuthSessionResultSchema,
  requestMagicLinkSignInOptionsSchema,
  requestMagicLinkSignInResultSchema,
  resolveAuthRuntimeConfigOptionsSchema,
  resolveAuthRuntimeConfigResultSchema,
  signInWithPasswordOptionsSchema,
  signInWithPasswordResultSchema,
  signUpWithPasswordOptionsSchema,
  signUpWithPasswordResultSchema,
  verifyAuthTablesExistOptionsSchema,
  verifyAuthTablesExistResultSchema,
} from './auth-contract.ts'

/** Contract types: the branded vocabulary and the two records this package reports. */
export type {
  AuthBaseUrl,
  AuthMemberId,
  AuthMemberRole,
  AuthOrganizationId,
  AuthOrganizationName,
  AuthOrganizationSlug,
  AuthPassword,
  AuthSecret,
  AuthSession,
  AuthSessionCookie,
  AuthSessionId,
  AuthUser,
  AuthUserEmail,
  AuthUserId,
  AuthUserName,
  HearthkitAuthTableName,
  OauthClientId,
  OauthClientSecret,
  SocialAuthProviderName,
} from './auth-contract.ts'

/** Contract types: the env values, the resolved runtime config, the failure union and its two carried shapes. */
export type {
  AuthEnvValues,
  AuthFailure,
  AuthInvalidFieldName,
  AuthRuntimeConfig,
  IncompleteSocialProvider,
  SocialAuthProviderConfig,
} from './auth-contract.ts'

/** Contract types: the three structural values — the server instance, the route handlers and the browser client. */
export type {
  AuthBrowserClient,
  AuthRouteHandler,
  AuthRouteHandlers,
  AuthServerApiCallOptions,
  AuthServerInstance,
  AuthSessionSnapshot,
  HearthkitAuthDrizzleSchema,
} from './auth-contract.ts'

/** Contract types: the option, result and function shapes of every function above. */
export type {
  AddAuthOrganizationMember,
  AddAuthOrganizationMemberOptions,
  AddAuthOrganizationMemberResult,
  CompleteMagicLinkSignIn,
  CompleteMagicLinkSignInOptions,
  CompleteMagicLinkSignInResult,
  CreateAuthBrowserClient,
  CreateAuthBrowserClientOptions,
  CreateAuthOrganization,
  CreateAuthOrganizationOptions,
  CreateAuthOrganizationResult,
  CreateAuthRouteHandlers,
  CreateAuthRouteHandlersOptions,
  CreateAuthServerInstance,
  CreateAuthServerInstanceOptions,
  CreateAuthServerInstanceResult,
  ReadAuthSession,
  ReadAuthSessionOptions,
  ReadAuthSessionResult,
  RequestMagicLinkSignIn,
  RequestMagicLinkSignInOptions,
  RequestMagicLinkSignInResult,
  ResolveAuthRuntimeConfig,
  ResolveAuthRuntimeConfigOptions,
  ResolveAuthRuntimeConfigResult,
  SignInWithPassword,
  SignInWithPasswordOptions,
  SignInWithPasswordResult,
  SignUpWithPassword,
  SignUpWithPasswordOptions,
  SignUpWithPasswordResult,
  VerifyAuthTablesExist,
  VerifyAuthTablesExistOptions,
  VerifyAuthTablesExistResult,
} from './auth-contract.ts'
