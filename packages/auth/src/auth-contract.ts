import type {
  EmailFailure,
  EmailTransportConfig,
  TransportMessageId,
} from '@hearthkit/email/email-contract'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { z } from 'zod'

/** Unique literal prefix of the failure message when a requested social provider is missing half or all of its credentials. */
export const authOauthConfigIncompleteErrorPrefix = 'hearthkit auth oauth config incomplete:'

/** Unique literal prefix of the failure message when an email and password pair does not match any account. */
export const authInvalidCredentialsErrorPrefix = 'hearthkit auth invalid credentials:'

/** Unique literal prefix of the failure message when a magic link token is expired, already used, or unknown. */
export const authMagicLinkInvalidErrorPrefix = 'hearthkit auth magic link invalid:'

/** Unique literal prefix of the failure message when a caller-supplied value is rejected before any service is contacted. */
export const authInputInvalidErrorPrefix = 'hearthkit auth input invalid:'

/** Unique literal prefix of the failure message when a sign up uses an email address that already has an account. */
export const authEmailAlreadyRegisteredErrorPrefix = 'hearthkit auth email already registered:'

/** Unique literal prefix of the failure message when the email package could not deliver a sign-in or reset message. */
export const authEmailSendFailedErrorPrefix = 'hearthkit auth email send failed:'

/** Unique literal prefix of the failure message when an organization call is made on an instance built without organizations. */
export const authOrganizationsDisabledErrorPrefix = 'hearthkit auth organizations disabled:'

/** Unique literal prefix of the failure message when Postgres refuses, the password or database is wrong, or the tables are missing. */
export const authDatabaseUnavailableErrorPrefix = 'hearthkit auth database unavailable:'

/** Unique literal prefix of the failure message when an auth call failed in a way this package does not name. */
export const authRequestFailedErrorPrefix = 'hearthkit auth request failed:'

/** Path Better Auth mounts its routes under; the route handler file and the browser client both assume this exact value. */
export const authApiBasePath = '/api/auth'

/** Path segment appended to the base path for magic link verification; the link in the email always ends with it. */
export const magicLinkVerifyPathSuffix = '/magic-link/verify'

/** Query parameter carrying the one-time magic link token, both in the emailed link and in the verify request. */
export const magicLinkTokenQueryParameterName = 'token'

/** Query parameter Better Auth appends to its failure redirect; its presence is how a rejected magic link is recognised. */
export const magicLinkErrorQueryParameterName = 'error'

// This value appears in exactly one place: the `error` query parameter of the redirect location. A
// rejected token throws a plain Error with `statusCode: 302` and an empty message; `instanceof
// APIError` is false and there is no code on it anywhere, so nothing here can be read off a code.
/** The single value Better Auth reports for an expired, already-consumed, or unknown magic link token; it never distinguishes them. */
export const betterAuthInvalidTokenErrorValue = 'INVALID_TOKEN'

/** Better Auth error code for a wrong email or password, read from error.body?.code and matched by exact equality; HTTP 401. */
export const betterAuthInvalidCredentialsErrorCode = 'INVALID_EMAIL_OR_PASSWORD'

// Matched by exact equality, never by substring. `USER_ALREADY_EXISTS` is a second, distinct
// entry in the same $ERROR_CODES object, so a substring test matches both and hides the day this
// value changes. Mirror of the `'19000:9000'.includes('9000:9000')` defect in docs/STATUS.md.
/** Better Auth error code for a sign up whose email is taken, read from error.body?.code; HTTP 422, and it is the long form. */
export const betterAuthEmailAlreadyRegisteredErrorCode = 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'

// This maps to no named failure. It arrives inside auth-request-failed as `authErrorCode`, which is
// what stops that catch-all being a dead end. Internal, not part of the package entry: its only
// reader is a gate. `ORGANIZATION_SLUG_ALREADY_TAKEN` is a second, distinct entry in the same organization
// $ERROR_CODES object, one line away, and is NOT what this endpoint throws — the same decoy shape as
// `USER_ALREADY_EXISTS` beside `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`. `SLUG_TAKEN` is not an error
// code in this library at all; an earlier revision of this contract illustrated the case with it.
// Measured: a real slug collision throws this value at HTTP 400, message `Organization already
// exists`, with `body` present. Never take an error code for this library from documentation or from
// memory — read it off a thrown error, because the enum reliably holds a plausible near-miss.
/** Better Auth error code when an organization slug is already used, read from error.body?.code; HTTP 400. */
export const betterAuthOrganizationAlreadyExistsErrorCode = 'ORGANIZATION_ALREADY_EXISTS'

// Named for symmetry with the code above and with the 404/401 pair below: every HTTP status this
// contract pins has a name, so no gate writes one of these numbers bare. Internal, like the code
// above; a gate is its only reader. It arrives on
// auth-request-failed as `authErrorStatus`, which is read from `error.statusCode` — never from
// `error.status`, which holds the string name rather than the number.
/** HTTP status of the organization slug collision, measured at the pin; pairs with the error code above. */
export const betterAuthOrganizationAlreadyExistsHttpStatus = 400

// THESE TWO ARE A PAIR AND A GATE MUST ASSERT BOTH. Measured at better-auth@1.7.2 with one POST to
// `/api/auth/organization/create` handed to `authServerInstance.handler(request)`, the same request
// against two server instances: built with `organizationsEnabled: false` the answer is 404, built
// with `organizationsEnabled: true` and no session on the request it is 401. Both bodies are empty,
// so the status is the whole of what can be matched. The 401 is the negative control and it is the
// half that carries the meaning: it proves the route EXISTS on the flag-on instance and was rejected
// for want of a session rather than for want of a route, which is what makes the 404 mean "no such
// endpoint" instead of "typo in the path". A gate asserting only the 404 could be satisfied by a
// misspelled URL. Same argument as the STARTTLS and presign gates in email and storage.
/** HTTP status the organization create route answers when the server instance was built with organizations off; the route is absent. */
export const organizationRouteAbsentHttpStatus = 404

