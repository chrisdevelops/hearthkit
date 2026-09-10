/**
 * The ./auth-contract subpath of @hearthkit/auth: a named re-export of the twenty-two contract values
 * that live in auth-contract.ts and every public type, and nothing that reaches an implementation
 * module. It exists because @hearthkit/payments imports the AuthUserId and AuthOrganizationId types
 * from it and templates/app imports authApiBasePath and hearthkitAuthTableNames from it, while the
 * `.` entry drags in @hearthkit/email's `.` entry with its .tsx template modules, plus
 * better-auth/next-js and better-auth/react, none of which a bare `node` process will load. This file
 * and auth-contract.ts import only zod at runtime, so either loads under bare node with no side
 * effect.
 */

/** Contract values: this package's env fragment, the failure union every function returns, and the resolved config the server functions take. */
export {
  authEnvSchemaFragment,
  authFailureSchema,
  authRuntimeConfigSchema,
} from './auth-contract.ts'

/** Contract values: the full result schema of each function that can fail, for validating a value that crossed a process or network boundary. */
export {
  addAuthOrganizationMemberResultSchema,
  completeMagicLinkSignInResultSchema,
  createAuthOrganizationResultSchema,
  createAuthServerInstanceResultSchema,
  readAuthSessionResultSchema,
  requestMagicLinkSignInResultSchema,
  resolveAuthRuntimeConfigResultSchema,
  signInWithPasswordResultSchema,
  signUpWithPasswordResultSchema,
  verifyAuthTablesExistResultSchema,
} from './auth-contract.ts'

/** Contract values: the two literals a consumer reads — the mounted route base path, and the seven table names drizzle-kit is pointed at. */
export { authApiBasePath, hearthkitAuthTableNames } from './auth-contract.ts'

/** Contract values: the branded schemas an app parses user-supplied text through before calling anything here. */
export {
  authOrganizationIdSchema,
  authOrganizationNameSchema,
  authOrganizationSlugSchema,
  authPasswordSchema,
  authUserEmailSchema,
  authUserIdSchema,
  authUserNameSchema,
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
