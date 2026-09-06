# @hearthkit/auth — contract

## Purpose

Better Auth 1.7 wired to `@hearthkit/db`'s Drizzle client and to `@hearthkit/email`'s transport. It ships the server auth instance, the Next.js route handler, the browser client that carries the session hooks, a session reader, and the Drizzle table definitions for the auth tables. Email and password and magic link are always enabled; Google and GitHub are enabled only when both halves of their credential pair are set. The Drizzle schema defines the organization tables in **every** project, whether or not the scaffold flag `organizations` is on, because that flag decides which endpoints exist, not which tables exist — changing the tables later would be a data migration, and plan section 4.7 says the package must support both modes from the start. Every public function returns its failures as values; nothing in this package throws for a failure mode it names.

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

Declared in `authEnvSchemaFragment` and composed by `@hearthkit/config` (empty string counts as unset, per config's contract). This package never reads `process.env` itself.

The names are the plan's, not Better Auth's, and the difference matters in two ways that a reader should not have to discover:

- Better Auth resolves its own `secret` from `process.env.BETTER_AUTH_SECRET` and then from `process.env.AUTH_SECRET`, falling back to a **hardcoded literal** when neither is set. So `AUTH_SECRET` happens to be a name it would pick up on its own. This package always passes `secret` to `betterAuth()` explicitly, so the ambient read never happens — and that is the point: if the explicit pass were ever dropped, the mistake would be invisible in development and only surface as a production boot error.
- Better Auth resolves `baseURL` from `process.env.BETTER_AUTH_URL` only. It has **no** fallback named `AUTH_BASE_URL`. Passing `baseURL` explicitly is therefore mandatory, not a courtesy; without it the instance falls back to inferring the origin from the request, which the Better Auth docs themselves advise against.

`AUTH_BASE_URL` must have an empty path. The mistake this catches is pasting the full route URL (`https://example.com/api/auth`) into it, which doubles the base path and breaks every link and redirect in a way that looks like a routing bug rather than a configuration one.

### How "both or neither" is enforced, given a flat fragment

`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` are pairs. Each half is meaningless alone, and plan 4.7 names "missing OAuth config when a provider is requested" as a failure mode, so the rule has to be enforced somewhere.

It is **not** enforced by a `.refine` on the fragment. `composeEnvSchemaFragments` iterates `Object.entries(fragment.shape)` and returns a brand-new `z.object(...)` built from the per-variable schemas alone, so a refinement attached to a fragment is silently discarded — not rejected, not errored, simply never run. A half-filled Google pair would sail through config exactly as if no rule had been written. This is the same defect `@hearthkit/email` hit, and it is recorded in `docs/STATUS.md`.

It is enforced the way `email` settled on: **both halves are optional in the fragment, and one exported function, `resolveAuthRuntimeConfig`, performs the pairing check at boot** and returns either a typed `AuthRuntimeConfig` or `auth-oauth-provider-config-incomplete` naming every missing variable for every incomplete provider at once. The app calls it immediately after config loads, and its boot path throws the message, so the process fails to start with the variable names in the text.

A provider is **requested** when either of these is true:

1. The app names it in `requestedSocialProviders`. This is the scaffold's way of saying "this project needs Google", so a deployment that forgot both variables fails at boot rather than silently rendering no Google button.
2. Either of its two variables is set. Setting one half is always a mistake, and the person who set it clearly intended the provider.

A requested provider that is not complete produces the failure, with `missingVariableNames` listing one variable when a half is present and both when neither is. Providers that are neither named nor half-set are simply absent from `socialAuthProviders`, which is not an error — a local `.env` with no OAuth credentials is the normal case, and plan section 6 says password and magic link need no client IDs.

### The scaffold flag

`organizations: true | false` is a **parameter**, not an environment variable. It is passed as `organizationsEnabled` to `createAuthServerInstance` and to `createAuthBrowserClient`, so it is a literal in the generated app's source. Making it an environment variable would let someone flip the data model of a running deployment, which is exactly what plan 4.7 warns about.

The flag decides one thing: whether Better Auth's `organization()` plugin is in the server plugin list and `organizationClient()` in the browser plugin list. It never decides which tables the Drizzle schema defines.

The two halves of that are not equally visible. On the **server** the difference is structural and can be read off the instance: the organization endpoints are genuinely absent from `authServerInstance.api` when the flag is off. On the **browser client** it cannot be read off the value at all, because the client is a blanket Proxy; the difference only shows when a call reaches the server. That asymmetry is set out under What the organizations flag does and does not change on the browser client, and it is why an app branches on its own literal rather than on the client.

### Shared vocabulary

Reused unchanged from the packages below this one: `PostgresConnectionString` and the Drizzle client from `@hearthkit/db`; `EmailTransportConfig`, `EmailFailure` and `TransportMessageId` from `@hearthkit/email`; the env-fragment mechanism from `@hearthkit/config`.

New here:

- `AuthSecret` — branded; 32 characters or more. A secret: it never appears in a failure, a log line, or any returned value except `AuthRuntimeConfig`.
- `AuthBaseUrl` — branded; an http(s) URL with an empty path. `http` is allowed so `http://localhost:3000` works in development.
- `SocialAuthProviderName` — `google` or `github`. No other provider is configurable here.
- `OauthClientId` — branded. Public by design, so it may appear in a message.
- `OauthClientSecret` — branded. A secret, same rule as `AuthSecret`.
- `SocialAuthProviderConfig` — a provider name with **both** halves, so a half-filled provider is unrepresentable.
- `AuthRuntimeConfig` — the secret, the base URL and the complete providers as one value. This is the one value that legitimately carries secrets, because carrying them to `createAuthServerInstance` is its entire job.
- `AuthUserEmail` — branded, and deliberately carries the **same brand tag** as `@hearthkit/email`'s `EmailAddress`, so a parsed address flows between the two packages without a cast. The parsing rule is restated here rather than imported for the same reason `email` restates config's variable-name rule: this file must stay loadable with `zod` alone at runtime. Restating a rule this package itself applies is the repo's precedent; values it merely carries through (`TransportMessageId`, `EmailTransportConfig`, `EmailFailure['kind']`) are type-only imports instead.
- `AuthPassword` — branded; 8 to 128 characters. A secret, and it is never echoed in a failure reason.
- `AuthUserName`, `AuthOrganizationName` — branded; 1 to 128 characters, no control characters.
- `AuthOrganizationSlug` — branded; lowercase kebab-case, at most 63 characters. Same shape as `HearthkitProjectName` in `cli` and `EmailTemplateName` in `email`.
- `AuthUserId`, `AuthSessionId`, `AuthOrganizationId`, `AuthMemberId` — branded and opaque. Better Auth generates them; never parse or construct one.
- `AuthMemberRole` — `owner`, `admin` or `member`. Better Auth's three built-in roles and no others.
- `AuthSessionCookie` — branded; the **request `Cookie` header value** (`name=value`, joined with `; ` when Better Auth sets more than one), ready to pass as `new Headers({ cookie: authSessionCookie })`. It is not a raw `Set-Cookie` line, because a `Set-Cookie` line carries attributes and cannot be sent back as-is. It is a bearer credential and must never be logged.
- `AuthUser`, `AuthSession` — the two records this package reports. Their field names are Better Auth's own (`id`, `userId`, `activeOrganizationId`, not renamed to `authUserId` and friends) so that a value read on the server and a value read from `useSession()` in the browser have one spelling. `AuthSession` deliberately omits the session `token`: a result value is exactly the sort of thing that ends up in a log line, and the token authenticates a request. `AuthSession.activeOrganizationId` is the column that makes org mode work; it is `null` in user-scoped mode and present in both, because the column exists in both.
- `AuthServerInstance`, `AuthBrowserClient`, `AuthRouteHandlers` — structural types. The concrete values this package returns are typed more precisely by TypeScript inference, so an app that keeps the inferred type keeps full autocomplete over `authServerInstance.api.*`; only code that annotates with the contract's alias narrows to the promised minimum. The contract stays this loose on purpose, because Better Auth exports no stable public type for the return of `betterAuth()` — its own docs tell you to write `export type Auth = typeof auth`. `AuthBrowserClient`'s members are Better Auth's own declared types and are **not** a description of what a runtime `typeof` returns for each one, because the client is a Proxy; see What the organizations flag does and does not change on the browser client.

### Public functions

Twelve functions and two values. Each one maps to a plan 4.7 output or a plan 4.7 gate step; the mapping is in Decisions.

Synchronous, so an app can call them at module scope in `lib/auth.ts`:

- `resolveAuthRuntimeConfig({ authEnv, requestedSocialProviders? })` — contacts nothing. `authEnv` is the validated config object; extra keys are ignored, so an app passes `config` straight through. Run once at boot.
- `createAuthServerInstance({ authRuntimeConfig, drizzleClient, emailTransportConfig, organizationsEnabled, productName?, magicLinkExpirySeconds? })` — builds the Better Auth instance. Opens no connection: the Drizzle client is lazy and this call does no I/O. `productName` is a plain string, parsed by `@hearthkit/email`'s own product-name rule, and printed in the mail copy. `magicLinkExpirySeconds` defaults to `defaultMagicLinkExpirySeconds` (300) and is capped at `maximumMagicLinkExpirySeconds` (604800), the same seven-day ceiling `email` prints in its templates.
- `createAuthRouteHandlers({ authServerInstance })` — cannot fail. The app writes `app/api/auth/[...all]/route.ts` containing `export const { GET, POST, PUT, PATCH, DELETE } = createAuthRouteHandlers({ authServerInstance })`.
- `createAuthBrowserClient({ organizationsEnabled, baseUrl? })` — cannot fail, contacts nothing until a hook or a call runs. Omit `baseUrl` for a same-origin app, which is every hearthkit project; it exists only for a split deployment.

Asynchronous, and each returns its failures as values:

- `readAuthSession({ authServerInstance, requestHeaders })` — `requestHeaders` is whatever Next's `await headers()` returned. Duck-typed on `.get`, so Next's read-only headers object passes.
- `signUpWithPassword({ authServerInstance, email, password, name })` — creates the user and the first session.
- `signInWithPassword({ authServerInstance, email, password })`.
- `requestMagicLinkSignIn({ authServerInstance, email, callbackUrl? })` — sends the mail through `@hearthkit/email`. `callbackUrl` is an absolute http(s) URL or a path beginning with `/`.
- `completeMagicLinkSignIn({ authServerInstance, magicLinkUrl })` — takes the whole link, reads the `token` query parameter out of it, and consumes it.
- `createAuthOrganization({ authServerInstance, organizationName, organizationSlug, ownerAuthUserId })` — the server-side provisioning path. It needs no session headers, and the named user gets an `owner` membership row.
- `addAuthOrganizationMember({ authServerInstance, authOrganizationId, authUserId, memberRole })` — the server-side provisioning path. The user must already exist; this does not invite anyone.
- `verifyAuthTablesExist({ drizzleClient })` — one query against `information_schema.tables`.

Values:

- `authEnvSchemaFragment` — the fragment config composes.
- `hearthkitAuthDrizzleSchema` — the Drizzle table map, always carrying all seven tables.

`email`, `password`, `name`, `callbackUrl`, `magicLinkUrl`, `organizationName`, `organizationSlug` and the id fields are typed as plain `string` on the options objects and validated at runtime before any service is contacted. This is the same deliberate departure `email` made for `to`: these are the values that always originate from user input, and validating them late produces a diagnostic that points at the wrong cause. The branded types still exist and are what the success results carry back.

Validation is `safeParse`, never `parse`. A rejected value is returned as `auth-input-invalid` naming the field; nothing in this package throws a Zod error at a caller.

## Outputs

- `resolveAuthRuntimeConfig` → `{ kind: 'auth-runtime-config-resolved', authRuntimeConfig }` or a failure.
- `createAuthServerInstance` → `{ kind: 'auth-server-instance-created', authServerInstance, organizationsEnabled }` or a failure. `organizationsEnabled` is echoed back so a caller holding only the result can tell which mode it built.
- `createAuthRouteHandlers` → `{ GET, POST, PUT, PATCH, DELETE }`, five functions taking a web `Request` and answering with a web `Response`. Better Auth routes only `GET` and `POST` today; the other three are returned because `toNextJsHandler` produces them, and returning fewer would silently break a future plugin that adds a route on another method.
- `createAuthBrowserClient` → the Better Auth browser client, exactly as `createAuthClient` builds it, with `magicLinkClient()` always in the plugin list and `organizationClient()` added only when `organizationsEnabled` is `true`. It always carries `useSession`, `signIn`, `signUp`, `signOut` and `getSession`, and `signIn.magicLink` always works because magic link is always enabled. **It also carries `organization` in both modes, and that is not a mistake** — see the next section, which is the one part of this contract an app author is most likely to get wrong.
- `readAuthSession` → `{ kind: 'auth-session-active', authSession, authUser }`, or `{ kind: 'auth-session-absent' }`, or a failure. **An expired or missing cookie is `auth-session-absent`, not a failure.** Nobody being signed in is a normal answer to "who is signed in", and modelling it as an error would make every server component's happy path go through a catch.
- `signUpWithPassword` → `{ kind: 'auth-signed-up', authUser, authSessionCookie }` or a failure.
- `signInWithPassword` and `completeMagicLinkSignIn` → `{ kind: 'auth-signed-in', authUser, authSessionCookie }` or a failure. The two share one success shape because they are the same event by two routes.
- `requestMagicLinkSignIn` → `{ kind: 'auth-magic-link-sent', to, transportMessageId }` or a failure. **The link is never returned.** It is a single-use sign-in credential and a result value gets logged; the same reason `email`'s send result withholds the message bodies. A gate reads the link out of Mailpit, which is what plan 4.7's gate says to do.
- `createAuthOrganization` → `{ kind: 'auth-organization-created', authOrganizationId, organizationName, organizationSlug, ownerAuthUserId }` or a failure.
- `addAuthOrganizationMember` → `{ kind: 'auth-organization-member-added', authMemberId, authOrganizationId, authUserId, memberRole }` or a failure.
- `verifyAuthTablesExist` → `{ kind: 'auth-tables-present', presentTableNames }`, or `{ kind: 'auth-tables-missing', missingTableNames }`, or a failure. `auth-tables-missing` is a **result**, not a failure: the function's whole job is to report presence, so a negative answer is a successful check.

### What the organizations flag does and does not change on the browser client

**The client is a Proxy whose target is a function, and it answers every property access.** Measured
at the pin with `organizationClient()` **absent**: `typeof authBrowserClient.organization` is
`'function'`, `typeof authBrowserClient.organization.create` is `'function'`, and
`typeof authBrowserClient.definitelyNotAPlugin` is `'function'` as well. The `in` operator does not
separate the two modes either: `'organization' in authBrowserClient` is `false` in **both**
configurations. There is no property read, no `typeof`, no truthiness check and no `in` test that
tells the two modes apart.

Three things follow, and each one has already been got wrong once.

1. **`authBrowserClientSchema` can only assert the root value.** `typeof value === 'function'`, which
   is what a Proxy over a function target reports. Every deeper check is **vacuous**:
   `typeof value.useSession === 'function'` passes against a client that has no `useSession` at all,
   because the Proxy answers a name no plugin ever defined the same way. A check that asserts nothing
   while reading as though it does is worse than no check, so **do not "harden" this schema with
   property checks.** The same sentence is a comment above the schema in `auth-contract.ts`, because
   that is where somebody will be standing when they think of it.
2. **An app author must not expect `authBrowserClient.organization` to be `undefined` in user-scoped
   mode.** `if (authBrowserClient.organization)` always takes the true branch. Feature detection on
   this client does not work. An app that needs to know which mode it is in branches on the same
   `organizations` literal the scaffold wrote, which it already has, because it passed it to both
   `createAuthServerInstance` and `createAuthBrowserClient`.
3. **The flag's observable effect is at the network boundary, not in the client's shape.** Build the
   browser client with `organizationsEnabled: false`, route its `organization.create` call to a server
   instance built with `organizationsEnabled: false`, and the server answers **404 with an empty
   body** — it has no such route. The property read never fails; the request does.

**A gate asserts that 404 together with its control, as a pair, because the control is the half that
carries the meaning.** One POST to `/api/auth/organization/create`, handed to
`authServerInstance.handler(request)`, was measured against both instances — the same request both
times:

| Server instance                          | Status  | Body  |
| ---------------------------------------- | ------- | ----- |
| built with `organizationsEnabled: false` | **404** | empty |
| built with `organizationsEnabled: true`  | **401** | empty |

The 404 on its own asserts very little, because a misspelled path returns 404 as well: a gate that
stopped there would keep passing after the route it means to probe stopped existing under that name.
**The 401 from the flag-on instance is the load-bearing half.** It is the identical request, with no
session on it, and it proves the route _exists_ and was rejected for want of a session rather than for
want of a route. Only with both does the 404 mean "this server has no organization endpoint at all".
This is the same reasoning `email`'s STARTTLS gate and `storage`'s presign gates already rest on: the
negative control is what stops the positive assertion being satisfiable by an unrelated mistake.

The failure arrives as the client's ordinary `{ data: null, error }` arm rather than as a thrown
value, because that is how every browser client call reports a non-2xx — and **that last step is now
measured through the real client, not taken from the documentation**. The gate points one client,
built with `organizationsEnabled: false`, at a loopback listener carrying each server instance in
turn, and reads `{ data: null, error: { status: 404 } }` from the flag-off server and
`{ status: 401 }` from the flag-on control, with the listener recording
`POST /api/auth/organization/create` both times. **Both bodies are empty**, so the status is the
whole of what a gate can match on and there is nothing further to assert. **`statusText` is not one
of the things to assert**: the same 401 reads `UNAUTHORIZED` handed straight to a fetch stub and
`Unauthorized` once Node's HTTP server has written it out, so it varies with how the response was
delivered rather than with what happened. The two
statuses are exported as `organizationRouteAbsentHttpStatus` and
`organizationRouteUnauthorizedHttpStatus`, so a gate names them instead of writing two bare numbers
whose relationship to each other is invisible. What stays ungated is the positive arm —
`organization.create` actually creating an organization through the route handler — because that path
is session-scoped by construction and needs a signed-in session cookie, which is why the server-side
provisioning path exists as a separate pair of functions.

Observing this needs the client's requests to reach the server instance, and **this package exposes no
option for that** — `createAuthBrowserClient` takes `organizationsEnabled` and `baseUrl` and nothing
else. A gate arranges the route itself, either by stubbing global `fetch` to call
`authServerInstance.handler(request)` or by putting the handler behind a real listener and pointing
`baseUrl` at it.

**Those two options look interchangeable and are not.** `createAuthClient` binds its fetch
implementation at **construction time**: at the pin, the client config passes `customFetchImpl: fetch`
into `createFetch`, capturing the value `globalThis.fetch` holds at the moment the client is built. A
stub assigned to `globalThis.fetch` **after** the client exists is therefore never consulted — the
client keeps the real one and makes real network requests, and nothing reports that the stub was
ignored. Measured while writing the gates: a probe that stubbed late reached `http://localhost:3000`,
and something already running on the machine answered with a full Next.js page, so the gate was
asserting against a stranger. On CI the same probe is `ECONNREFUSED` instead. Non-deterministic in
both directions. **Install the stub before the client is constructed, or use the listener, which has
no ordering hazard at all** because the client is pointed at it by `baseUrl` rather than by a mutated
global. Both remain permitted; only the stub carries a rule.

**`createAuthBrowserClient` grows no `customFetchImpl` option to make any of this easier** — the name
appears above only as the internal key Better Auth sets for itself, not as something this package
forwards — and no other public surface is
added either: **wrapping the client so that `organization` is genuinely absent, and returning the flag
alongside the client, were both put to the user and rejected**, because either one stops the returned
value being a plain Better Auth client — a surprise app authors would pay for every day, to make one
gate read better.

### What the magic link URL looks like, and how to read it back

The link `@hearthkit/email` sends always carries **exactly two query parameters**:

```
{AUTH_BASE_URL}/api/auth/magic-link/verify?token=<TOKEN>&callbackURL=%2F
```

`callbackURL` is appended whether or not `callbackUrl` was supplied. Omit it and the value is `%2F`;
supply `/dashboard` and it is `%2Fdashboard`. **There is no single-parameter case at all.**

That is what makes the extraction rule unconditional rather than a precaution. React Email escapes
`&` to `&amp;` in both the `href` attribute and the visible link text, so a two-parameter URL does
**not** appear verbatim in `htmlBody` — it appears verbatim only in `textBody`.
`@hearthkit/email`'s contract records the measurement and instructs this package to read the plain
text part. Plan 4.7's gate is "request magic link, read it from Mailpit, complete sign in", so:

> **Extract the magic link from the plain text part of the Mailpit message, never the HTML part.
> This holds for every link this package sends, including one requested with no `callbackUrl`.**

A single-parameter URL _would_ survive the escaping in `htmlBody` as well, which is what makes the
opposite assumption look correct. This package never produces one, so a "no callbackUrl" gate that
asserts HTML-verbatim behaviour is asserting something this package cannot do — it would pass for
the wrong reason and then rot. `completeMagicLinkSignIn` accepts the whole URL precisely so nobody
has to reassemble it.

**`completeMagicLinkSignIn` sends only the `token` and drops the link's `callbackURL`.** That is
what makes a successful verification answer `200` with JSON `{ token, user, session }` and a
`set-cookie`, rather than a 302 the function would then have to follow. It also makes the failure
arm unambiguous: with no `callbackURL` in the request, **any** 302 from this call is a rejected
token. Better Auth still redirects on failure, against `errorCallbackURL ?? callbackURL ?? '/'`, so
the rejection lands on `/?error=INVALID_TOKEN`.

Two more things about the mail this package sends, both of which a gate will otherwise trip over:

- The template is `@hearthkit/email`'s shipped `magicLinkEmailTemplate` (`magic-link-sign-in`), fed `{ signInUrl, productName?, expiryMinutes? }`. No second, competing template is defined here.
- **`expiryMinutes` is passed only when `magicLinkExpirySeconds` is 60 or more**, computed as `Math.floor(seconds / 60)`. `email`'s `emailLinkExpiryMinutesSchema` has a floor of one whole minute, so a shorter expiry has no representable value and the prop is omitted, which the template already handles by reading generically. This matters because the "expired magic link" gate sets the expiry to one second, and passing `0` would make every send fail as a render error instead.

### The Drizzle schema

`hearthkitAuthDrizzleSchema` defines seven tables, listed in `hearthkitAuthTableNames`:

`user`, `session`, `account`, `verification` — Better Auth's core schema.
`organization`, `member`, `invitation` — added by the organization plugin.

Plus one column on an existing table: `session.activeOrganizationId`.

**All seven exist in every project, and so does that column, whatever `organizationsEnabled` is set to.** This is the plan's "supports both user-scoped and org-scoped modes from the start" made concrete, and `verifyAuthTablesExist` is what makes it checkable rather than aspirational.

The schema is table definitions, not SQL. The app spreads `hearthkitAuthDrizzleSchema` into its own Drizzle schema and runs `drizzle-kit generate` once, producing one migration folder that `@hearthkit/db`'s `runDatabaseMigrations` applies. This package deliberately ships **no** migrations folder of its own: `runDatabaseMigrations` keeps one applied history per database, so a second folder would diverge from the first and be reported as `database-migration-conflict`. `@hearthkit/db`'s contract already draws the line in the same place — "apps (and `auth`/`payments`) own their Drizzle table definitions; this package never ships tables", and "`drizzle-kit generate` runs in the app at dev time".

Note for whoever writes SQL by hand: `user` is a reserved word in Postgres. Drizzle quotes it; a raw query must quote it too.

### Package entry point

`src/index.ts` is the package entry, a thin named re-export (no `export *`). It re-exports by name: the twelve public functions; `authEnvSchemaFragment` and `hearthkitAuthDrizzleSchema`; and every value `src/auth-contract.ts` exports, with no exceptions — the same mechanical rule `storage` and `email` settled on, so a caller that has narrowed a result on `kind` can validate the success arm without rebuilding the schema.

The manifest must publish a second subpath, `./auth-contract` → `./src/auth-contract.ts`, exactly as `@hearthkit/ui` publishes `./ui-contract` and `@hearthkit/email` publishes `./email-contract`. The reason is the same shape but arrives by a longer route: the `.` entry imports `@hearthkit/email`'s `.` entry, which transitively imports `.tsx` template modules, and it imports `better-auth/next-js` and `better-auth/react`. The contract file imports `zod` at runtime and nothing else — its `drizzle-orm/node-postgres` and `@hearthkit/email/email-contract` imports are **type-only** and erased. `@hearthkit/payments` will consume this subpath in the next loop for `AuthUserId` and `AuthOrganizationId` without dragging in React.

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

The mapping is part of the contract, not an implementation choice. Anything not listed here lands in the catch-all.

| Better Auth signal                                                                   | Failure                         |
| ------------------------------------------------------------------------------------ | ------------------------------- |
| 302 redirect whose `error` parameter is `INVALID_TOKEN`                              | `auth-magic-link-invalid`       |
| `APIError` with code `INVALID_EMAIL_OR_PASSWORD`                                     | `auth-invalid-credentials`      |
| `APIError` with code `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`                         | `auth-email-already-registered` |
| A `DrizzleQueryError` whose `.cause` has `ECONNREFUSED`, `42P01`, `3D000` or `28P01` | `auth-database-unavailable`     |
| An `EmailFailure` from `sendTransactionalEmail`                                      | `auth-email-send-failed`        |
| The endpoint is absent from `api`                                                    | `auth-organizations-disabled`   |
| Anything else                                                                        | `auth-request-failed`           |

**Where each of those values is read.** Reaching for the obvious property name finds `undefined`
every time, which routes every case into the catch-all. That failure is total and invisible, so the
access paths are part of the contract rather than an implementation detail:

- The error **code** is at `error.body?.code`. **`error.code` is `undefined`.** `error.body` carried
  exactly `{ message, code }` on every `APIError` measured that had a body at all — the 401 invalid
  credentials, the 422 duplicate sign-up, the 400 slug collision — but **that is a list of measured
  cases, not a rule, and an earlier revision of this contract wrote it down as a rule.** `error.body`
  is itself `undefined` on the 401 from calling `createOrganization` with a headers option. There is
  no guaranteed shape to lean on, so the optional chain is **required rather than stylistic**: a plain
  `error.body.code` throws a `TypeError` out of the handler on that path and turns "this package never
  throws" into a lie in exactly the case where the caller is already confused.
- The HTTP **status number** is at `error.statusCode`. `error.status` is the string name, such as
  `'UNAUTHORIZED'` or `'UNPROCESSABLE_ENTITY'`.
- A **magic link rejection** carries no code anywhere at all. Its value is the `error` query
  parameter of the redirect `location`, and nothing else. The thrown value carries that header, so
  the read is `error.headers.get('location')`. **`error.headers` is a real `Headers` instance, so the
  property access `error.headers.location` is `undefined`.** That is the same shape of trap as
  `error.code` versus `error.body?.code`, one level further out: the obvious spelling returns
  `undefined` rather than throwing, so the mistake looks like a missing header rather than a wrong
  access path.
- A **database failure** carries no code on the thrown error. The code is one `.cause` hop down.

**Those access paths are two instances of one recurring shape, and naming the shape is worth more
than the two fixes.** Four times now in this package, the obvious spelling has returned a **wrong
answer rather than an error**. One: `error.code` gives `undefined` where the code should be. Two:
`error.headers.location` gives `undefined` where the header should be. Three: the error-code enums
hold a plausible near-miss beside the real literal, and have done so three times over. Four, one
section away: a `globalThis.fetch` stub installed **after** `createAuthBrowserClient` has run is
silently ignored, because the client captured `fetch` at construction time. None of the four throws,
none of them logs, and each surfaces far from its cause — as a catch-all failure, as a gate that never
matches, or as a request that quietly went somewhere real. **The rule this package works to: when a
read or an assignment looks obvious, check it against a measured value before relying on it, because
this library reliably has something plausible sitting at the wrong spelling.** That is the general
form of the error-code rule stated further down, widened to cover the fetch case, which is not an
error code at all.

Details the gates and the implementation both depend on:

- **`auth-magic-link-invalid` is recognised from a redirect, not from a thrown coded error.** Better
  Auth's `GET /magic-link/verify` handler always answers a bad token by redirecting with
  `?error=INVALID_TOKEN` appended to `errorCallbackURL`, which defaults to `callbackURL`, which
  defaults to `/`. Measured at the pin, the call throws a plain `Error` with `statusCode: 302`, an
  **empty** `message`, `instanceof APIError === false`, and **no code anywhere**. So an
  implementation that inspects thrown error codes lets a rejected link look like a success, and one
  that matches on message text has nothing to match. The variant carries `betterAuthErrorValue` so a
  gate asserts the mechanism rather than the outcome, which means the implementation has to reach
  the redirect's `location` header. **The throw itself carries it**, measured at the pin: the thrown
  value's `headers` is a real `Headers` instance and `headers.get('location')` returns the whole
  redirect URL. So `asResponse: true` is a **choice, not a requirement**. It stays a reasonable
  choice, because the same call style also hands back `set-cookie` and the JSON body on the success
  arm and one call shape then serves both arms; but catching the throw and reading
  `error.headers.get('location')` is equally correct, and no gate may assume either style.
- **Better Auth cannot tell an expired token from a consumed or unknown one.** All three produce the identical `INVALID_TOKEN`. Plan 4.7 names "expired magic link" as a failure mode; this is the variant that covers it, and the honest statement is that it covers the other two as well. A gate produces the expired case by building an instance with `magicLinkExpirySeconds: 1`, requesting a link, waiting, and verifying.
- **A token is consumed atomically on the first verification.** Better Auth removed multi-attempt redemption, so calling `completeMagicLinkSignIn` twice with the same link always fails the second time — which is a second, faster producer for the same variant.
- **`auth-input-invalid` never echoes the rejected value.** `invalidFieldReason` states the rule that was broken ("must be a valid mailbox", "must be at least 8 characters"), not the input. That makes the secret rule absolute with no exceptions to remember, and a gate asserts on `invalidFieldName`, which is an enum, rather than on message text.
- **The password length check runs in this package before Better Auth sees it**, and the same `minimumAuthPasswordLength` / `maximumAuthPasswordLength` values are passed to `betterAuth()` as `minPasswordLength` and `maxPasswordLength`. Two layers checking with one set of numbers cannot disagree, so a password this package accepts can never be rejected downstream with a different message.
- **`auth-email-already-registered` matches one exact code, and it is the long one.** A duplicate
  sign-up throws `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` at HTTP 422, with the message
  `User already exists. Use another email.` **`USER_ALREADY_EXISTS` also exists in
  `auth.$ERROR_CODES`, as a separate entry, and is never what this endpoint throws** — so a reader
  who checks the library can confirm the wrong answer. The match is **exact equality**, never a
  substring test, because `'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'.includes('USER_ALREADY_EXISTS')`
  is `true`: a substring match would appear to work and would hide the day the value changes. That
  is the mirror of the `'19000:9000'.includes('9000:9000')` defect `docs/STATUS.md` records. Exact
  equality is safe here only because a gate pins it — a dependency bump that renames the code fails
  the duplicate sign-up gate, instead of quietly re-routing every duplicate into the catch-all.
- **Two Better Auth options would delete that failure's only producer, and both are measured.** The
  sign-up route returns a deliberately generic success instead of throwing when
  `emailAndPassword.requireEmailVerification` is on **or** `emailAndPassword.autoSignIn` is `false`.
  All three configurations were run against the pin; the table is under Measured. The default this
  package ships throws. Either guard active returns `{ token: null, user: {...} }` and throws
  nothing. **That generic response is indistinguishable from a real sign-up** — the same shape, a
  populated `user`, `token: null` — so a caller cannot detect the duplicate at all. Under those
  options the failure is not reported differently; it is not reported. The suppression is deliberate
  upstream: it stops the sign-up endpoint being a user-enumeration oracle, so whoever restores the
  throw is trading a security property for a named failure and should not "fix" it back without
  knowing that. This package pins `requireEmailVerification` off and leaves `autoSignIn` at its
  default `true`, which is the only reason the error is observable. Changing **either** — turning
  `requireEmailVerification` on, or setting `autoSignIn` to `false` — removes this variant's only
  producer and breaks its gate, and `autoSignIn` is the one nobody would think to check. Anyone doing
  it has to re-home the failure at the same time.
- **`auth-email-send-failed` carries `emailFailureKind` and `emailFailureDetail`.** The detail is the `EmailFailure`'s own `message`, which already starts with one of `email`'s six prefixes, so a gate can assert the underlying cause (`hearthkit email transport unreachable:`) without this package restating email's taxonomy. Without this variant, a magic link request against a dead SMTP server would report success and the user would wait for mail that never comes.
- **`auth-organizations-disabled` is detected structurally**, by the organization endpoint being
  absent from `authServerInstance.api`, not by a flag stored alongside the instance. That keeps the
  instance the single thing an app passes around, and it stays correct even for an instance built by
  hand. The endpoints are genuinely absent, not present-and-erroring: measured at the pin,
  `typeof authServerInstance.api.createOrganization` is `'function'` with the organization plugin
  and `'undefined'` without it.
- **`auth-database-unavailable` carries `databaseFailureDetail`, and every producer arrives as a raw
  Drizzle error rather than an `APIError`.** Measured at the pin, all four are a `DrizzleQueryError`
  with **no code of its own**, carrying the code exactly one `.cause` hop down: a dead port gives an
  `AggregateError` with `code: 'ECONNREFUSED'`; absent tables give a pg `DatabaseError` with
  `code: '42P01'` and `relation "user" does not exist`; a `DATABASE_URL` naming a database that does
  not exist gives `code: '3D000'`; a wrong password in `DATABASE_URL` gives `code: '28P01'`. Two
  things follow, and neither is guessable. First, the code is **exactly one `.cause` hop down**, so
  an implementation that checks the thrown error itself finds nothing. Second, one call can throw
  from **two unrelated error families** — an `AggregateError` and pg's `DatabaseError` — so the
  handler must not assume everything it catches is an `APIError`, nor that every `.cause` is the same
  type. All four are one class of problem, the kind an operator fixes with a corrected `DATABASE_URL`
  or with `hearthkit db migrate`, and all four are ordinary first-run states that otherwise surface
  as an opaque 500 with no hint of either fix. The last two are the cheapest of the four to gate:
  they need nothing but a different connection string, no dead port and no dropped table.
- **The four codes are an allowlist, not a catch-all, and the distinction is load-bearing.** The rule
  is deliberately **not** "any `.cause` carrying a code". `23505` is a unique violation, which is a
  caller error rather than an unavailable database, and the organization slug path can race into one;
  routing it here would tell an operator to go fix their infrastructure over a duplicate row. Every
  code outside `ECONNREFUSED`, `42P01`, `3D000` and `28P01` stays in `auth-request-failed`, which
  carries `authFailureDetail` so nothing is lost. Whoever wants a fifth code has to argue first that
  it is the same operator-fix class, and not a caller error wearing a database code.
- **`auth-request-failed` carries `authErrorCode` and `authErrorStatus`** when Better Auth supplied
  them, plus `authFailureDetail`. `authErrorCode` comes from `error.body?.code` and `authErrorStatus`
  from `error.statusCode`, per the access paths above; `error.code` and `error.status` are the two
  wrong properties to reach for. It is the catch-all that keeps "never throws" honest, exactly as
  `storage-request-failed` and `email-send-failed` do. Carrying the code is what stops it being a
  dead end: an organization slug collision, for example, arrives here with
  **`authErrorCode: 'ORGANIZATION_ALREADY_EXISTS'` and `authErrorStatus: 400`**, so a caller can
  branch on it and a gate can assert it. Both halves are exported —
  `betterAuthOrganizationAlreadyExistsErrorCode` and
  `betterAuthOrganizationAlreadyExistsHttpStatus` — so the caller and the gate share one spelling for
  each. The status has a name for the same reason the 404 and the 401 do: every HTTP status this
  contract pins is named, so **no gate writes one of these numbers bare**, and a status left as a
  literal is the one a reader cannot trace back to the measurement that produced it.
- **Two wrong values for that slug collision are easy to reach, and one of them was in this
  contract.** `SLUG_TAKEN` is **not an error code in this library at all** — an earlier revision
  illustrated the case with it, and a gate asserting it would have failed against every correct
  implementation. `ORGANIZATION_SLUG_ALREADY_TAKEN` **is** a real entry in the organization plugin's
  `$ERROR_CODES`, sitting one line away from `ORGANIZATION_ALREADY_EXISTS`, and it is not what this
  endpoint throws — the decoy has the same shape as `USER_ALREADY_EXISTS` beside
  `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, one level down. Checking the library confirms the wrong
  answer in both directions, so the measurement is the authority: a real collision throws
  `ORGANIZATION_ALREADY_EXISTS` at HTTP 400, message `Organization already exists`, with `body`
  present. **That is the third near-miss constant to bite this package** — the short
  `USER_ALREADY_EXISTS` beside the long form, the fabricated `SLUG_TAKEN`, and now
  `ORGANIZATION_SLUG_ALREADY_TAKEN` one line from the right answer — so the rule generalises:
  **never take an error code for this library from documentation or from memory; read it off a thrown
  error, because the enum reliably holds a plausible near-miss.** Naming the decoy here is what stops
  the fourth.

### Upstream behaviour at this pin that changes how a call must be made

Not failure modes, and not defects in this package. Each one was measured at `better-auth@1.7.2` and
each one produces a symptom that points at the wrong cause, which is why they are in the contract
rather than in a comment somebody writes after losing an afternoon.

- **The server-side `api` calls disagree about `headers`, and there is no rule that covers all
  three.** `signInMagicLink` and `magicLinkVerify` **require** a `headers` value: omit it and the call
  throws `APIError` 400 `VALIDATION_ERROR` with the message `Headers is required`, even though neither
  call is session-scoped. `createOrganization` must be
  called **without** one: passing `new Headers()` throws `UNAUTHORIZED` 401 with `body: undefined` and
  an **empty message**. Only the symptom was measured; the likely cause is that a headers option makes
  the endpoint resolve a session rather than take the owner from `body.userId`. A 401 with no message
  and no body reads like a bug in the caller's own code rather than an argument mistake, and it is the
  shape that produced the `error.body?.code` correction above. `addMember` tolerates either. **Pass
  `headers` to the two magic link calls; do not pass it to `createOrganization`.**
- **Verifying a magic link for a user who already has a password deletes that user's `account`
  rows.** Reproduced twice at the pin. Afterwards, password sign-in for that same user fails with
  `INVALID_EMAIL_OR_PASSWORD`, which this package reports as `auth-invalid-credentials` — a correct
  report of a state the user never asked for. Two consequences. **No gate may mix the two sign-in
  paths on one user**, or it will assert a failure that has nothing to do with the code under test.
  And **nobody may design a "link your password account by magic link" flow on top of this
  package** while the behaviour stands; it is upstream, this package does not cause it and cannot
  correct it from where it sits.

### Clauses no gate covers

Recorded so a future reader does not assume coverage exists. Everything else in this contract has a gate.

- **`nextCookies()` being last in the plugin list.** Its effect — a Next server action's `Set-Cookie` reaching the browser — needs a running Next app, not Vitest. So it cannot be proven by the gates. **It can break them, and the earlier claim that it could not was wrong.** The plugin loads `next/headers` dynamically inside both of its hooks. The `before` hook swallows everything; the `after` hook, which is the one that sets cookies, swallows exactly two error shapes: a message starting with `` `cookies` was called outside a request scope. `` or one that includes `Cannot find module`. **Everything else is rethrown.** With `next` not installed, Node's ESM resolver produces `Cannot find package 'next' imported from …`, which matches **neither** string, so the hook rethrows and **every cookie-setting call fails** — sign-up, sign-in and magic-link verification all returned `auth-request-failed` until `next@16.3.3` was installed. `next` is therefore a **devDependency of this package**, listed under Dependencies, and it stays an optional peer for consumers. The clause is now "it cannot break the gates **because `next` is installed**", which is a stated dependency rather than an accident.
- **The Google and GitHub sign-in redirect.** Configuring a provider is gated (fake credentials are enough to prove the provider is registered); completing a sign-in needs a real client ID at a real provider, which plan section 6 puts outside local development.
- **`sendResetPassword`.** The callback is wired to `email`'s `passwordResetEmailTemplate`, but reaching it needs `POST /request-password-reset` through the route handler, and this package exposes no wrapper for it. On an email failure the callback throws an `Error` whose message starts with `hearthkit auth email send failed:`, so the 500's log line is greppable even though no gate produces it.

## Dependencies

- Packages: `@hearthkit/db` (workspace) for the Drizzle client type and for the project connection; `@hearthkit/email` (workspace) for `sendTransactionalEmail`, `magicLinkEmailTemplate` and `passwordResetEmailTemplate`; `@hearthkit/config` as a **devDependency only** — this package contributes `authEnvSchemaFragment` for config to compose and never consumes config itself.
- Runtime libraries (implementor adds, exact pins): `better-auth@1.7.2`, `@better-auth/drizzle-adapter@1.7.2`, `drizzle-orm@0.45.2`, `zod@4.4.3`. `react` and `react-dom` are **peer** dependencies, matching `@hearthkit/ui` and `@hearthkit/email`. `next` is an **optional peer** dependency, matching how `better-auth` itself declares it, because only the route handler and `nextCookies` touch it.
- Dev dependencies (implementor adds, exact pins to match the rest of the workspace): `@types/node@24.13.3`, `typescript@7.0.2`, `vitest@4.1.11`, `react@19.2.8`, `react-dom@19.2.8`, `@types/react@19.2.18`, `pg@8.23.0`, `@types/pg@8.23.1`, `next@16.3.3`, `@hearthkit/config` (workspace).
- **`@types/pg@8.23.1` is there to pin a resolution, not for type convenience, and pruning it as an
  unused `@types` package breaks the build.** `drizzle-orm` declares `pg` **and** `@types/pg` among
  its optional peer dependencies, and pnpm writes the resolved peer set into the resolution key, so
  two packages share one physical `drizzle-orm` only if they declare the same halves of that pair.
  `@hearthkit/db` declares both, which is why this package declares both. Declare `pg` here
  **without** `@types/pg` and this package resolves a **different peer set**, pnpm materialises a
  **second physical copy** of the same version, and `@hearthkit/db`'s client stops being assignable
  to this package's `drizzleClient` parameter. That is not a soft mismatch a cast can paper over:
  `PgSession.dialect` is `protected`,
  so two copies of one class declaration are nominally incompatible and TypeScript refuses the
  assignment outright, with
  `TS2322 … Property 'dialect' is protected but type 'PgSession<…>' is not a class derived from 'PgSession<…>'`.
  The symptom reads like a Drizzle bug; the cause is a missing `@types` package. That is why the
  reason is written here and not left to the manifest — an `@types` entry with no `import` to justify
  it is exactly what a later reader deletes.
- **Check that by resolving the two paths, never by comparing a peer-suffix string.** The check that
  means something is that `packages/auth/node_modules/drizzle-orm` and
  `packages/db/node_modules/drizzle-orm` resolve to the **same real path** — verified after this
  package was installed, and they do — with `pnpm-lock.yaml` holding exactly one peer-suffixed
  `drizzle-orm@0.45.2` snapshot as the supporting evidence. **An exact suffix is not a fact a
  contract can hold, and this one held a suffix that went stale inside a single loop.** It read
  `…(@opentelemetry/api@1.9.1)(@types/pg@8.23.1)(pg@8.23.0)`; installing this package added
  `kysely@0.29.5` to the set, because `better-auth` brings `kysely` and `drizzle-orm` lists it as an
  optional peer, so today the key reads `…(@types/pg@8.23.1)(kysely@0.29.5)(pg@8.23.0)`. That string
  is quoted only as an example that will drift again — `@hearthkit/payments` is the next package into
  this workspace, and anything it brings that `drizzle-orm` lists as an optional peer changes the key
  a third time. **A reader who finds a suffix here that no longer matches the lock has found a stale
  sentence, not a split copy.** Resolve the two paths and compare those.
- **`next@16.3.3` is load-bearing for the gates, not a convenience.** It is the same version
  `templates/app` pins. Without it installed in this package, `nextCookies()` rethrows the module
  resolution error out of its `after` hook and every call that sets a cookie fails — measured, and
  argued under Clauses no gate covers. It is a **devDependency here and an optional peer for
  consumers**, which is how `better-auth` itself declares it: an app that uses this package already
  has Next, and a non-Next consumer must not be made to install it.
- **No `drizzle-kit`, and no `@better-auth/cli`.** Neither is a dependency of this package, at any
  level, including for the gates. What replaces each is argued in Decisions 9 and 10, and both
  replacements use packages already listed above. The **app** still runs `drizzle-kit generate` over
  its own schema, as The Drizzle schema explains — that is the app's tool, not this package's.
- `better-auth/adapters/drizzle` and `@better-auth/drizzle-adapter` export the **identical function
  object** — `inlined.drizzleAdapter === standalone.drizzleAdapter` is `true` at the pin. The
  separate dependency above is therefore optional indirection that matches the official docs, not a
  version-skew risk. A future reader may treat the two import paths as interchangeable.
- Services for gates:
  - **Postgres 17** from the repo-root `docker-compose.yml`. Already a service container in `ci.yml`. Gates create a scratch project database with `@hearthkit/db`'s `createProjectDatabase`, create the auth tables in it, run, and drop it. The `CREATE TABLE` statements are **derived from `hearthkitAuthDrizzleSchema` itself**, per Decision 9 — not hand-written, and not generated by a tool.
  - **Mailpit** from the repo-root `docker-compose.yml` (SMTP `localhost:1025`, HTTP API `localhost:8025`). Already started by `ci.yml`. Gates read the magic link from `GET /api/v1/message/{ID}` and take the URL from the **text** part.
  - **A dead local port** for `auth-database-unavailable` (server refused) and for `auth-email-send-failed` (SMTP refused).
  - **A changed connection string and nothing else** for the other two `auth-database-unavailable` codes: point `DATABASE_URL` at a database name that was never created for `3D000`, and at the right database with the wrong password for `28P01`. No extra service, no dead port, no dropped table — which is why these two are the cheapest producers of that variant to gate.
  - **No service at all** for `auth-oauth-provider-config-incomplete`, `auth-input-invalid`, `auth-organizations-disabled`, the schema conformance gate of Decision 10, and the route-handler and browser-client shape gates.
  - **A server instance and a route from the browser client to it**, for the organizations flag's
    effect on the client. No new service: the gate stubs global `fetch` or puts
    `authServerInstance.handler` behind a listener, as What the organizations flag does and does not
    change on the browser client explains. **A stub only works if it is installed before the client is
    constructed**, because `createAuthClient` captures `fetch` at construction time; the listener has
    no such ordering hazard. **And no database — that was an open question in this list and it is now
    measured.** Both halves run against server instances built over a Drizzle client aimed at a
    **closed port**, and both still answer their pinned status, so a route the server does not have is
    answered, and a request carrying no session cookie is rejected, before the adapter is ever
    touched. The closed port is deliberate rather than incidental: a gate that started needing a
    database fails there loudly instead of passing quietly against a fixture it should not need.
- No new service is introduced, so the trap that failed PR #10 — a compose service `ci.yml` was never taught about — has nothing to bite on here.

## Out of scope

- **Anything `@hearthkit/payments` needs in Phase 5 (deferred, must not block).** This package must not import `payments`, know about Stripe, or model a plan, a price or a subscription. Plan 4.8 says billing scope follows this package's `organizations` flag: what keeps that open is that `AuthUserId` and `AuthOrganizationId` are both branded, exported, and available from the `./auth-contract` subpath in **both** modes, and that the `member` table exists in both — so `payments` keys a customer on whichever id the flag selected without this package changing. Better Auth's Stripe plugin is deliberately not configured here; whether `payments` uses it or the Stripe SDK directly is plan 4.8's decision, and adding a plugin to the instance is additive.
- **The `create` scaffolder in Phase 6 (deferred, must not block).** `create` needs three things and all three are already parameters, not env vars or file layout: the `organizations` boolean, the list of `requestedSocialProviders`, and the `productName`. Nothing here reads a file, a manifest or a `.env`.
- **Passkeys, two-factor, admin, teams and dynamic organization roles (deferred, must not block).** Each is a Better Auth plugin plus its own tables. Adding one is an additive migration and one more entry in the plugin list; none changes a signature here. `team`, `teamMember` and `organizationRole` are therefore not in `hearthkitAuthTableNames`. This does not contradict the org-tables rule: switching a project between user scope and org scope re-homes existing rows, which is why those tables must exist from the start, whereas adding teams later only adds tables.
- **Email verification.** `requireEmailVerification` is pinned off, because plan 4.7 does not list it
  and `@hearthkit/email` ships no verification template. **Turning it on later is not free**, and the
  earlier claim that it costs one template in `email` plus one option here was wrong: measured at the
  pin, that option also switches duplicate sign-up to a generic success, which **deletes
  `auth-email-already-registered`'s only producer and breaks its gate**. The cost is one template,
  one option, and a new home for that failure mode. **Setting `emailAndPassword.autoSignIn` to
  `false` does exactly the same damage**, and that is the trigger nobody would think to check — it is
  not an email-verification setting, it has nothing to do with this bullet's heading, and it reads
  like a harmless preference. Both suppressions are deliberate upstream anti-enumeration measures,
  not defects to patch around. Argued in full under How a Better Auth signal becomes a failure.
- **Password reset wrappers.** The `sendResetPassword` callback **is** wired, so `authBrowserClient.requestPasswordReset()` sends real mail through `email`'s `passwordResetEmailTemplate` — without it, that template has no consumer anywhere and a user who forgets a password is locked out permanently. But no `requestPasswordReset` / `resetPassword` wrapper is exported, because plan 4.7 gates neither. Ruled and kept as written.
- **Every Better Auth endpoint this package does not wrap.** Sign out, account linking, session listing, organization invitations, and the rest are reachable on `authServerInstance.api.*` and on the browser client. The wrappers are a deliberate subset: one per plan 4.7 gate step, each turning a thrown `APIError` into a named returned failure. Nothing is blocked by their absence.
- **Session-scoped organization calls.** `createAuthOrganization` and `addAuthOrganizationMember` are the server-side provisioning path and take no session headers, which is what plan 4.7's gate needs. An app's "create organization" button uses `authBrowserClient.organization.create()`, which goes through the route handler and is session-scoped by construction.
- **Mounting the app under a sub-path.** `AUTH_BASE_URL` must have an empty path and `basePath` stays at Better Auth's default `/api/auth`. hearthkit gives every project its own hostname, so a sub-path mount has no producer; supporting one later is one more optional parameter.
- **Session lifetime, cookie cache, rate limiting and trusted origins.** Better Auth's defaults, unconfigured. Each is an additive option, and none of them changes the data model.
- **Shipping SQL migrations.** Argued under The Drizzle schema. The app generates one migration set over its whole schema.
- **Reading `process.env`, and owning `NODE_ENV`.** Config owns both. Because the secret arrives as a parameter and nothing is cached at module scope beyond the instance the app itself built, the deferred secrets manager only has to repopulate the environment before boot.
- **Rendering sign-in or sign-up UI.** `@hearthkit/ui` owns components; this package ships no `.tsx` at all. That is why its `.` entry has no JSX of its own, and why the subpath exists only because of what it imports.

## Decisions

Settled here rather than left to the implementor.

1. **Twelve functions, each tied to a plan line.** `resolveAuthRuntimeConfig` (the OAuth failure mode, forced by the fragment-refinement defect); `createAuthServerInstance` (output "server auth instance"); `createAuthRouteHandlers` (output "Next.js route handler"); `createAuthBrowserClient` (output "client hooks"); `readAuthSession` (output "session helpers", gate "read session"); `signUpWithPassword` (gate "sign up with password"); `signInWithPassword` (gate "sign in", failure "invalid credentials"); `requestMagicLinkSignIn` (gate "request magic link"); `completeMagicLinkSignIn` (gate "complete sign in", failure "expired magic link"); `createAuthOrganization` and `addAuthOrganizationMember` (gate "create an org and add a member"); `hearthkitAuthDrizzleSchema` (output "Drizzle schema for auth tables"). The one without a direct plan line is `verifyAuthTablesExist`, argued in 2.
2. **`verifyAuthTablesExist` exists so the plan's central claim is checkable.** Plan 4.7 says the package supports both modes from the start because changing the flag later changes the data model. That is a statement about the schema, and without a function that reports which tables are present, the only way to check it is to read the source. It also gives `auth-database-unavailable`'s "tables missing" producer a precise diagnosis, and it is what `observability`'s `/health` will call when it grows an auth check. It has a second job in the gates: it is the setup check that the DDL derived in Decision 9 actually created all seven tables, so a broken fixture fails once, loudly and by name, instead of making every downstream gate fail with `relation "user" does not exist`. **That is a different job from the conformance gate of Decision 10, and the two are easy to confuse.** `verifyAuthTablesExist` asks a live database whether the DDL derived from `hearthkitAuthDrizzleSchema` really created the seven tables. The conformance gate asks, with no database anywhere in it, whether `hearthkitAuthDrizzleSchema`'s own property keys still match what `getAuthTables()` reports for the pinned version. One catches a broken fixture or an unmigrated database; the other catches a dependency bump that added a column. Both stand, and neither substitutes for the other.
3. **Nine failure variants where the plan names three.** Same shape as `db` (ten for four) and `email` (six for three). Three are plan's. `auth-input-invalid` and `auth-email-already-registered` are the two ordinary user-facing outcomes of a sign-up form, and leaving them in a catch-all would mean the two most common mistakes have no name. `auth-email-send-failed` is the `auth`-to-`email` seam, where silence is the worst possible outcome. `auth-organizations-disabled` is the scaffold flag's guardrail. `auth-database-unavailable` is the first-run state of every project. `auth-request-failed` is the catch-all that makes "never throws" a promise rather than an aspiration.
4. **One `auth-input-invalid` with a field discriminator, not one variant per field.** A caller handles a malformed email and a short password identically — show a message next to that field — so they are one kind with `invalidFieldName`. A wrong password (`auth-invalid-credentials`) and a taken email (`auth-email-already-registered`) are handled differently from each other and from both of those, so they are separate kinds. The taxonomy follows what the caller does, not what went wrong internally.
5. **The organizations flag is a parameter, the tables are not conditional.** Argued under The scaffold flag and The Drizzle schema.
6. **`sendResetPassword` is wired; no reset wrappers are exported.** Argued under Out of scope. It is the one place this contract adds behaviour plan 4.7 does not name; put to the orchestrator and accepted as written.
7. **Success is returned for a magic link requested for an unknown address.** Better Auth creates the user on verification, so there is nothing to leak, and reporting "no such user" from this endpoint would turn it into a user-enumeration oracle.
8. **`AuthSession` omits the session token and `AuthSessionCookie` is marked a secret.** Same reasoning `email` used for withholding message bodies from its send result: a result value is what ends up in a log line, and one of these two values has to be returned because carrying it to the next call is its entire job.
9. **The gates build the auth tables from `hearthkitAuthDrizzleSchema` itself. `drizzle-kit` is not a
   dependency of this package.** `getTableConfig` from `drizzle-orm/pg-core` is public and reports
   each column's `name`, `getSQLType()`, `notNull` and `primary`, which is enough to build
   `CREATE TABLE` from the shipped schema using a package this contract already lists. That is
   strictly better than either a committed SQL fixture or a generator, because the gate then
   **cannot** test a schema different from the one the package exports: a fixture can drift silently,
   and a generator can be re-run against a different source. `user` is a reserved word and must be
   quoted, as noted under The Drizzle schema.
10. **A schema conformance gate replaces one-time code generation. `@better-auth/cli` is not used.**
    The earlier proposal — run `npx @better-auth/cli generate --adapter drizzle --dialect pg` once
    and commit the output — rested on a false premise. `@better-auth/cli`'s latest is **1.4.21**,
    three minors behind the pinned `better-auth@1.7.2`; `npx @better-auth/cli@1.7.2` fails with
    `ETARGET: No matching version found`; and `better-auth@1.7.2` ships **no `bin` at all**. The
    command cannot run at this pin, and a 1.4.21 CLI is exactly the thing that would miss the 1.7
    `account.issuer` column the proposal existed to protect against. The replacement is
    **`getAuthTables(options)` from `better-auth/db`**, which returns the pinned version's own
    authoritative model and field list. The gate asserts: for every table `getAuthTables()` reports,
    `hearthkitAuthDrizzleSchema` defines a table under the same key, and that table object carries a
    property for every field name reported. Call it with an options object that includes the
    organization plugin, since the shipped schema always defines the organization tables. This beats
    one-time generation because it re-checks on **every** dependency bump rather than once at
    authoring time — and it bites: run against a hand-written seven-table schema it immediately
    reported `invitation.createdAt MISSING from drizzle schema`.

    The comparison is on names, not on SQL. `getAuthTables()` keys each table by its model name and
    each field by its field name, and the Drizzle adapter resolves a column as
    `schema[modelName][fieldName]`. This package overrides neither `modelName` nor `fields`, so both
    reduce to Better Auth's own names. The SQL column names underneath are Drizzle's business and the
    gate does not constrain them. The SQL **table** names must equal the model names, because
    `verifyAuthTablesExist` looks them up in `information_schema.tables`.

    This gate touches no database. Whether those tables were ever created is a separate question and
    `verifyAuthTablesExist`'s job, per Decision 2. A schema that conforms perfectly and was never
    migrated passes this gate and fails that one, which is the correct division.

## Verified

Checked 2026-09-03 against current docs.

- `better-auth` latest is **1.7.2**. Its exports map includes `./next-js`, `./react`, `./client`, `./client/plugins`, `./plugins`, `./plugins/organization`, `./plugins/magic-link`, `./api`, `./adapters/drizzle`; `next`, `react`, `drizzle-orm` and `pg` are optional peer dependencies — https://registry.npmjs.org/better-auth/latest
- `@better-auth/drizzle-adapter` latest is **1.7.2** and peer-depends on `drizzle-orm@^0.45.2 || >=1.0.0-rc.1 <2.0.0`, which the workspace's pinned `drizzle-orm@0.45.2` satisfies exactly — https://registry.npmjs.org/@better-auth/drizzle-adapter/latest
- The adapter is configured as `drizzleAdapter(db, { provider: 'pg', schema })`, imported from `@better-auth/drizzle-adapter`; `schemaName` selects a Postgres schema and `usePlural` renames tables — https://www.better-auth.com/docs/adapters/drizzle
- Better Auth reads `BETTER_AUTH_SECRET` then `AUTH_SECRET` for `secret`, and `BETTER_AUTH_URL` for `baseURL`; `basePath` defaults to `/api/auth`; `secret` must be at least 32 characters and falls back to a hardcoded literal when unset — https://www.better-auth.com/docs/reference/options and https://www.better-auth.com/docs/installation
- Core tables are `user`, `session`, `account`, `verification`. `user` carries `id, name, email, emailVerified, image, createdAt, updatedAt`; `session` carries `id, userId, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt`; `account` carries `id, userId, issuer, accountId, providerId, accessToken, refreshToken, idToken, accessTokenExpiresAt, refreshTokenExpiresAt, scope, password, createdAt, updatedAt`; `verification` carries `id, identifier, value, expiresAt, createdAt, updatedAt` — https://www.better-auth.com/docs/concepts/database
- The organization plugin adds `organization`, `member` and `invitation`, optionally `team`, `teamMember` and `organizationRole`, and **adds `activeOrganizationId` to the existing `session` table**. It adds `activeTeamId` as well **only when teams are enabled**, which the default configuration this package ships does not do, so `session` gains `activeOrganizationId` alone. Default roles are `owner`, `admin`, `member`; `creatorRole` defaults to `owner`. `auth.api.createOrganization({ body: { name, slug, userId } })` works server-only without session headers, and `auth.api.addMember({ body: { userId, role, organizationId } })` is documented as server-only and does not require session headers. The same page also says of `createOrganization` that "this endpoint requires session cookies", which describes the session-scoped path an app's own button takes; measured at the pin, **omitting `headers` entirely and putting `userId` in the body succeeds, and passing `new Headers()` fails with 401**, so the two statements are about two different call styles and this package uses the first — https://www.better-auth.com/docs/plugins/organization
- Magic link is a plugin: `magicLink({ sendMagicLink })` from `better-auth/plugins`, `magicLinkClient()` from `better-auth/client/plugins`. The callback signature is `sendMagicLink: async ({ email, token, url, metadata }, ctx) => {}`. `expiresIn` is in seconds and defaults to 300. Its endpoints are `POST /sign-in/magic-link` (`signInMagicLink`) and `GET /magic-link/verify` (`magicLinkVerify`), the latter taking `token` and optional `callbackURL`, `newUserCallbackURL`, `errorCallbackURL` — https://www.better-auth.com/docs/plugins/magic-link
- **The verify handler always redirects on failure, it never throws a coded error.** It calls `redirectWithError('INVALID_TOKEN')` against `errorCallbackURL ?? callbackURL ?? '/'`, so the observable signal is a redirect carrying `?error=INVALID_TOKEN`. On success it calls `setSessionCookie` and then either redirects or, with no `callbackURL`, returns JSON `{ token, user, session }`. `allowedAttempts` is deprecated because a token is now consumed atomically on the first verification — https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/plugins/magic-link/index.ts
- Next.js route handler: `import { toNextJsHandler } from 'better-auth/next-js'` in `app/api/auth/[...all]/route.ts`, returning `{ GET, POST, PATCH, PUT, DELETE }`. Server session read is `auth.api.getSession({ headers: await headers() })`. `nextCookies()` must be the last plugin, and it loads `next/headers` dynamically inside its hooks — https://www.better-auth.com/docs/integrations/next and https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/integrations/next-js.ts
- **What `nextCookies()` swallows is narrower than "the failure outside a request scope", and the difference decides whether the gates can pass.** Read at the **v1.7.2 tag**, not at `main`: the `before` hook swallows everything, but the `after` hook catches and returns quietly only when the message starts with `` `cookies` was called outside a request scope. `` or includes `Cannot find module`, and **rethrows anything else**. A missing `next` package produces neither string, which is why `next` is a devDependency here — https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/integrations/next-js.ts
- **Both `ORGANIZATION_ALREADY_EXISTS` and `ORGANIZATION_SLUG_ALREADY_TAKEN` exist at the v1.7.2 tag**, as adjacent entries in the organization plugin's error codes, with the messages `Organization already exists` and `Organization slug already taken`. Reading the library therefore confirms either answer for a slug collision, and only the measurement below separates them. `SLUG_TAKEN` appears nowhere — https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/organization/error-codes.ts
- Next 16 route files support `GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS`; `context.params` has been a Promise since 15.0, and the catch-all `[...slug]` convention is unchanged. Docs version 16.3.4, matching the pinned 16.3.3 — https://nextjs.org/docs/app/api-reference/file-conventions/route
- Server calls take `{ body, headers, query }` and support `asResponse: true` and `returnHeaders: true` (which gives `{ headers, response }`, and is how the session cookie is read out). They **throw** on failure; the error is an `APIError` from `better-auth/api`, recognised with `isAPIError`, carrying `message` and `status`. **Do not stop reading here** — measured below, `status` is the string name, the number is `statusCode`, and the code is at `body.code` — https://www.better-auth.com/docs/concepts/api
- Client calls **return** `{ data, error }` with `error.message`, `error.status`, `error.statusText` and `error.code`; `useSession()` returns `{ data, isPending, error, refetch }`; `createAuthClient` comes from `better-auth/react` and its `baseURL` may be omitted when the auth server is on the same domain as the client. The client exposes `$ERROR_CODES` — https://www.better-auth.com/docs/concepts/client
- `INVALID_EMAIL_OR_PASSWORD` is the code for a wrong email or password, returned with HTTP 401 — https://www.better-auth.com/docs/reference/errors
- **A taken sign-up email throws `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, not `USER_ALREADY_EXISTS`.** The route reads `throw APIError.from("UNPROCESSABLE_ENTITY", BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL)`, so the status is 422. An earlier revision of this contract recorded the short code, which is a distinct entry in the same object and is never thrown here — https://github.com/better-auth/better-auth/blob/main/packages/better-auth/src/api/routes/sign-up.ts
- **That throw is guarded.** The same route computes `shouldReturnGenericDuplicateResponse = ctx.context.options.emailAndPassword.requireEmailVerification || ctx.context.options.emailAndPassword.autoSignIn === false` and returns a generic success instead of throwing when it holds. This package pins the first off and leaves the second at its default, so the throw is reachable. **Both guards are measured at the 1.7.2 pin, one instance each — see the table under Measured.** The source read is kept only because it explains why; the behaviour itself is no longer inferred from it — same URL
- Better Auth exports **no stable public type** for the value `betterAuth()` returns; the documented convention is `export type Auth = typeof auth` in the app. This is why `AuthServerInstance` is structural here — https://www.better-auth.com/docs/concepts/typescript
- **`createAuthClient` binds its fetch implementation at construction time, and the docs do not say so.** Read at the **v1.7.2 tag**, the client config builds its fetcher with `createFetch({ …, customFetchImpl: fetch, …restOfFetchOptions })`, so the value `globalThis.fetch` holds when the client is constructed is captured then and a later reassignment of the global is never consulted. The client documentation page describes `fetchOptions` and **never mentions `customFetchImpl`**, so this is readable only in the source, which is why the ordering rule for a gate's `fetch` stub is written into this contract — https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/client/config.ts and https://www.better-auth.com/docs/concepts/client

Established earlier in this repo and built on rather than re-derived: `composeEnvSchemaFragments` silently discards a refinement attached to a fragment; React Email escapes `&` in `htmlBody` so a multi-parameter URL appears verbatim only in `textBody`; `@hearthkit/email` ships `magic-link-sign-in` with props `{ signInUrl, productName?, expiryMinutes? }` and `password-reset` with props `{ passwordResetUrl, productName?, expiryMinutes? }`; bare Node refuses `.tsx`, which is why `ui` and `email` publish a contract subpath; Postgres and Mailpit are already in `ci.yml`.

### Measured against a real install at the pin, 2026-09-03

Run by the orchestrator against `better-auth@1.7.2`, `@better-auth/drizzle-adapter@1.7.2`,
`drizzle-orm@0.45.2`, a real Postgres and real Drizzle tables. These are command output, not
inference, and where one disagrees with a doc statement above, this list wins.

- **A rejected magic link is a redirect and nothing else.** Bad token with a `callbackURL`: status
  `302`, `location: http://localhost:3000/dash?error=INVALID_TOKEN`. The thrown value is an `Error`
  with `statusCode: 302`, an empty `message`, `instanceof APIError === false`, and no code anywhere.
- **That thrown value carries the redirect location, so `asResponse: true` is optional.** Catching
  the throw from `magicLinkVerify` with a bad token and no `asResponse`: the constructor is `Error`,
  `isAPIError` is `false`, `statusCode` is `302`, and `Object.keys` gives
  `['status', 'body', 'headers', 'statusCode', 'name']`. `headers` is a real `Headers` instance:
  `error.headers.get('location')` returns `http://localhost:3000/dash?error=INVALID_TOKEN`, and
  `error.headers.location` is `undefined`.
- **Unknown, consumed and expired tokens are indistinguishable.** All three produced the identical
  302, no code, empty message. `TOKEN_EXPIRED` does exist in `$ERROR_CODES`, but magic link never
  emits it, so nothing here may reach for it.
- **A valid verify with no `callbackURL` returns 200 JSON `{ token, user, session }`** and sets a
  cookie.
- **The emailed link always carries two query parameters.** With no `callbackUrl` supplied at request
  time: `.../api/auth/magic-link/verify?token=<TOKEN>&callbackURL=%2F`. Supplying `/dashboard` gives
  `&callbackURL=%2Fdashboard`. There is no single-parameter case.
- **`INVALID_EMAIL_OR_PASSWORD` at HTTP 401**, for both a wrong password and an unknown email.
- **A duplicate sign-up throws `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` at HTTP 422**, message
  `User already exists. Use another email.` Both that code and the shorter `USER_ALREADY_EXISTS`
  exist in `auth.$ERROR_CODES` as distinct entries.
- **An `APIError` carries its code at `error.body?.code`.** `error.code` is `undefined`. `error.body`
  had exactly `{ message, code }` **on the errors probed in this round**, which is not the same thing
  as a rule — a later round measured an `APIError` whose `body` is `undefined`, recorded below.
  `error.statusCode` is the number; `error.status` is the string name, such as `'UNAUTHORIZED'` or
  `'UNPROCESSABLE_ENTITY'`.
- **A database failure is not an `APIError`, and four codes reach it.** Dead port:
  `DrizzleQueryError`, no code, `.cause` an `AggregateError` with `code: 'ECONNREFUSED'`. Tables
  absent: `DrizzleQueryError`, no code, `.cause` a pg `DatabaseError` with `code: '42P01'` and
  `relation "user" does not exist`. A connection string naming a database that does not exist:
  `DatabaseError` with `code: '3D000'` and `database "definitely_absent_db" does not exist`. A
  connection string with the wrong password: `DatabaseError` with `code: '28P01'` and
  `password authentication failed for user "hearthkit"`. One `.cause` hop in every case. The last two
  were produced by changing the connection string and nothing else.
- **Organization endpoints are structurally absent without the plugin.**
  `typeof auth.api.createOrganization` is `'function'` with the plugin and `'undefined'` without it.
- **`getAuthTables()` reports exactly seven tables** — `user`, `session`, `account`, `verification`,
  `organization`, `member`, `invitation` — with `session.activeOrganizationId` present, and
  `account.issuer` present and required.
- **`autoSignIn` is on by default**: `signUpEmail` returned a token and a `set-cookie`.
- **`drizzleAdapter` requires the `schema` option**, which makes it mandatory rather than
  conventional. `drizzleAdapter(db, { provider: 'pg' })` against a `drizzle(pool)` with no schema
  throws `BetterAuthError: [# Drizzle Adapter]: The model "user" was not found in the schema object.`
- **`@better-auth/cli`'s latest is 1.4.21**, three minors behind the pin;
  `npx @better-auth/cli@1.7.2` fails with `ETARGET: No matching version found`; and
  `better-auth@1.7.2` ships no `bin` at all.
- **`getTableConfig` from `drizzle-orm/pg-core` is public** and returns each column's `name`,
  `getSQLType()`, `notNull` and `primary` — enough to build `CREATE TABLE` from the shipped schema.
- **The conformance check bites.** `getAuthTables()` compared against a hand-written seven-table
  schema immediately reported `invitation.createdAt MISSING from drizzle schema`.
- **`better-auth/adapters/drizzle` and `@better-auth/drizzle-adapter` export the identical function
  object**: `inlined.drizzleAdapter === standalone.drizzleAdapter` is `true`.

**Both guards on the duplicate sign-up throw are real, one instance each.** The same duplicate
sign-up, run against three `emailAndPassword` configurations:

| `emailAndPassword` config         | Duplicate sign-up                                    |
| --------------------------------- | ---------------------------------------------------- |
| default (what this package ships) | **throws** `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`   |
| `autoSignIn: false`               | **no throw**, returns `{ token: null, user: {...} }` |
| `requireEmailVerification: true`  | **no throw**, returns `{ token: null, user: {...} }` |

The generic response is **indistinguishable from a real sign-up**: the same shape, a populated
`user`, `token: null`. A caller cannot detect the duplicate at all. That is the point of it
upstream — the sign-up endpoint must not be a user-enumeration oracle — which is why the right
reading of this table is "a named failure was traded for a security property", not "a bug".

### Measured while building the gates, 2026-09-03

Run by the orchestrator at the same pins while the gates were being written, so the provenance is one
round later than the list above. Three of these contradicted the contract as it stood and are folded
into the body; two are upstream behaviours that no sentence here implied.

- **The browser client is a Proxy whose target is a function.** `typeof authBrowserClient` is
  `'function'`. With the organization plugin **absent**: `typeof authBrowserClient.organization` is
  `'function'`, `typeof authBrowserClient.organization.create` is `'function'`, and
  `typeof authBrowserClient.definitelyNotAPlugin` is `'function'`.
  `'organization' in authBrowserClient` is `false` in **both** configurations. Against the schema as
  it stood, `authBrowserClientSchema.safeParse(realClient).success` was **`false`** — three of its
  five checks failed, including the root — so the implementor could not both return a Better Auth
  client and satisfy the contract. Corrected: the schema now asserts the root value only, and the
  reason every deeper check is vacuous is recorded beside it.
- **A duplicate organization slug throws `ORGANIZATION_ALREADY_EXISTS` at HTTP 400**, read at
  `error.body?.code` and `error.statusCode`. The contract's earlier illustration, `SLUG_TAKEN`,
  appears **zero times** in `better-auth`'s dist.
- **`headers` is required by two of the wrapped endpoints and rejected by a third.**
  `signInMagicLink` and `magicLinkVerify` without it: `APIError` 400 `VALIDATION_ERROR`, message
  `Headers is required`. `createOrganization` with `new Headers()`: `UNAUTHORIZED` 401,
  **`body: undefined`**, empty message. `addMember` works either way.
- **Verifying a magic link for a user who already has a password deletes that user's `account`
  rows**, so password sign-in for them afterwards gives `INVALID_EMAIL_OR_PASSWORD`. Reproduced twice.
- **With `next` not installed, every cookie-setting call fails.** Sign-up, sign-in and magic-link
  verification all returned `auth-request-failed` until `next@16.3.3` was added, because
  `nextCookies()`'s `after` hook rethrows a message it does not recognise and
  `Cannot find package 'next' imported from …` is not one of the two it swallows.

### Measured while closing the contract, 2026-09-03

Run by the orchestrator at the same pins, one round later again. The first two close items that were
sitting on Still not verified. The third is a correction to the orchestrator's own earlier text in
this file, not to anything a subagent wrote.

- **The organizations flag's effect at the network boundary, with its own negative control.** One
  POST to `/api/auth/organization/create` handed to `authServerInstance.handler(request)`, the same
  request against two instances: built with `organizationsEnabled: false` the answer is **404**;
  built with `organizationsEnabled: true`, with no session on the request, it is **401**. **Both
  bodies are empty**, so the status is all there is to match on. Why a gate must assert the pair
  rather than the 404 alone is argued under What the organizations flag does and does not change on
  the browser client; the two values are exported as `organizationRouteAbsentHttpStatus` and
  `organizationRouteUnauthorizedHttpStatus`.
- **`ORGANIZATION_ALREADY_EXISTS` confirmed as the slug-collision code, and the near-miss confirmed
  as a near-miss.** A real collision throws it at **HTTP 400**, message `Organization already
exists`, with `body` **present**. Both `ORGANIZATION_ALREADY_EXISTS` and
  `ORGANIZATION_SLUG_ALREADY_TAKEN` exist at the v1.7.2 tag as adjacent `$ERROR_CODES` entries, and
  only the first is thrown here.
- **`error.body` has no guaranteed shape, which corrects an earlier line in this file.** A previous
  round recorded that `error.body` "has exactly `{ message, code }`". That was measured only on the
  paths probed at the time and is false in general: the `createOrganization`-with-headers 401 carries
  `body === undefined`. So `error.body?.code` is required, and a plain `error.body.code` throws a
  `TypeError` on that path and breaks the never-throws promise.

### Measured while writing the gates, second pass, 2026-09-03

Found by the gate-writer at the same pins and confirmed before being written down. The first two were
re-checked against this repo's own files by this agent; the third and fourth are the gate-writer's
command output, recorded with that provenance rather than restated as first-hand.

- **The workspace has exactly one peer-suffixed `drizzle-orm` resolution.** `pnpm-lock.yaml` holds
  one `drizzle-orm@0.45.2` snapshot and no second one. Read directly in the lock file, and still one
  entry when the lock was re-read on 2026-09-04 after this package was installed — but **the suffix
  on it has changed since this round measured it**, from
  `(@opentelemetry/api@1.9.1)(@types/pg@8.23.1)(pg@8.23.0)` to
  `(@opentelemetry/api@1.9.1)(@types/pg@8.23.1)(kysely@0.29.5)(pg@8.23.0)`, because `better-auth`
  brings `kysely`. The count is the durable half of this measurement and the suffix is not; see
  Dependencies.
- **`@hearthkit/db` declares both halves of the peer pair.** `packages/db/package.json` has
  `pg@8.23.0` under `dependencies` and `@types/pg@8.23.1` under `devDependencies`. Read directly in
  the manifest. Together with the bullet above, this is why the dev list for this package must name
  `@types/pg@8.23.1` as well as `pg@8.23.0`.
- **Omitting `@types/pg` produces a type error, not a warning.** A manifest with `pg` and no
  `@types/pg` resolved a second `drizzle-orm@0.45.2` and typechecking then reported
  `TS2322 … Property 'dialect' is protected but type 'PgSession<…>' is not a class derived from 'PgSession<…>'`
  at the point `@hearthkit/db`'s client is passed as `drizzleClient`.
- **A `globalThis.fetch` stub installed after the client was built was ignored, and the request went
  somewhere real.** The browser client kept the genuine `fetch`, reached `http://localhost:3000`, and
  received a full Next.js page from whatever was already listening on the machine. The same probe on
  CI would fail with `ECONNREFUSED`. This is the measurement behind the ordering rule under What the
  organizations flag does and does not change on the browser client.

### Still not verified

Four items sat here through the contract rounds and are now closed by the implementation and its
gates. They are closed **in place**, with the evidence attached, rather than deleted: this is the
section a reader checks to see what is **not** covered, and an item that silently vanishes reads the
same as one that was never raised.

- **Closed: the manifest, and with it the typecheck.** `packages/auth/package.json` exists, and
  `packages/auth typecheck: Done` appears explicitly in the project list — locally and on CI run
  33835915997, **checked by grep rather than inferred from exit 0**. So `auth-contract.ts` really is
  checked with `strict`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly` and
  `isolatedModules` from `tsconfig.base.json`, and its type-only `@hearthkit/email/email-contract`
  import really does resolve under this package's own `tsconfig.json`. The isolated-typecheck harness
  that stood in for this while there was no manifest is no longer needed here. **The trap it guarded
  against is still live and has caught this repo six times**: `pnpm --filter` against a package with
  no manifest reports no matching project and exits 0, so the green is evidence of nothing. It is
  closed **for this package** by the manifest; the next package into this workspace has to close it
  again.
- **Closed: Prettier.** `pnpm run format:check` exits 0 across the repo with this file and
  `auth-contract.ts` exactly as committed, orchestrator-run — every hand-padded table and hand-wrapped
  line held, so the instruction that used to stand here, to run `pnpm run format` once before
  committing rather than assuming, has been replaced by the run itself. **What the check still does
  not cover is the comment blocks in `auth-contract.ts`**: Prettier does not reflow comment interiors
  at all, so the wrapping there is house style a reader maintains by hand, and `format:check` passing
  says nothing about it. That holds for every later edit too — the check is the evidence, and
  reasoning about `proseWrap` and column counts is not the same evidence.
- **Closed: `authBrowserClientSchema` parsed against a real client.** It used to be a deduction from
  `typeof authBrowserClient === 'function'` rather than the evidence itself. A gate now parses a real
  client with it, in all four combinations of the flag and the optional `baseUrl` —
  `create-auth-browser-client.test.ts`, "returns a client `authBrowserClientSchema` accepts, in both
  modes and with or without a baseUrl".
- **Closed: the 404 and the 401 through the browser client, not only at the handler.** The same gate
  file drives the **real** browser client over a loopback listener carrying a server instance, and
  reads `{ data: null, error: { status: 404 } }` from the flag-off server and `{ status: 401 }` from
  the flag-on control, with the listener recording `POST /api/auth/organization/create` both times.
  That the client surfaces both on its `{ data, error }` arm rather than throwing was the one part
  previously taken from documentation rather than measured; it is measured now.

What is still not covered are the three clauses under Clauses no gate covers — `nextCookies()`'s
effect, which needs a running Next app rather than Vitest; the Google and GitHub sign-in redirect,
which needs a real client ID at a real provider; and `sendResetPassword`, which is wired but reachable
only through the route handler, for which this package exposes no wrapper. Add to those the positive
arm of the organization route: `organization.create` actually creating an organization through the
route handler is session-scoped by construction, which is why the server-side provisioning pair
exists.

Resolved earlier and struck from this list: whether the thrown 302 `Error` carries the redirect
`location` — it does, at `error.headers.get('location')`; and what the organizations flag's effect at
the network boundary actually is — 404 from the flag-off instance against 401 from the flag-on one,
both with empty bodies. Both are measured above.

## Rulings and corrections

Seven rounds. Every question raised in any of them has been ruled on and folded into the body above.
The corrections are recorded here rather than silently absorbed, because in each case a future reader
should see what was wrong and not only the conclusion.

**Corrected against measured evidence.** The orchestrator ran, at the pin, the probes this agent
could not. Five things in round one did not hold:

1. **The sign-up error code was wrong, and it was a live defect.** The contract encoded
   `USER_ALREADY_EXISTS`. What is thrown is `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, HTTP 422. Both
   exist in `$ERROR_CODES`, so checking the library would have confirmed the wrong answer. Fixed in
   the mapping table, in the failure detail, and at `betterAuthEmailAlreadyRegisteredErrorCode` —
   renamed from `betterAuthUserAlreadyExistsErrorCode` so the symbol no longer mirrors the decoy.
2. **The magic link URL always carries two query parameters.** Round one said `callbackURL` appears
   only when `callbackUrl` was supplied, which implied a single-parameter case exists. None does:
   the value defaults to `%2F`. That makes the "read the text part" rule unconditional, and it means
   a "no callbackUrl" gate asserting HTML-verbatim behaviour would pass for the wrong reason.
3. **The mapping table did not say where the error code lives.** It is at `error.body.code`;
   `error.code` is `undefined`. An implementation reading the obvious property routes every case
   into the catch-all, and the failure is total and invisible.
4. **The shape of a database failure was an assumption; it is now measured.** The code sits exactly
   one `.cause` hop below a `DrizzleQueryError` that carries no code itself, and every producer
   arrives as a raw Drizzle error rather than an `APIError`. Round three then found the list of codes
   too short; see below.
5. **Two Verified bullets overstated.** `activeTeamId` is added only when teams are enabled, and
   `drizzleAdapter`'s `schema` option is mandatory rather than conventional.

Found while applying those corrections, and not part of them: turning `requireEmailVerification` on
would delete `auth-email-already-registered`'s only producer. Recorded under How a Better Auth
signal becomes a failure, and the Out of scope claim that said the change was additive is corrected.

**Questions ruled.**

1. **`sendResetPassword` wired, no reset wrappers exported — accepted** as recommended. Decision 6.
2. **`requestedSocialProviders` — accepted** as recommended, optional, defaulting to empty.
3. **`verifyAuthTablesExist` — accepted** as recommended, and given a second job in Decision 2.
4. **`drizzle-kit` as a devDependency — rejected.** Replaced by Decision 9.
5. **`npx @better-auth/cli generate` — rejected, the premise was false.** Replaced by Decision 10.
6. **Prettier — done by the orchestrator.** See Still not verified.

**Round three.** Three flags were raised against the round-two text and all three were probed at the
pin. Two resolved in the flag's favour; one went against it, because the fact the flag rested on had
expired.

1. **The duplicate sign-up guard is measured, not inferred.** Round two read
   `shouldReturnGenericDuplicateResponse` from upstream source and reasoned from it. All three
   configurations were then run at the pin and both guards were confirmed independently, one instance
   each. The table is under Measured. The two facts that make this the sharpest edge in the contract
   are now stated outright rather than implied: the generic response is indistinguishable from a real
   sign-up, so the duplicate is not reported differently but not reported at all; and
   `autoSignIn: false` breaks the gate exactly as `requireEmailVerification: true` does, which
   matters because `autoSignIn` is the trigger nobody would think to check.
2. **`asResponse: true` is not mandatory for the magic link failure arm.** Round two pinned the
   signal but not how to read `location` off a thrown value that is not an `APIError`, and parked the
   question on Still not verified. Measured: the throw carries a real `Headers` instance, so
   `error.headers.get('location')` returns the redirect URL and `error.headers.location` is
   `undefined`. `asResponse: true` is now recorded as a choice with a reason to prefer it, not a
   requirement, and the property-versus-`get` trap is paired with `error.code` versus
   `error.body.code` so a reader sees one pattern instead of two coincidences.
3. **`auth-database-unavailable` was too narrow, and the reason it was narrow had expired.** Round
   two limited it to `ECONNREFUSED` and `42P01` on the stated grounds that no gate produced any other
   code. The rule was right — never widen a failure past its evidence — but the evidence then
   arrived: `3D000` and `28P01` were produced at the pin by changing the connection string and
   nothing else, both are ordinary wrong-`DATABASE_URL` first-run states, and both are cheaper to
   gate than either code already listed. The variant now names four codes as an **explicit
   allowlist**, and the contract says why it is not "any cause carrying a code": that would swallow
   `23505`, a unique violation the organization slug path can race into, which is a caller error and
   must never be reported as an unavailable database.

Two further things were settled in round three and are recorded so they are not reopened.
`verifyAuthTablesExist` and the Decision 10 conformance gate are **separate jobs** — one asks a live
database whether the tables were created, the other asks whether the shipped schema still matches
`getAuthTables()` — and both decisions now say so instead of sitting adjacent and confusable. And
`betterAuthEmailAlreadyRegisteredErrorCode` keeps the name that describes the failure rather than
mirroring the upstream literal, because a symbol that mirrors the decoy is exactly how the wrong code
stayed invisible in round one.

**Round four — three defects found by writing the gates against this contract, one of them a hard
blocker.** All three were measured by the orchestrator at the pin rather than taken from a report,
and the gates were not yet approved, so nothing already banked was lost.

1. **`authBrowserClientSchema` rejected the value its own function is specified to return.** Three of
   its five checks failed against a real client, including the root: `createAuthClient` returns a
   Proxy whose target is a **function**, so `typeof client` is `'function'` and so are `signIn` and
   `signUp`. The implementor could not have satisfied it. The schema now checks the root value alone.
   **The larger half of this fix is the reason, not the check**: every deeper property assertion is
   vacuous against a blanket Proxy, because `typeof client.definitelyNotAPlugin` is `'function'` too,
   so `typeof client.useSession === 'function'` would pass against a client with no `useSession`. That
   is recorded in a comment above the schema and in What the organizations flag does and does not
   change on the browser client, so nobody "hardens" it later with checks that assert nothing.
2. **The organizations flag has no client-side observable effect, and the ruling was to relocate the
   observation rather than drop it.** The contract said `organization` is present only with the flag
   on, and that its presence-or-absence is what a gate asserts. Measured, it is readable in both modes
   and `'organization' in client` is `false` in both. **Ruled by the user: keep the intent, assert it
   at the network boundary** — a client built with the flag off, calling through a server instance
   built with the flag off, fails because the server has no such route. Two alternatives were put to
   the user and rejected: narrowing the promise and deleting the gate, which makes the flag decorative
   on the client; and wrapping the client so `organization` is genuinely absent, which adds public
   surface and stops the returned value being a plain Better Auth client. No public surface was added.
3. **`SLUG_TAKEN` does not exist.** It appears zero times in `better-auth`'s dist, and a gate
   asserting it would have failed against every correct implementation. The real code is
   `ORGANIZATION_ALREADY_EXISTS` at HTTP 400. The near-miss `ORGANIZATION_SLUG_ALREADY_TAKEN` **is**
   real and is not what this endpoint throws, so the fix records both the right answer and the decoy.

Three things were added in the same round that were not defects in the contract but that no sentence
here implied: `next@16.3.3` as a **devDependency**, without which `nextCookies()` rethrows and every
cookie-setting call fails; the `headers` disagreement between `signInMagicLink`, `magicLinkVerify` and
`createOrganization`; and magic-link verification deleting the `account` rows of a user who already
has a password. The first also corrects the ungated-clauses claim that `nextCookies()` "cannot break
the gates" — true only because `next` is now installed on purpose. The second forced a smaller
correction of its own: `error.body` is `undefined` on that 401, so the code must be read as
`error.body?.code` or the handler throws where it promised not to.

**Round five — the network boundary pinned, and four rulings that left the text as it stood.** The
measurement round four asked for was run, so the last "does not succeed" in this contract is gone.

1. **The 404 is pinned, and so is its control.** Round four ruled that the organizations flag be
   asserted at the network boundary, but could only say the call "does not succeed", because no status
   had been measured. Both are measured now, and they are pinned **as a pair** rather than the 404
   alone: a gate asserting only the 404 could be satisfied by a typo in the path, and the 401 from the
   flag-on instance — same request, no session on it — is what proves the route exists and rules that
   out. Two constants carry the pair so a gate never writes the numbers bare. Both bodies are empty,
   so there is nothing else to assert.
2. **`authBrowserClientSchema` stays pinned to `'function'` alone.** Widening it to accept `'object'`
   as well would reduce the check to "not null and not a primitive", which asserts nothing. Pinning
   the measured reality means a release that stops proxying fails this check loudly. That is the same
   argument this contract already makes for exact-equality error-code matching, and staying consistent
   with it is worth the one-line change a future non-Proxy client would cost.
3. **`organization` stays optional on `AuthBrowserClient`.** Making it required would reject the
   flag-off client at the annotation site. The truth — that a runtime read never returns `undefined`
   in either mode — belongs in the comment on the property and in the prose, not in the type, and it
   is stated in both because a type that reads like a feature test and is not one has to be
   contradicted out loud.
4. **`betterAuthOrganizationAlreadyExistsErrorCode` stays exported.** It matches how the other three
   Better Auth literals are exported and hands a gate a symbol instead of a hand-typed string, which
   is what stopped the `USER_ALREADY_EXISTS` decoy surviving.
5. **`error.body?.code` confirmed, and the sentence that would have justified the plain form is
   retracted.** The optional chain was kept for the right reason: the `createOrganization`-with-headers
   401 carries `body === undefined`. What was wrong is an earlier round's claim that `error.body`
   "carries exactly `{ message, code }`" — measured on the paths probed at the time, and false in
   general. Both places that stated it now say which cases it covers, and the doc comments naming the
   access path spell it with the optional chain so the unsafe form is not there to be copied.

One thing was added rather than ruled. `ORGANIZATION_SLUG_ALREADY_TAKEN` is now named in the body as
the near-miss this endpoint does **not** throw, alongside the code it does. Three near-misses have
bitten this package — the short `USER_ALREADY_EXISTS`, the fabricated `SLUG_TAKEN`, and this one —
which is enough to state the habit as a rule: never take an error code for this library from
documentation or from memory, read it off a thrown error.

Line width was checked against the repo rather than settled by preference: the longest line in
`packages/email/CONTRACT.md` is 975 characters and in `packages/storage/CONTRACT.md` 923, Prettier's
`proseWrap` is `preserve`, and `prettier --check` passes on either style. Unwrapped prose is the
convention here, so the mixed wrapping in this file was left as it is and nothing was rewrapped.

**Round six — three items from writing the gates. No behaviour changed; one export was added.** All
three are documentation of facts that already held, which is why none of them reopens a decision.

1. **`@types/pg@8.23.1` was missing from the dev list, and its absence would have broken the
   implementor.** The list named `pg@8.23.0` alone. Written verbatim, this package would resolve a
   `drizzle-orm@0.45.2` with a different peer suffix from `@hearthkit/db`'s, pnpm would materialise a
   second copy, and passing db's client as `drizzleClient` would fail to typecheck against a
   `protected` member. Added to the list **with the reason attached**, because an `@types` entry that
   no `import` justifies is exactly what a later reader prunes. The lock-file and manifest evidence is
   under Measured while writing the gates, second pass.
2. **The two ways of routing the browser client to the server are not equivalent, and the contract
   presented them as if they were.** `createAuthClient` captures `fetch` at construction time, so a
   stub installed afterwards is silently ignored and the client makes real requests. Both options are
   kept — the intent was never to mandate one — but the stub now carries an ordering rule and the
   listener is noted as free of the hazard. This is the **fourth** instance of the shape where the
   obvious spelling returns a wrong answer rather than an error, so the shape itself is now named
   under How a Better Auth signal becomes a failure rather than left as three coincidences and a
   fourth.
3. **`betterAuthOrganizationAlreadyExistsHttpStatus` added.** The slug collision had a named code and
   a bare `400`, while the 404 and the 401 both had names. The asymmetry was small enough that the
   gate-writer correctly declined to spend a round on it; taken here because a round was already
   being spent. The rule it restores is worth more than the export costs: **every HTTP status this
   contract pins has a name**, so a number in a gate is always traceable to the measurement that
   produced it.

**Round seven — the contract reconciled against a green implementation, 2026-09-04. Documentation
only: no schema, no signature and no failure mode changed, so nothing already verified was
invalidated.** The package is implemented, with 40 of 40 gates passing and CI green on run 33835915997. That turned four Still not verified items into measurements, answered one open question
in the services list, and made one Dependencies fact stale.

1. **Four items closed on Still not verified, in place rather than deleted.** The manifest and the
   typecheck it makes real; Prettier; `authBrowserClientSchema` parsed against a real client; and the
   404/401 pair observed through the real browser client rather than at the handler. Each carries the
   evidence that closed it, because a section that only ever loses lines stops being readable as a
   map of what is not covered — and what genuinely remains uncovered is now stated there too.
2. **The exact drizzle peer suffix is no longer named as the check.** Installing this package added
   `kysely@0.29.5` to the resolved peer set — `better-auth` brings it and `drizzle-orm` lists it as an
   optional peer — so the literal string this contract pinned went stale inside one loop. Swapping in
   the new string was **rejected**: `@hearthkit/payments` is next into this workspace and may change
   it again. The durable statements are that `@types/pg` must be declared here, and that the check is
   `packages/auth/node_modules/drizzle-orm` and `packages/db/node_modules/drizzle-orm` resolving to
   the same real path, which they do. The suffix is quoted only as an example that will drift.
3. **The browser-client gate needs no database, which was an open question in the services list.**
   Both halves run against instances built over a Drizzle client aimed at a closed port and still
   answer their pinned statuses, so route resolution and the no-session rejection both happen before
   the adapter is touched.

No question is open. Nothing in this contract is waiting on an answer.
