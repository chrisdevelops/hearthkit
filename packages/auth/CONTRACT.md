# @hearthkit/auth — contract

## Purpose

Better Auth 1.7 wired to `@hearthkit/db`'s Drizzle client and `@hearthkit/email`'s transport. It ships the server auth instance, the Next.js route handlers, the browser client with the session hooks, a session reader, one wrapper per plan 4.7 gate step, and the Drizzle table definitions for the auth tables. Email and password and magic link are always enabled; Google and GitHub only when both halves of their credential pair are set. The Drizzle schema defines the organization tables in every project whether or not the scaffold flag `organizations` is on: the flag decides which endpoints exist, never which tables exist, because changing the tables later would be a data migration. Every public function returns its failures as values; nothing here throws for a failure mode it names.

## Inputs

### Environment variables

| Name                   | Type                           | Required                  | Example                            |
| ---------------------- | ------------------------------ | ------------------------- | ---------------------------------- |
| `AUTH_SECRET`          | string, 32 characters or more  | required                  | `0123456789abcdef0123456789abcdef` |
| `AUTH_BASE_URL`        | http(s) URL with an empty path | required                  | `http://localhost:3000`            |
| `GOOGLE_CLIENT_ID`     | non-empty string               | optional, both or neither | `1234.apps.googleusercontent.com`  |
| `GOOGLE_CLIENT_SECRET` | non-empty string               | optional, both or neither | `GOCSPX-abc123`                    |
| `GITHUB_CLIENT_ID`     | non-empty string               | optional, both or neither | `Iv23abc123`                       |
| `GITHUB_CLIENT_SECRET` | non-empty string               | optional, both or neither | `ghs_abc123`                       |

Declared in `authEnvSchemaFragment` and composed by `@hearthkit/config` (empty string counts as unset). This package never reads `process.env` itself and always passes `secret` and `baseURL` to `betterAuth()` explicitly: Better Auth would read `AUTH_SECRET` from the environment on its own and fall back to a hardcoded literal, and it has no fallback named `AUTH_BASE_URL` at all. The empty-path rule on `AUTH_BASE_URL` rejects pasting the full `/api/auth` route URL into it, which would double the base path.

**"Both or neither" is enforced by `resolveAuthRuntimeConfig`, not by the fragment.** `composeEnvSchemaFragments` rebuilds a fresh `z.object` from `fragment.shape`, so a refinement on the fragment would be silently dropped. Every OAuth variable is optional in the fragment; the app calls the resolver immediately after config loads and its boot path throws the message. A provider is requested when the app names it in `requestedSocialProviders` or when either of its two variables is set. A requested provider with a missing half is `auth-oauth-provider-config-incomplete`, naming every missing variable of every incomplete provider in one call. A provider neither named nor half-set is absent from `socialAuthProviders`, which is not an error.

**The scaffold flag.** `organizations: true | false` is a parameter, not an environment variable. It is passed as `organizationsEnabled` to `createAuthServerInstance` and `createAuthBrowserClient`, so it is a literal in the generated app. It decides one thing: whether Better Auth's `organization()` plugin is in the server plugin list and `organizationClient()` in the browser plugin list. It never decides which tables the Drizzle schema defines. On the server the difference is structural: the organization endpoints are absent from `authServerInstance.api`. On the browser client it is not observable: the client is a Proxy that answers every property access with a function, so `authBrowserClient.organization` is readable in both modes and only a request reveals the mode (404 from a flag-off server, 401 without a session from a flag-on one). An app branches on its own `organizations` literal, never on the client's shape.

### Shared vocabulary

Reused unchanged: the Drizzle client type from `@hearthkit/db`; `EmailTransportConfig`, `EmailFailure` and `TransportMessageId` from `@hearthkit/email`; the env-fragment mechanism from `@hearthkit/config`.