/** HTTP status the same request gets from an instance built with organizations on and no session on it; the control that proves the route exists. */
export const organizationRouteUnauthorizedHttpStatus = 401

/** Seconds a magic link stays usable when the app does not choose; matches Better Auth's own five minute default. */
export const defaultMagicLinkExpirySeconds = 300

/** Longest magic link lifetime this package accepts, in seconds; seven days, the same ceiling email prints in its templates. */
export const maximumMagicLinkExpirySeconds = 604800

/** Shortest AUTH_SECRET this package accepts, in characters; Better Auth documents the same floor for its own secret. */
export const minimumAuthSecretLength = 32

/** Shortest password this package accepts; passed to Better Auth as well, so the two layers cannot disagree. */
export const minimumAuthPasswordLength = 8

/** Longest password this package accepts; passed to Better Auth as well, so the two layers cannot disagree. */
export const maximumAuthPasswordLength = 128

// These are also Better Auth's own model keys at the pinned version, which is what lets the
// conformance gate line `getAuthTables()` up against the shipped schema key by key.
/** Every table the shipped Drizzle schema defines, in both user-scoped and org-scoped mode; the flag never removes one. */
export const hearthkitAuthTableNames = [
  'user',
  'session',
  'account',
  'verification',
  'organization',
  'member',
  'invitation',
] as const

/** One of the seven auth table names; used by the table presence check and by anything asserting the migration ran. */
export const hearthkitAuthTableNameSchema = z.enum(hearthkitAuthTableNames)

/** Name of one auth table; the literal union, so a typo cannot pass as a table name. */
export type HearthkitAuthTableName = z.infer<typeof hearthkitAuthTableNameSchema>

// Control characters are excluded from display values so a newline cannot be smuggled into a header or a log line.
const controlCharacterPattern = /\p{Cc}/u

// Absolute http(s) URL, or a same-origin path beginning with a single slash. Better Auth accepts both as a callback.
const callbackUrlPattern = /^(?:https?:\/\/[^\s]+|\/[^\s]*)$/

/** Environment variable name; a local restatement of config's rule so this file imports no hearthkit package at runtime. */
export const authEnvVariableNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/)

/** Value of AUTH_SECRET; a secret, so it never appears in a failure, a log line, or any returned value but the runtime config. */
export const authSecretSchema = z.string().min(minimumAuthSecretLength).brand<'AuthSecret'>()

/** Branded signing secret; treat every value of this type as a secret that must not be printed. */
export type AuthSecret = z.infer<typeof authSecretSchema>

/** Value of AUTH_BASE_URL; an http(s) origin with an empty path, so pasting the full /api/auth URL is rejected at boot. */
export const authBaseUrlSchema = z
  .url({ protocol: /^https?$/ })
  .refine((baseUrl) => new URL(baseUrl).pathname === '/')
  .brand<'AuthBaseUrl'>()

/** Branded application origin; every magic link and OAuth redirect is built from it, so it must match the deployed host. */
export type AuthBaseUrl = z.infer<typeof authBaseUrlSchema>

/** Social provider this package can enable; only these two, and only when both of their variables are set. */
export const socialAuthProviderNameSchema = z.enum(['google', 'github'])

/** Name of a social provider; carried by the incomplete OAuth config failure so a reader knows which pair is broken. */
export type SocialAuthProviderName = z.infer<typeof socialAuthProviderNameSchema>

/** OAuth client id; public by design, so it may appear in a failure message. */
export const oauthClientIdSchema = z.string().min(1).brand<'OauthClientId'>()

/** Branded OAuth client id; half of a pair that is meaningless without its secret. */
export type OauthClientId = z.infer<typeof oauthClientIdSchema>

/** OAuth client secret; a secret, so it never appears in a failure, a log line, or any returned value but the runtime config. */
export const oauthClientSecretSchema = z.string().min(1).brand<'OauthClientSecret'>()

/** Branded OAuth client secret; treat every value of this type as a secret that must not be printed. */
export type OauthClientSecret = z.infer<typeof oauthClientSecretSchema>

/** Email address that identifies a user account; the same brand email uses, so one parsed address flows through both packages. */
export const authUserEmailSchema = z.email().brand<'EmailAddress'>()

/** Branded account email; produced by parsing an untrusted string, never by casting one. */
export type AuthUserEmail = z.infer<typeof authUserEmailSchema>

/** Password for the email and password method; a secret, and never echoed back in a failure reason. */
export const authPasswordSchema = z
  .string()
  .min(minimumAuthPasswordLength)
  .max(maximumAuthPasswordLength)
  .brand<'AuthPassword'>()

/** Branded password; treat every value of this type as a secret that must not be printed. */
export type AuthPassword = z.infer<typeof authPasswordSchema>

/** Display name of a user; one to one hundred and twenty-eight characters with no control characters. */
export const authUserNameSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((userName) => !controlCharacterPattern.test(userName))
  .brand<'AuthUserName'>()

/** Branded user display name; required at sign up because Better Auth's email and password method requires it. */
export type AuthUserName = z.infer<typeof authUserNameSchema>

/** Identifier of a user row; opaque, generated by Better Auth, so never parse or construct one. */
export const authUserIdSchema = z.string().min(1).brand<'AuthUserId'>()

/** Branded user id; the value payments will later key a customer on. */
export type AuthUserId = z.infer<typeof authUserIdSchema>

/** Identifier of a session row; opaque, generated by Better Auth, so never parse or construct one. */
export const authSessionIdSchema = z.string().min(1).brand<'AuthSessionId'>()

/** Branded session id; identifies a session row, and is not the credential that authenticates a request. */
export type AuthSessionId = z.infer<typeof authSessionIdSchema>

/** Identifier of an organization row; opaque, generated by Better Auth, so never parse or construct one. */
export const authOrganizationIdSchema = z.string().min(1).brand<'AuthOrganizationId'>()

/** Branded organization id; the value payments will later key an org-scoped subscription on. */
export type AuthOrganizationId = z.infer<typeof authOrganizationIdSchema>

/** Identifier of a membership row; opaque, generated by Better Auth, so never parse or construct one. */
export const authMemberIdSchema = z.string().min(1).brand<'AuthMemberId'>()

/** Branded membership id; one row joining a user to an organization with a role. */
export type AuthMemberId = z.infer<typeof authMemberIdSchema>

/** Display name of an organization; one to one hundred and twenty-eight characters with no control characters. */
export const authOrganizationNameSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((organizationName) => !controlCharacterPattern.test(organizationName))
  .brand<'AuthOrganizationName'>()

/** Branded organization display name; free text, unlike the slug, which is an identifier. */
export type AuthOrganizationName = z.infer<typeof authOrganizationNameSchema>

/** Slug of an organization; lowercase kebab-case, at most 63 characters, the same shape hearthkit project names use. */
export const authOrganizationSlugSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(63)
  .brand<'AuthOrganizationSlug'>()

/** Branded organization slug; unique across the database, so a second organization cannot claim the same one. */
export type AuthOrganizationSlug = z.infer<typeof authOrganizationSlugSchema>

/** How long a magic link stays usable, in whole seconds, from one second to seven days. */
export const magicLinkExpirySecondsSchema = z
  .number()
  .int()
  .min(1)
  .max(maximumMagicLinkExpirySeconds)

/** Role of a member inside an organization; Better Auth's three built-in roles and no others. */
export const authMemberRoleSchema = z.enum(['owner', 'admin', 'member'])

/** Membership role; owner can do anything, admin cannot delete the organization, member can only read. */
export type AuthMemberRole = z.infer<typeof authMemberRoleSchema>

/** Request Cookie header value that authenticates the next call; a bearer credential, so it must never be logged. */
export const authSessionCookieSchema = z.string().min(1).brand<'AuthSessionCookie'>()

/** Branded session cookie; ready to pass as `new Headers({ cookie: authSessionCookie })`, never a raw Set-Cookie line. */
export type AuthSessionCookie = z.infer<typeof authSessionCookieSchema>