- `AuthSecret`, `OauthClientSecret`, `AuthPassword` — branded secrets. They never appear in a failure, a log line or a returned value, except that `AuthRuntimeConfig` carries the first two because delivering them to `createAuthServerInstance` is its job. `AuthSecret` is 32 characters or more; `AuthPassword` is 8 to 128.
- `AuthBaseUrl` — branded; an http(s) URL with an empty path. `OauthClientId` — branded, public by design. `SocialAuthProviderName` — `google` or `github`. `SocialAuthProviderConfig` — a provider name with both halves, so a half-filled provider is unrepresentable. `AuthRuntimeConfig` — the secret, the base URL and the complete providers as one value; the input to `createAuthServerInstance`.
- `AuthUserEmail` — branded with the same `EmailAddress` tag `@hearthkit/email` uses, so a parsed address flows between the packages without a cast. The rule is restated here so `auth-contract.ts` imports only `zod` at runtime.
- `AuthUserName`, `AuthOrganizationName` — branded; 1 to 128 characters, no control characters. `AuthOrganizationSlug` — branded; lowercase kebab-case, at most 63 characters, the same shape as `HearthkitProjectName` in `cli`. `AuthUserId`, `AuthSessionId`, `AuthOrganizationId`, `AuthMemberId` — branded and opaque; Better Auth generates them, so never parse or construct one. `AuthMemberRole` — `owner`, `admin` or `member`.
- `AuthSessionCookie` — branded; the request `Cookie` header value ready for `new Headers({ cookie })`, not a `Set-Cookie` line. A bearer credential; never log it.
- `AuthUser`, `AuthSession` — the two records this package reports, with Better Auth's own field names (`id`, `userId`, `activeOrganizationId`) so server and browser agree. `AuthSession` omits the session `token`; `activeOrganizationId` is `null` in user-scoped mode.
- `AuthServerInstance`, `AuthBrowserClient`, `AuthRouteHandlers` — structural minimums. The values this package returns are typed more precisely by inference, so an app that keeps the inferred type keeps autocomplete; Better Auth exports no stable type for `betterAuth()`'s return.

### Public functions

Twelve functions and one value, `hearthkitAuthDrizzleSchema`, the Drizzle table map that always carries all seven tables. Synchronous, so an app calls them at module scope:

- `resolveAuthRuntimeConfig({ authEnv, requestedSocialProviders? })` — contacts nothing; pass the whole config object, extra keys are ignored. Run once at boot.
- `createAuthServerInstance({ authRuntimeConfig, drizzleClient, emailTransportConfig, organizationsEnabled, productName?, magicLinkExpirySeconds? })` — builds the instance; opens no connection. `productName` is parsed by email's product-name rule and printed in the mail copy. `magicLinkExpirySeconds` defaults to 300 and is capped at 604800 (seven days).
- `createAuthRouteHandlers({ authServerInstance })` — cannot fail. The app writes `app/api/auth/[...all]/route.ts` re-exporting the result.
- `createAuthBrowserClient({ organizationsEnabled, baseUrl? })` — cannot fail, contacts nothing until a hook or call runs. Omit `baseUrl` for a same-origin app.

Asynchronous, each returning its failures as values:

- `readAuthSession({ authServerInstance, requestHeaders })` — `requestHeaders` is what Next's `await headers()` returned; duck-typed on `.get`.
- `signUpWithPassword({ authServerInstance, email, password, name })` — creates the user and the first session.
- `signInWithPassword({ authServerInstance, email, password })`.
- `requestMagicLinkSignIn({ authServerInstance, email, callbackUrl? })` — sends the mail through `@hearthkit/email`. `callbackUrl` is an absolute http(s) URL or a path beginning with `/`. An unknown address is still reported as sent, so the endpoint cannot enumerate users.
- `completeMagicLinkSignIn({ authServerInstance, magicLinkUrl })` — takes the whole link, reads its `token` query parameter and consumes it. A second call with the same link always fails.
- `createAuthOrganization({ authServerInstance, organizationName, organizationSlug, ownerAuthUserId })` — server-side provisioning; needs no session headers, and the owner gets an `owner` membership row.
- `addAuthOrganizationMember({ authServerInstance, authOrganizationId, authUserId, memberRole })` — server-side provisioning; the user must already exist, nobody is invited.
- `verifyAuthTablesExist({ drizzleClient })` — one query against `information_schema.tables`.

User-supplied values (`email`, `password`, `name`, `callbackUrl`, `magicLinkUrl`, `organizationName`, `organizationSlug` and the ids) are plain `string` on the options objects and validated with `safeParse` before any service is contacted; a rejected value is `auth-input-invalid` naming the field. The branded types are what the success results carry back.

## Outputs

- `resolveAuthRuntimeConfig` → `{ kind: 'auth-runtime-config-resolved', authRuntimeConfig }` or a failure.
- `createAuthServerInstance` → `{ kind: 'auth-server-instance-created', authServerInstance, organizationsEnabled }` or a failure; the flag is echoed so a caller holding only the result knows which mode it built.
- `createAuthRouteHandlers` → `{ GET, POST, PUT, PATCH, DELETE }`, web `Request` in, web `Response` out. Better Auth routes only `GET` and `POST` today; the rest are returned because `toNextJsHandler` produces them.
- `createAuthBrowserClient` → the Better Auth browser client as `createAuthClient` builds it, with `magicLinkClient()` always and `organizationClient()` only when the flag is on. It always carries `useSession`, `signIn`, `signUp`, `signOut`, `getSession` and `signIn.magicLink`.
- `readAuthSession` → `{ kind: 'auth-session-active', authSession, authUser }`, `{ kind: 'auth-session-absent' }`, or a failure. An expired or missing cookie is absent, not a failure.
- `signUpWithPassword` → `{ kind: 'auth-signed-up', authUser, authSessionCookie }` or a failure.
- `signInWithPassword` and `completeMagicLinkSignIn` → `{ kind: 'auth-signed-in', authUser, authSessionCookie }` or a failure; one shape, because they are the same event by two routes.
- `requestMagicLinkSignIn` → `{ kind: 'auth-magic-link-sent', to, transportMessageId }` or a failure. The link is never returned; a gate reads it out of Mailpit.
- `createAuthOrganization` → `{ kind: 'auth-organization-created', authOrganizationId, organizationName, organizationSlug, ownerAuthUserId }` or a failure.
- `addAuthOrganizationMember` → `{ kind: 'auth-organization-member-added', authMemberId, authOrganizationId, authUserId, memberRole }` or a failure.
- `verifyAuthTablesExist` → `{ kind: 'auth-tables-present', presentTableNames }`, `{ kind: 'auth-tables-missing', missingTableNames }`, or a failure. Missing tables are a result, not a failure: reporting presence is the function's job.

### The magic link

The link `@hearthkit/email` sends always carries exactly two query parameters: `{AUTH_BASE_URL}/api/auth/magic-link/verify?token=<TOKEN>&callbackURL=%2F`. `callbackURL` is `%2F` when `callbackUrl` was omitted and the encoded value otherwise; there is no single-parameter case. React Email escapes `&` in the HTML part, so **extract the link from the plain text part of the Mailpit message, never the HTML part.** The template is email's shipped `magicLinkEmailTemplate` with `{ signInUrl, productName?, expiryMinutes? }`; `expiryMinutes` is `Math.floor(seconds / 60)` and is passed only when `magicLinkExpirySeconds` is 60 or more, because email's floor is one whole minute. `completeMagicLinkSignIn` sends only the token and drops the link's `callbackURL`, so success answers JSON with a `set-cookie` and any 302 from the call is a rejected token, landing on `/?error=INVALID_TOKEN`.

### The Drizzle schema

`hearthkitAuthDrizzleSchema` defines seven tables, listed in `hearthkitAuthTableNames`: `user`, `session`, `account`, `verification` (Better Auth core) and `organization`, `member`, `invitation` (organization plugin), plus the column `session.activeOrganizationId`. All seven and that column exist in every project whatever `organizationsEnabled` is. Each table object's property keys are Better Auth's field names, because the adapter resolves a column as `schema[modelName][fieldName]`; the SQL table names equal the model names, because `verifyAuthTablesExist` looks them up. The schema is table definitions, not SQL: the app spreads it into its own Drizzle schema and runs `drizzle-kit generate` once, so `@hearthkit/db`'s `runDatabaseMigrations` keeps one applied history. This package ships no migrations folder. `user` is a reserved word in Postgres; Drizzle quotes it, and raw SQL must too.