/** A signed-in user as this package reports it; field names are Better Auth's own, so server and browser agree. */
export const authUserSchema = z.object({
  id: authUserIdSchema,
  email: authUserEmailSchema,
  name: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullish(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

/** User record returned by every sign-in, sign-up and session read; timestamps are always Date values. */
export type AuthUser = z.infer<typeof authUserSchema>

/** A live session as this package reports it; the session token is deliberately absent, because a result value gets logged. */
export const authSessionSchema = z.object({
  id: authSessionIdSchema,
  userId: authUserIdSchema,
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  ipAddress: z.string().nullish(),
  userAgent: z.string().nullish(),
  activeOrganizationId: authOrganizationIdSchema.nullish(),
})

/** Session record returned by reading a session; activeOrganizationId is null in user-scoped mode and set in org-scoped mode. */
export type AuthSession = z.infer<typeof authSessionSchema>

/** Env schema fragment this package contributes to config; the OAuth halves are optional here and paired by the resolver. */
export const authEnvSchemaFragment = z.object({
  AUTH_SECRET: authSecretSchema,
  AUTH_BASE_URL: authBaseUrlSchema,
  GOOGLE_CLIENT_ID: oauthClientIdSchema.optional(),
  GOOGLE_CLIENT_SECRET: oauthClientSecretSchema.optional(),
  GITHUB_CLIENT_ID: oauthClientIdSchema.optional(),
  GITHUB_CLIENT_SECRET: oauthClientSecretSchema.optional(),
})

/** Validated values of this package's variables, as config returns them; the input to resolveAuthRuntimeConfig. */
export type AuthEnvValues = z.output<typeof authEnvSchemaFragment>

/** One social provider with both halves present; a half-filled provider is never representable as this value. */
export const socialAuthProviderConfigSchema = z.object({
  socialProviderName: socialAuthProviderNameSchema,
  oauthClientId: oauthClientIdSchema,
  oauthClientSecret: oauthClientSecretSchema,
})

/** Fully configured social provider; the list of these is what decides which social buttons an app can show. */
export type SocialAuthProviderConfig = z.infer<typeof socialAuthProviderConfigSchema>

/** Everything the server instance needs from the environment, with the OAuth pairing already checked. */
export const authRuntimeConfigSchema = z.object({
  authSecret: authSecretSchema,
  authBaseUrl: authBaseUrlSchema,
  socialAuthProviders: z.array(socialAuthProviderConfigSchema),
})

/** Resolved runtime config; the one value that legitimately carries the signing secret and the OAuth secrets. */
export type AuthRuntimeConfig = z.infer<typeof authRuntimeConfigSchema>

/** Which caller-supplied value a request was rejected for; the reason never repeats the value itself. */
export const authInvalidFieldNameSchema = z.enum([
  'email',
  'password',
  'name',
  'callback-url',
  'magic-link-url',
  'product-name',
  'magic-link-expiry-seconds',
  'organization-name',
  'organization-slug',
  'member-role',
  'user-id',
  'organization-id',
])

/** Name of the field a call was rejected for; a gate asserts on this rather than on message text. */
export type AuthInvalidFieldName = z.infer<typeof authInvalidFieldNameSchema>

/** One requested social provider whose credential pair is not complete, with every variable it is missing. */
export const incompleteSocialProviderSchema = z.object({
  socialProviderName: socialAuthProviderNameSchema,
  missingVariableNames: z.array(authEnvVariableNameSchema).min(1),
})

/** One provider's missing credentials; carried in a list so one call names every broken provider at once. */
export type IncompleteSocialProvider = z.infer<typeof incompleteSocialProviderSchema>

/** Failure when a requested social provider has none or only one of its two variables; names every missing variable at once. */
export const authOauthConfigIncompleteFailureSchema = z.object({
  kind: z.literal('auth-oauth-provider-config-incomplete'),
  incompleteSocialProviders: z.array(incompleteSocialProviderSchema).min(1),
  message: z.string().startsWith(authOauthConfigIncompleteErrorPrefix),
})

/** Failure when the email and password pair does not match an account; never says which half was wrong. */
export const authInvalidCredentialsFailureSchema = z.object({
  kind: z.literal('auth-invalid-credentials'),
  message: z.string().startsWith(authInvalidCredentialsErrorPrefix),
})

/** Failure when a magic link token is expired, already consumed, or unknown; Better Auth reports all three identically. */
export const authMagicLinkInvalidFailureSchema = z.object({
  kind: z.literal('auth-magic-link-invalid'),
  // The `error` query parameter of the redirect location, which is the only place the value exists.
  betterAuthErrorValue: z.string().min(1),
  message: z.string().startsWith(authMagicLinkInvalidErrorPrefix),
})

/** Failure when a caller-supplied value is rejected; produced before any database or transport is contacted. */
export const authInputInvalidFailureSchema = z.object({
  kind: z.literal('auth-input-invalid'),
  invalidFieldName: authInvalidFieldNameSchema,
  invalidFieldReason: z.string().min(1),
  message: z.string().startsWith(authInputInvalidErrorPrefix),
})

/** Failure when a sign up names an email address that already has an account; the caller should offer sign in instead. */
export const authEmailAlreadyRegisteredFailureSchema = z.object({
  kind: z.literal('auth-email-already-registered'),
  message: z.string().startsWith(authEmailAlreadyRegisteredErrorPrefix),
})

/** Failure when the email package could not send the message; carries the email failure so the real cause is not lost. */
export const authEmailSendFailedFailureSchema = z.object({
  kind: z.literal('auth-email-send-failed'),
  emailFailureKind: z.custom<EmailFailure['kind']>(
    (value) => typeof value === 'string' && value.length > 0,
  ),
  emailFailureDetail: z.string().min(1),
  message: z.string().startsWith(authEmailSendFailedErrorPrefix),
})

/** Failure when an organization call is made on an instance built with organizations off; the schema still has the tables. */
export const authOrganizationsDisabledFailureSchema = z.object({
  kind: z.literal('auth-organizations-disabled'),
  message: z.string().startsWith(authOrganizationsDisabledErrorPrefix),
})

// Every producer escapes as a raw DrizzleQueryError, not as an APIError, and the DrizzleQueryError
// itself carries no code. The code is one `.cause` hop down, and exactly four values map here:
// `ECONNREFUSED` on an AggregateError when the server refuses, and on a pg DatabaseError `42P01`
// when a table is absent, `3D000` when the named database does not exist, `28P01` when the password
// is wrong. Those four are an allowlist, not "any cause carrying a code": `23505` is a unique
// violation, which is a caller error rather than an unavailable database, and the organization slug
// path can race into one. Every other code stays in auth-request-failed.
/** Failure when Postgres refuses, password or database is wrong, or migrations never ran. */
export const authDatabaseUnavailableFailureSchema = z.object({
  kind: z.literal('auth-database-unavailable'),
  databaseFailureDetail: z.string().min(1),
  message: z.string().startsWith(authDatabaseUnavailableErrorPrefix),
})

/** Catch-all failure for anything this package cannot classify; it exists so no call ever throws instead of returning. */
export const authRequestFailedFailureSchema = z.object({
  kind: z.literal('auth-request-failed'),
  // From `error.body?.code`. `error.code` is always undefined, never read it. The optional chain is
  // required, not stylistic: `error.body` is itself `undefined` on at least one measured APIError
  // (createOrganization called with a headers option, 401), so a plain `error.body.code` throws a
  // TypeError out of the handler and breaks this package's "never throws" promise.
  authErrorCode: z.string().min(1).optional(),
  // From `error.statusCode`, the number. `error.status` is the string name, such as 'UNAUTHORIZED'.
  authErrorStatus: z.number().int().optional(),
  authFailureDetail: z.string().min(1),
  message: z.string().startsWith(authRequestFailedErrorPrefix),
})

/** Every way an auth call can fail; each variant's message starts with its unique prefix and names the value at fault. */
export const authFailureSchema = z.discriminatedUnion('kind', [
  authOauthConfigIncompleteFailureSchema,
  authInvalidCredentialsFailureSchema,
  authMagicLinkInvalidFailureSchema,
  authInputInvalidFailureSchema,
  authEmailAlreadyRegisteredFailureSchema,
  authEmailSendFailedFailureSchema,
  authOrganizationsDisabledFailureSchema,
  authDatabaseUnavailableFailureSchema,
  authRequestFailedFailureSchema,
])

/** Discriminated failure union returned, never thrown, by every public function of this package. */
export type AuthFailure = z.infer<typeof authFailureSchema>

// `headers` is not uniformly optional across the endpoints this package wraps, and the three
// behaviours were measured at better-auth@1.7.2. `signInMagicLink` and `magicLinkVerify` REQUIRE it:
// omit it and the call throws APIError 400 `VALIDATION_ERROR` with the message `Headers is required`,
// even though nothing about those calls is session-scoped. `createOrganization` must be called
// WITHOUT it: passing `new Headers()` throws UNAUTHORIZED 401 with `body: undefined` and an empty
// message. `addMember` tolerates either. Only those symptoms were measured; the likely cause is that
// a headers option makes the endpoint resolve a session rather than take the owner from
// `body.userId`. A 401 with no message and no body reads like a bug in the caller's own code, which
// is why the shape of it is recorded here rather than left to be rediscovered.
/** How a server endpoint is called on the Better Auth instance; body, query and headers are separate keys on the server. */
export type AuthServerApiCallOptions = {
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Headers
  asResponse?: boolean
  returnHeaders?: boolean
}

/** The Better Auth server instance; the concrete value this package returns is typed more precisely and keeps its autocomplete. */
export type AuthServerInstance = {
  handler: (request: Request) => Promise<Response>
  api: Record<string, (callOptions?: AuthServerApiCallOptions) => Promise<unknown>>
}

/** Runtime check that a value is a Better Auth server instance; only the two members this package relies on are checked. */
export const authServerInstanceSchema = z.custom<AuthServerInstance>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'handler' in value &&
    typeof value.handler === 'function' &&
    'api' in value &&
    typeof value.api === 'object',
)

/** Runtime check that a value behaves like a web Headers object; duck-typed so Next's read-only headers pass too. */
export const authRequestHeadersSchema = z.custom<Headers>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    typeof value.get === 'function',
)

/** Runtime check that a value is a Drizzle node-postgres client; the precise schema type lives on the option types. */
export const authDrizzleClientSchema = z.custom<NodePgDatabase<Record<string, unknown>>>(
  (value) => typeof value === 'object' && value !== null,
)

/** Runtime shape of resolveAuthRuntimeConfig options; authEnv is the slice of config this package's fragment produced. */
export const resolveAuthRuntimeConfigOptionsSchema = z.object({
  authEnv: authEnvSchemaFragment,
  requestedSocialProviders: z.array(socialAuthProviderNameSchema).optional(),
})

/** Options type for resolveAuthRuntimeConfig; pass the whole config object, extra keys are ignored. */
export type ResolveAuthRuntimeConfigOptions = {
  authEnv: AuthEnvValues
  requestedSocialProviders?: readonly SocialAuthProviderName[]
}

/** Success shape of resolveAuthRuntimeConfig; module-private, reachable only through the result union below. */
const authRuntimeConfigResolvedSchema = z.object({
  kind: z.literal('auth-runtime-config-resolved'),
  authRuntimeConfig: authRuntimeConfigSchema,
})

/** Full result union of resolveAuthRuntimeConfig for runtime validation in gates. */
export const resolveAuthRuntimeConfigResultSchema = z.union([
  authRuntimeConfigResolvedSchema,
  authFailureSchema,
])

/** Result type of resolveAuthRuntimeConfig. */
export type ResolveAuthRuntimeConfigResult = z.infer<typeof resolveAuthRuntimeConfigResultSchema>

/** Signature of resolveAuthRuntimeConfig: synchronous, contacts nothing, never throws, run once at boot. */
export type ResolveAuthRuntimeConfig = (
  options: ResolveAuthRuntimeConfigOptions,
) => ResolveAuthRuntimeConfigResult

/** Runtime shape of createAuthServerInstance options; organizationsEnabled is the scaffold flag, never an env variable. */
export const createAuthServerInstanceOptionsSchema = z.object({
  authRuntimeConfig: authRuntimeConfigSchema,
  drizzleClient: authDrizzleClientSchema,
  emailTransportConfig: z.custom<EmailTransportConfig>(
    (value) => typeof value === 'object' && value !== null,
  ),
  organizationsEnabled: z.boolean(),
  productName: z.string().optional(),
  magicLinkExpirySeconds: magicLinkExpirySecondsSchema.optional(),
})

/** Options type for createAuthServerInstance; productName is a plain string parsed by email's own product name rule. */
export type CreateAuthServerInstanceOptions = {
  authRuntimeConfig: AuthRuntimeConfig
  drizzleClient: NodePgDatabase<Record<string, unknown>>
  emailTransportConfig: EmailTransportConfig
  organizationsEnabled: boolean
  productName?: string
  magicLinkExpirySeconds?: number
}

/** Success shape of createAuthServerInstance; module-private, the instance carries the organization endpoints only when the flag was on. */
const authServerInstanceCreatedSchema = z.object({
  kind: z.literal('auth-server-instance-created'),
  authServerInstance: authServerInstanceSchema,
  organizationsEnabled: z.boolean(),
})

/** Full result union of createAuthServerInstance for runtime validation in gates. */
export const createAuthServerInstanceResultSchema = z.union([
  authServerInstanceCreatedSchema,
  authFailureSchema,
])

/** Result type of createAuthServerInstance. */
export type CreateAuthServerInstanceResult = z.infer<typeof createAuthServerInstanceResultSchema>

/** Signature of createAuthServerInstance: synchronous so an app can build it at module scope, and it opens no connection. */
export type CreateAuthServerInstance = (
  options: CreateAuthServerInstanceOptions,
) => CreateAuthServerInstanceResult

/** Runtime shape of createAuthRouteHandlers options; the instance must be the one this package built. */
export const createAuthRouteHandlersOptionsSchema = z.object({
  authServerInstance: authServerInstanceSchema,
})

/** Options type for createAuthRouteHandlers. */
export type CreateAuthRouteHandlersOptions = {
  authServerInstance: AuthServerInstance
}

/** One Next.js App Router route handler; it takes the web Request and answers with a web Response. */
export type AuthRouteHandler = (request: Request) => Promise<Response>

/** The five method handlers a Next.js catch-all route file re-exports; Better Auth only routes GET and POST today. */
export type AuthRouteHandlers = {
  GET: AuthRouteHandler
  POST: AuthRouteHandler
  PUT: AuthRouteHandler
  PATCH: AuthRouteHandler
  DELETE: AuthRouteHandler
}

/** Runtime check that all five method handlers are present and callable. */
export const authRouteHandlersSchema = z.object({
  GET: z.custom<AuthRouteHandler>((value) => typeof value === 'function'),
  POST: z.custom<AuthRouteHandler>((value) => typeof value === 'function'),
  PUT: z.custom<AuthRouteHandler>((value) => typeof value === 'function'),
  PATCH: z.custom<AuthRouteHandler>((value) => typeof value === 'function'),
  DELETE: z.custom<AuthRouteHandler>((value) => typeof value === 'function'),
})

/** Signature of createAuthRouteHandlers: synchronous, cannot fail, and the app re-exports the result from route.ts. */
export type CreateAuthRouteHandlers = (options: CreateAuthRouteHandlersOptions) => AuthRouteHandlers

/** What the browser useSession hook reports; data is null when nobody is signed in, which is not an error. */
export type AuthSessionSnapshot = { session: AuthSession; user: AuthUser } | null

// `createAuthClient` returns a PROXY WHOSE TARGET IS A FUNCTION, measured at better-auth@1.7.2, and
// two consequences of that are invisible in the member list below. First, `typeof client` is
// 'function', not 'object'. Second, the Proxy answers EVERY property access with a function, so
// `typeof client.signIn` is 'function' rather than the object this type names, and
// `typeof client.definitelyNotAPlugin` is 'function' as well. The members here are Better Auth's own
// declared types, which is what a caller who annotates with this alias sees; they are not a
// description of what a runtime `typeof` returns for each one.
/** The Better Auth browser client; the concrete value this package returns is typed more precisely and keeps its autocomplete. */
export type AuthBrowserClient = {
  useSession: () => {
    data: AuthSessionSnapshot
    isPending: boolean
    error: { message?: string; status?: number; code?: string } | null
    refetch: () => void
  }
  signIn: Record<string, unknown>
  signUp: Record<string, unknown>
  signOut: () => Promise<unknown>
  getSession: () => Promise<unknown>
  // Readable at runtime in BOTH modes, because the Proxy answers every property access. It stays
  // OPTIONAL even though a runtime read never returns undefined: TypeScript sees the organization
  // methods only when organizationClient() is in the plugin list, so making this required would
  // reject the flag-off client at the annotation site. That leaves a type which reads like a
  // feature test and is not one, so the consequence is stated rather than left to be discovered:
  // `if (client.organization)` always takes the true branch and `typeof
  // client.organization.create` is always 'function', so neither separates the two modes. The
  // flag's observable effect is at the network boundary, and it is pinned as a PAIR:
  // organizationRouteAbsentHttpStatus from a server built with the flag off, against
  // organizationRouteUnauthorizedHttpStatus from one built with it on and no session on the request.
  organization?: Record<string, unknown>
}

// ONLY THE ROOT VALUE CAN BE ASSERTED. Every deeper property check is VACUOUS against a blanket
// Proxy: `typeof value.useSession === 'function'` passes against a client that has no `useSession` at
// all, because `typeof value.definitelyNotAPlugin` is 'function' too. Do not "harden" this schema
// with property checks — they assert nothing while reading as though they do, which is worse than no
// check. `typeof value === 'function'` is the one measured, non-vacuous fact available, and it rules
// out null on its own. It is pinned to 'function' rather than widened to accept 'object' as well so
// that a release which stops proxying fails this check loudly, instead of leaving behind a check that
// accepts any non-null value forever.
/** Runtime check that a value is a Better Auth browser client; only the root is checkable, because the client is a blanket Proxy. */
export const authBrowserClientSchema = z.custom<AuthBrowserClient>(
  (value) => typeof value === 'function',
)

/** Runtime shape of createAuthBrowserClient options; baseUrl is omitted for a same-origin app, which is the normal case. */
export const createAuthBrowserClientOptionsSchema = z.object({
  organizationsEnabled: z.boolean(),
  baseUrl: authBaseUrlSchema.optional(),
})

/** Options type for createAuthBrowserClient; pass the same organizationsEnabled value the server instance was built with. */
export type CreateAuthBrowserClientOptions = {
  organizationsEnabled: boolean
  baseUrl?: AuthBaseUrl
}

/** Signature of createAuthBrowserClient: synchronous, cannot fail, and contacts nothing until a hook or call runs. */
export type CreateAuthBrowserClient = (options: CreateAuthBrowserClientOptions) => AuthBrowserClient

/** Runtime shape of readAuthSession options; requestHeaders is whatever Next's headers() returned for this request. */
export const readAuthSessionOptionsSchema = z.object({
  authServerInstance: authServerInstanceSchema,
  requestHeaders: authRequestHeadersSchema,
})

/** Options type for readAuthSession. */
export type ReadAuthSessionOptions = {
  authServerInstance: AuthServerInstance
  requestHeaders: Headers
}

/** Success shape of readAuthSession when a valid session cookie was present; module-private. */
const authSessionActiveSchema = z.object({
  kind: z.literal('auth-session-active'),
  authSession: authSessionSchema,
  authUser: authUserSchema,
})

/** Success shape of readAuthSession when nobody is signed in; module-private, and a normal answer rather than a failure. */
const authSessionAbsentSchema = z.object({
  kind: z.literal('auth-session-absent'),
})

/** Full result union of readAuthSession for runtime validation in gates. */
export const readAuthSessionResultSchema = z.union([
  authSessionActiveSchema,
  authSessionAbsentSchema,
  authFailureSchema,
])

/** Result type of readAuthSession. */
export type ReadAuthSessionResult = z.infer<typeof readAuthSessionResultSchema>

/** Signature of readAuthSession: an expired or missing cookie is auth-session-absent, never a failure. */
export type ReadAuthSession = (options: ReadAuthSessionOptions) => Promise<ReadAuthSessionResult>

/** Runtime shape of signUpWithPassword options; email, password and name are plain strings because they come from a form. */
export const signUpWithPasswordOptionsSchema = z.object({
  authServerInstance: authServerInstanceSchema,
  email: z.string(),
  password: z.string(),
  name: z.string(),
})

/** Options type for signUpWithPassword; the three user-supplied values are validated before Postgres is touched. */
export type SignUpWithPasswordOptions = {
  authServerInstance: AuthServerInstance
  email: string
  password: string
  name: string
}

/** Success shape of signUpWithPassword; module-private, a session is always created because automatic sign in is pinned on. */
const authSignedUpSchema = z.object({
  kind: z.literal('auth-signed-up'),
  authUser: authUserSchema,
  authSessionCookie: authSessionCookieSchema,
})

/** Full result union of signUpWithPassword for runtime validation in gates. */
export const signUpWithPasswordResultSchema = z.union([authSignedUpSchema, authFailureSchema])

/** Result type of signUpWithPassword. */
export type SignUpWithPasswordResult = z.infer<typeof signUpWithPasswordResultSchema>

/** Signature of signUpWithPassword: creates the user and the first session in one call, and never throws. */
export type SignUpWithPassword = (
  options: SignUpWithPasswordOptions,
) => Promise<SignUpWithPasswordResult>

/** Runtime shape of signInWithPassword options; email and password are plain strings because they come from a form. */
export const signInWithPasswordOptionsSchema = z.object({
  authServerInstance: authServerInstanceSchema,
  email: z.string(),
  password: z.string(),
})

/** Options type for signInWithPassword. */
export type SignInWithPasswordOptions = {
  authServerInstance: AuthServerInstance
  email: string
  password: string
}

/** Success shape of signInWithPassword and completeMagicLinkSignIn; module-private, the cookie is the credential the next call needs. */
const authSignedInSchema = z.object({
  kind: z.literal('auth-signed-in'),
  authUser: authUserSchema,
  authSessionCookie: authSessionCookieSchema,
})

/** Full result union of signInWithPassword for runtime validation in gates. */
export const signInWithPasswordResultSchema = z.union([authSignedInSchema, authFailureSchema])

/** Result type of signInWithPassword. */
export type SignInWithPasswordResult = z.infer<typeof signInWithPasswordResultSchema>

/** Signature of signInWithPassword: a wrong email and a wrong password both give auth-invalid-credentials. */
export type SignInWithPassword = (
  options: SignInWithPasswordOptions,
) => Promise<SignInWithPasswordResult>

/** Runtime shape of requestMagicLinkSignIn options; callbackUrl is an absolute http(s) URL or a path starting with a slash. */
export const requestMagicLinkSignInOptionsSchema = z.object({
  authServerInstance: authServerInstanceSchema,
  email: z.string(),
  callbackUrl: z.string().regex(callbackUrlPattern).optional(),
})

/** Options type for requestMagicLinkSignIn; callbackUrl only shapes the emailed link, which carries a callbackURL either way. */
export type RequestMagicLinkSignInOptions = {
  authServerInstance: AuthServerInstance
  email: string
  callbackUrl?: string
}

/** Success shape of requestMagicLinkSignIn; module-private, the link itself is never returned, only that the message was accepted. */
const authMagicLinkSentSchema = z.object({
  kind: z.literal('auth-magic-link-sent'),
  to: authUserEmailSchema,
  transportMessageId: z.custom<TransportMessageId>(
    (value) => typeof value === 'string' && value.length > 0,
  ),
})

/** Full result union of requestMagicLinkSignIn for runtime validation in gates. */
export const requestMagicLinkSignInResultSchema = z.union([
  authMagicLinkSentSchema,
  authFailureSchema,
])

/** Result type of requestMagicLinkSignIn. */
export type RequestMagicLinkSignInResult = z.infer<typeof requestMagicLinkSignInResultSchema>

/** Signature of requestMagicLinkSignIn: an unknown address is still reported as sent, so the endpoint cannot enumerate users. */
export type RequestMagicLinkSignIn = (
  options: RequestMagicLinkSignInOptions,
) => Promise<RequestMagicLinkSignInResult>

/** Runtime shape of completeMagicLinkSignIn options; magicLinkUrl is the whole link, read from the plain text part of the email. */
export const completeMagicLinkSignInOptionsSchema = z.object({
  authServerInstance: authServerInstanceSchema,
  magicLinkUrl: z.string(),
})

/** Options type for completeMagicLinkSignIn; only the token is read out of the URL, and the link's callbackURL is dropped. */
export type CompleteMagicLinkSignInOptions = {
  authServerInstance: AuthServerInstance
  magicLinkUrl: string
}

/** Full result union of completeMagicLinkSignIn for runtime validation in gates. */
export const completeMagicLinkSignInResultSchema = z.union([authSignedInSchema, authFailureSchema])

/** Result type of completeMagicLinkSignIn; success is the same auth-signed-in value the password path returns. */
export type CompleteMagicLinkSignInResult = z.infer<typeof completeMagicLinkSignInResultSchema>

/** Signature of completeMagicLinkSignIn: consumes the token, so a second call with the same link always fails. */
export type CompleteMagicLinkSignIn = (
  options: CompleteMagicLinkSignInOptions,
) => Promise<CompleteMagicLinkSignInResult>

/** Runtime shape of createAuthOrganization options; ownerAuthUserId identifies the member row created with the owner role. */
export const createAuthOrganizationOptionsSchema = z.object({
  authServerInstance: authServerInstanceSchema,
  organizationName: z.string(),
  organizationSlug: z.string(),
  ownerAuthUserId: z.string(),
})

/** Options type for createAuthOrganization; this is the server-side provisioning path and needs no session headers. */
export type CreateAuthOrganizationOptions = {
  authServerInstance: AuthServerInstance
  organizationName: string
  organizationSlug: string
  ownerAuthUserId: string
}

/** Success shape of createAuthOrganization; module-private, the owner already has a membership row when this returns. */
const authOrganizationCreatedSchema = z.object({
  kind: z.literal('auth-organization-created'),
  authOrganizationId: authOrganizationIdSchema,
  organizationName: authOrganizationNameSchema,
  organizationSlug: authOrganizationSlugSchema,
  ownerAuthUserId: authUserIdSchema,
})

/** Full result union of createAuthOrganization for runtime validation in gates. */
export const createAuthOrganizationResultSchema = z.union([
  authOrganizationCreatedSchema,
  authFailureSchema,
])

/** Result type of createAuthOrganization. */
export type CreateAuthOrganizationResult = z.infer<typeof createAuthOrganizationResultSchema>

/** Signature of createAuthOrganization: fails with auth-organizations-disabled when the instance was built with the flag off. */
export type CreateAuthOrganization = (
  options: CreateAuthOrganizationOptions,
) => Promise<CreateAuthOrganizationResult>

/** Runtime shape of addAuthOrganizationMember options; the user must already exist, this call does not invite anyone. */
export const addAuthOrganizationMemberOptionsSchema = z.object({
  authServerInstance: authServerInstanceSchema,
  authOrganizationId: z.string(),
  authUserId: z.string(),
  memberRole: authMemberRoleSchema,
})

/** Options type for addAuthOrganizationMember; this is the server-side provisioning path and needs no session headers. */
export type AddAuthOrganizationMemberOptions = {
  authServerInstance: AuthServerInstance
  authOrganizationId: string
  authUserId: string
  memberRole: AuthMemberRole
}

/** Success shape of addAuthOrganizationMember; module-private, one membership row now joins the user to the organization. */
const authOrganizationMemberAddedSchema = z.object({
  kind: z.literal('auth-organization-member-added'),
  authMemberId: authMemberIdSchema,
  authOrganizationId: authOrganizationIdSchema,
  authUserId: authUserIdSchema,
  memberRole: authMemberRoleSchema,
})

/** Full result union of addAuthOrganizationMember for runtime validation in gates. */
export const addAuthOrganizationMemberResultSchema = z.union([
  authOrganizationMemberAddedSchema,
  authFailureSchema,
])

/** Result type of addAuthOrganizationMember. */
export type AddAuthOrganizationMemberResult = z.infer<typeof addAuthOrganizationMemberResultSchema>

/** Signature of addAuthOrganizationMember: fails with auth-organizations-disabled when the flag was off. */
export type AddAuthOrganizationMember = (
  options: AddAuthOrganizationMemberOptions,
) => Promise<AddAuthOrganizationMemberResult>

/** Runtime shape of verifyAuthTablesExist options; the client may be scoped to the project role, no admin rights are needed. */
export const verifyAuthTablesExistOptionsSchema = z.object({
  drizzleClient: authDrizzleClientSchema,
})

/** Options type for verifyAuthTablesExist. */
export type VerifyAuthTablesExistOptions = {
  drizzleClient: NodePgDatabase<Record<string, unknown>>
}

/** Result shape when every auth table is present in the public schema; module-private, holds in both modes. */
const authTablesPresentSchema = z.object({
  kind: z.literal('auth-tables-present'),
  presentTableNames: z.array(hearthkitAuthTableNameSchema).min(1),
})

/** Result shape when at least one auth table is absent; module-private, a successful check reporting a negative answer. */
const authTablesMissingSchema = z.object({
  kind: z.literal('auth-tables-missing'),
  missingTableNames: z.array(hearthkitAuthTableNameSchema).min(1),
})

/** Full result union of verifyAuthTablesExist for runtime validation in gates. */
export const verifyAuthTablesExistResultSchema = z.union([
  authTablesPresentSchema,
  authTablesMissingSchema,
  authFailureSchema,
])

/** Result type of verifyAuthTablesExist. */
export type VerifyAuthTablesExistResult = z.infer<typeof verifyAuthTablesExistResultSchema>

/** Signature of verifyAuthTablesExist: one query against information_schema, so it is safe to call from a health check. */
export type VerifyAuthTablesExist = (
  options: VerifyAuthTablesExistOptions,
) => Promise<VerifyAuthTablesExistResult>

// Each table object's property keys must be Better Auth's field names exactly, because the Drizzle
// adapter looks a column up as `schema[modelName][fieldName]`. The SQL column names underneath are
// Drizzle's business and are unconstrained here. The conformance gate checks the property keys.
/** The Drizzle table map this package ships; spread it into the app's schema so one drizzle-kit run covers every table. */
export type HearthkitAuthDrizzleSchema = Record<HearthkitAuthTableName, unknown>