### Package entry point

`src/index.ts` is the package entry, a thin named re-export (no `export *`). Its value exports are a fixed allowlist of exactly these thirty-five, and nothing else. The thirteen plan-named implementation outputs:

1. `resolveAuthRuntimeConfig`
2. `createAuthServerInstance`
3. `createAuthRouteHandlers`
4. `createAuthBrowserClient`
5. `readAuthSession`
6. `signUpWithPassword`
7. `signInWithPassword`
8. `requestMagicLinkSignIn`
9. `completeMagicLinkSignIn`
10. `createAuthOrganization`
11. `addAuthOrganizationMember`
12. `verifyAuthTablesExist`
13. `hearthkitAuthDrizzleSchema`

The twenty-two contract values that live in `auth-contract.ts`:

14. `authEnvSchemaFragment`
15. `authFailureSchema`
16. `authRuntimeConfigSchema` — the input every server function takes after resolve
17. `resolveAuthRuntimeConfigResultSchema`
18. `createAuthServerInstanceResultSchema`
19. `readAuthSessionResultSchema`
20. `signUpWithPasswordResultSchema`
21. `signInWithPasswordResultSchema`
22. `requestMagicLinkSignInResultSchema`
23. `completeMagicLinkSignInResultSchema`
24. `createAuthOrganizationResultSchema`
25. `addAuthOrganizationMemberResultSchema`
26. `verifyAuthTablesExistResultSchema`
27. `authApiBasePath` — `templates/app`'s sign-in and account pages read it
28. `hearthkitAuthTableNames` — `templates/app`'s `drizzle.config.ts` reads it
29. `authUserIdSchema` — `payments` brands with the type
30. `authOrganizationIdSchema` — `payments` brands with the type
31. `authUserEmailSchema`
32. `authPasswordSchema`
33. `authUserNameSchema`
34. `authOrganizationNameSchema`
35. `authOrganizationSlugSchema`

`createAuthRouteHandlers` and `createAuthBrowserClient` cannot fail and have no result schema. Type exports are not counted and stay: every branded type under Shared vocabulary, `AuthUser`, `AuthSession`, `AuthEnvValues`, `AuthRuntimeConfig`, `AuthFailure`, `AuthInvalidFieldName`, `IncompleteSocialProvider`, `SocialAuthProviderConfig`, `AuthServerInstance`, `AuthServerApiCallOptions`, `AuthRouteHandler`, `AuthRouteHandlers`, `AuthBrowserClient`, `AuthSessionSnapshot`, `HearthkitAuthDrizzleSchema`, `HearthkitAuthTableName`, and each function's options, result and function types (`ResolveAuthRuntimeConfigOptions`, `ResolveAuthRuntimeConfigResult`, `ResolveAuthRuntimeConfig`, and likewise for the other eleven functions).

Every other value in `auth-contract.ts` is internal: the nine `*ErrorPrefix` constants; `betterAuthInvalidTokenErrorValue`, `betterAuthInvalidCredentialsErrorCode`, `betterAuthEmailAlreadyRegisteredErrorCode`, `betterAuthOrganizationAlreadyExistsErrorCode`, `betterAuthOrganizationAlreadyExistsHttpStatus`, `organizationRouteAbsentHttpStatus`, `organizationRouteUnauthorizedHttpStatus`, `defaultMagicLinkExpirySeconds`, `maximumMagicLinkExpirySeconds`, `minimumAuthSecretLength`, `minimumAuthPasswordLength`, `maximumAuthPasswordLength`, `magicLinkVerifyPathSuffix`, `magicLinkTokenQueryParameterName`, `magicLinkErrorQueryParameterName`; the nine per-variant `*FailureSchema`; the twelve `*OptionsSchema`; `authServerInstanceSchema`, `authRequestHeadersSchema`, `authDrizzleClientSchema`, `authRouteHandlersSchema`, `authBrowserClientSchema`, `authSessionCookieSchema`, `authUserSchema`, `authSessionSchema`, `socialAuthProviderConfigSchema`, `authInvalidFieldNameSchema`, `incompleteSocialProviderSchema`, `hearthkitAuthTableNameSchema`, `authEnvVariableNameSchema`, `authSecretSchema`, `authBaseUrlSchema`, `socialAuthProviderNameSchema`, `oauthClientIdSchema`, `oauthClientSecretSchema`, `authSessionIdSchema`, `authMemberIdSchema`, `magicLinkExpirySecondsSchema`, `authMemberRoleSchema`. The implementation and this package's own gates may import them from `auth-contract.ts` directly, but they are not part of the public surface and may change without a changeset. `authUserSchema` and `authSessionSchema` are internal because no app constructs a user or a session; an app receives them inside the result unions, and the `AuthUser` and `AuthSession` types stay public. The eleven per-arm success schemas (`authRuntimeConfigResolvedSchema`, `authServerInstanceCreatedSchema`, `authSessionActiveSchema`, `authSessionAbsentSchema`, `authSignedUpSchema`, `authSignedInSchema`, `authMagicLinkSentSchema`, `authOrganizationCreatedSchema`, `authOrganizationMemberAddedSchema`, `authTablesPresentSchema`, `authTablesMissingSchema`) are module-private inside `auth-contract.ts` and reachable only through the result unions; a caller that has narrowed a result on `kind` already holds the validated shape.

**The `./auth-contract` subpath.** The manifest publishes a second subpath, `./auth-contract`, because `@hearthkit/payments` imports the `AuthUserId` and `AuthOrganizationId` types from it and `templates/app` imports `authApiBasePath` and `hearthkitAuthTableNames` from it. It resolves to a JSX-free named re-export module, `src/auth-contract-entry.ts`, whose value exports are exactly the twenty-two allowlisted names that live in `auth-contract.ts` (items 14 to 35 above) plus every public type listed above. It carries none of the thirteen implementation outputs: the `.` entry imports `@hearthkit/email`'s `.` entry, which transitively imports `.tsx` template modules, plus `better-auth/next-js` and `better-auth/react`. `auth-contract.ts` and `auth-contract-entry.ts` import only `zod` at runtime (the `drizzle-orm/node-postgres` and `@hearthkit/email/email-contract` imports are type-only and erased), so each loads under bare `node` and importing either has no side effect.

## Failure modes

All failures are one discriminated union, `AuthFailure`, on `kind`. Every variant carries a `message` starting with its unique literal prefix.

| `kind`                                  | When                                    | Message prefix                             | Returned by                 |
| --------------------------------------- | --------------------------------------- | ------------------------------------------ | --------------------------- |
| `auth-oauth-provider-config-incomplete` | Requested provider missing a credential | `hearthkit auth oauth config incomplete:`  | resolve                     |
| `auth-invalid-credentials`              | Email and password match no account     | `hearthkit auth invalid credentials:`      | sign in                     |
| `auth-magic-link-invalid`               | Token expired, used, or unknown         | `hearthkit auth magic link invalid:`       | complete magic link         |
| `auth-input-invalid`                    | A caller-supplied value is rejected     | `hearthkit auth input invalid:`            | every function taking input |
| `auth-email-already-registered`         | Sign up email already has an account    | `hearthkit auth email already registered:` | sign up                     |
| `auth-email-send-failed`                | The email package could not send        | `hearthkit auth email send failed:`        | request magic link          |
| `auth-organizations-disabled`           | Instance was built with the flag off    | `hearthkit auth organizations disabled:`   | both organization calls     |
| `auth-database-unavailable`             | One of four connection or schema codes  | `hearthkit auth database unavailable:`     | every database call         |
| `auth-request-failed`                   | Anything else, so nothing throws        | `hearthkit auth request failed:`           | every function              |

### How a Better Auth signal becomes a failure

The mapping is part of the contract. Anything not listed lands in the catch-all.

| Better Auth signal                                                                   | Failure                         |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| 302 redirect whose `error` parameter is `INVALID_TOKEN`                              | `auth-magic-link-invalid`       |
| `APIError` with code `INVALID_EMAIL_OR_PASSWORD`                                     | `auth-invalid-credentials`      |
| `APIError` with code `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`                         | `auth-email-already-registered` |
| A `DrizzleQueryError` whose `.cause` has `ECONNREFUSED`, `42P01`, `3D000` or `28P01` | `auth-database-unavailable`     |
| An `EmailFailure` from `sendTransactionalEmail`                                      | `auth-email-send-failed`        |
| The endpoint is absent from `authServerInstance.api`                                 | `auth-organizations-disabled`   |
| Anything else                                                                        | `auth-request-failed`           |

- **Where each value is read**, because the obvious spelling returns `undefined` and routes everything into the catch-all: the code is `error.body?.code` (`error.code` is undefined, and `error.body` is itself undefined on some errors, so the optional chain is required); the status number is `error.statusCode` (`error.status` is the string name); a rejected magic link has no code at all, only the `error` query parameter of the redirect `location`, read as `error.headers.get('location')`; a database code is one `.cause` hop below a `DrizzleQueryError` that carries none itself. Codes are matched by exact equality, never substring: `USER_ALREADY_EXISTS` and `ORGANIZATION_SLUG_ALREADY_TAKEN` are real, adjacent near-misses these endpoints never throw.
- `auth-magic-link-invalid` covers expired, consumed and unknown tokens alike; Better Auth cannot tell them apart. It carries `betterAuthErrorValue`. A gate produces the expired case with `magicLinkExpirySeconds: 1` and the consumed case by verifying twice.
- `auth-input-invalid` carries `invalidFieldName` (an enum) and `invalidFieldReason`, which states the rule broken and never echoes the value. Password length is checked here with the same limits passed to `betterAuth()` as `minPasswordLength` and `maxPasswordLength`.
- `auth-email-already-registered` has a producer only because `requireEmailVerification` is off and `autoSignIn` is at its default `true`; either change makes Better Auth answer a duplicate sign-up with a generic success, an upstream anti-enumeration measure. Whoever changes either must re-home this failure.
- `auth-email-send-failed` carries `emailFailureKind` and `emailFailureDetail`, the `EmailFailure`'s own message, so a gate can assert the underlying email prefix. `auth-organizations-disabled` is detected structurally, by the endpoint being absent from `authServerInstance.api`, so it stays correct for an instance built by hand.
- `auth-database-unavailable` carries `databaseFailureDetail`. The four codes are an allowlist: `23505` (unique violation) is a caller error and stays in the catch-all, as does every other code. `auth-request-failed` carries `authErrorCode` and `authErrorStatus` when Better Auth supplied them, plus `authFailureDetail`; a slug collision arrives here with `ORGANIZATION_ALREADY_EXISTS` at 400, so a caller can branch on it.
- **Two upstream behaviours at the pin** constrain callers and gates: `signInMagicLink` and `magicLinkVerify` require a `headers` value while `createOrganization` must be called without one; and verifying a magic link for a user who already has a password deletes that user's `account` rows, so no gate may mix the two sign-in paths on one user and no password-linking flow may be built on this package.

## Dependencies

- Packages: `@hearthkit/config`, `@hearthkit/db` and `@hearthkit/email` as `workspace:*` runtime dependencies. `db` supplies the Drizzle client type; `email` supplies `sendTransactionalEmail` and the two shipped templates; `config` composes `authEnvSchemaFragment` and is never consumed at runtime.
- Runtime libraries (exact pins in `package.json`): `better-auth@1.7.2`, `@better-auth/drizzle-adapter@1.7.2`, `drizzle-orm@0.45.2`, `zod@4.4.3`. `react` and `react-dom` are peer dependencies; `next` is an optional peer for consumers and a devDependency here, because without it `nextCookies()` rethrows a module-resolution error and every cookie-setting call fails. `pg` and `@types/pg` are both declared, matching `db`, so the workspace keeps one `drizzle-orm` resolution; check by resolving the two `node_modules/drizzle-orm` paths, not by comparing a peer suffix. No `drizzle-kit`, no `@better-auth/cli`.
- Services for gates:
  - **Postgres 17** from the repo-root `docker-compose.yml`. Gates create a scratch database with `@hearthkit/db`'s `createProjectDatabase`, build the auth tables from `hearthkitAuthDrizzleSchema` itself through `getTableConfig`, run, and drop it.
  - **Mailpit** from the same compose file (SMTP `localhost:1025`, API `localhost:8025`); gates read the link from the text part of `GET /api/v1/message/{ID}`.
  - **A dead local port** for `ECONNREFUSED` and the SMTP refusal; **a changed connection string** for `3D000` and `28P01`; **a loopback listener** carrying `authServerInstance.handler` for the browser-client 404/401 pair (a `fetch` stub works only if installed before the client is constructed, because the client captures `fetch` then); **no service** for the OAuth, input, organizations-disabled, schema-conformance and shape gates.

## Out of scope

- **`@hearthkit/payments` (deferred, must not block).** No Stripe, no plan or subscription model here. `AuthUserId` and `AuthOrganizationId` are branded and on the subpath in both modes, and `member` exists in both, so payments keys a customer on whichever the flag selects. Better Auth's Stripe plugin is not configured; adding one is additive.
- **`@hearthkit/create` (deferred, must not block).** Its three inputs (`organizations`, `requestedSocialProviders`, `productName`) are already parameters; nothing here reads a file or a `.env`.
- **Passkeys, two-factor, admin, teams, dynamic roles (deferred, must not block).** Each is one plugin and an additive migration; `team`, `teamMember` and `organizationRole` are not in `hearthkitAuthTableNames`.
- **Email verification.** Pinned off; turning it on costs a template in `email`, one option here, and a new home for `auth-email-already-registered`.
- **Password reset wrappers and every other Better Auth endpoint** (sign out, account linking, invitations, session-scoped organization calls). `sendResetPassword` is wired to email's `passwordResetEmailTemplate`, so `authBrowserClient.requestPasswordReset()` sends real mail, but no wrapper is exported because plan 4.7 gates none; the rest are reachable on `authServerInstance.api.*` and the browser client. The wrappers are one per plan 4.7 gate step.
- **Sub-path mounts, session lifetime, cookie cache, rate limiting, trusted origins** (Better Auth defaults, each an additive option); **shipping SQL migrations, reading `process.env`, owning `NODE_ENV`, rendering UI** (the app generates migrations, config owns the environment, `ui` owns components, so this package ships no `.tsx`).

## Decisions

1. Twelve functions, each tied to a plan 4.7 output or gate step; `verifyAuthTablesExist` exists so "both modes from the start" is checkable against a live database and so `/health` can call it. The organizations flag is a parameter; the tables are unconditional.
2. Nine failure variants where the plan names three: input and duplicate email are the two ordinary sign-up outcomes, send-failed is the auth-to-email seam, organizations-disabled is the flag's guardrail, database-unavailable is every project's first-run state, request-failed makes "never throws" a promise. One `auth-input-invalid` with a field discriminator, because a caller handles every rejected field the same way.
3. A magic link for an unknown address reports success; `AuthSession` omits the token; the cookie and the link are never logged or returned beyond the one value that must carry them.
4. Gates derive DDL from `hearthkitAuthDrizzleSchema` through `getTableConfig`, and a conformance gate compares the schema's keys against `getAuthTables()` on every dependency bump; neither `drizzle-kit` nor `@better-auth/cli` is a dependency.
5. **The entry point is a fixed allowlist, not "everything the contract module exports"** (completion plan step 5, 2026-09-09). Prefixes, Better Auth literals, HTTP statuses, limits, options schemas and per-variant shapes are internal; constants whose only reader is a gate move to `test-fixtures/`. The `./auth-contract` subpath survives because `payments` and `templates/app` import it, and carries the same trimmed set.
