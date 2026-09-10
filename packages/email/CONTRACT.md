# @hearthkit/email — contract

## Purpose

Send transactional email from React Email templates through a swappable transport: Mailpit over SMTP locally, Resend in production, chosen by one environment variable. One template produces both parts of every message — the HTML body and a readable plain text body — so the two can never drift apart. The package holds no state: the transport and its credentials arrive as a call parameter and the connection is closed before the call returns, which is what keeps a future secrets manager, a second region and a delivery queue open. It knows nothing about users, sessions or tokens; a caller such as `@hearthkit/auth` builds the sign-in URL and passes it in as a template prop.

## Inputs

### Environment variables

| Name                    | Type                                  | Required                                    | Example                  |
| ----------------------- | ------------------------------------- | ------------------------------------------- | ------------------------ |
| `EMAIL_TRANSPORT`       | enum `smtp` \| `resend`               | required when `email` is installed          | `smtp`                   |
| `EMAIL_FROM`            | mailbox, with or without display name | required                                    | `Acme <hello@acme.test>` |
| `EMAIL_SMTP_HOST`       | hostname or dotted IPv4               | required when `EMAIL_TRANSPORT=smtp`        | `localhost`              |
| `EMAIL_SMTP_PORT`       | whole number 1 to 65535               | required when `EMAIL_TRANSPORT=smtp`        | `1025`                   |
| `EMAIL_SMTP_USER`       | non-empty string                      | optional; both or neither with the below    | `apikey`                 |
| `EMAIL_SMTP_PASSWORD`   | non-empty string                      | optional; both or neither with the above    | `s3cret`                 |
| `EMAIL_RESEND_API_KEY`  | non-empty string                      | required when `EMAIL_TRANSPORT=resend`      | `re_123abc`              |
| `EMAIL_RESEND_BASE_URL` | http(s) URL with no path              | optional, defaults `https://api.resend.com` | `http://127.0.0.1:53310` |

Declared in `emailEnvSchemaFragment` and composed by `@hearthkit/config` (empty string counts as unset, per config's contract). This package never reads `process.env` itself. Every variable carries the `EMAIL_` prefix, including the two Resend ones: `RESEND_API_KEY` and `RESEND_BASE_URL`, which the Resend SDK reads on its own, are deliberately not used, so the SDK can never pick up an ambient value and mask a misconfiguration. The key is always passed to the constructor explicitly.

**"Required when" is enforced by `resolveEmailTransportConfig`, not by the fragment.** Config flattens fragments into one object and validates in a single pass, and `composeEnvSchemaFragments` rebuilds a fresh `z.object` from `fragment.shape`, so a cross-field refinement on the fragment would be silently dropped rather than run. Every per-transport variable is therefore optional in the fragment, and the app calls `resolveEmailTransportConfig({ emailEnv: config })` immediately after config loads. With `EMAIL_TRANSPORT=resend` and no API key, config succeeds and the resolver returns `email-transport-config-incomplete` with `missingVariableNames: ['EMAIL_RESEND_API_KEY']`; the app's boot path throws that message, so the process fails to start with the variable name in the text. Nothing is ever sent with a half-built transport.

Resolution rules, in full:

- `EMAIL_TRANSPORT=smtp` requires `EMAIL_SMTP_HOST` and `EMAIL_SMTP_PORT`.
- `EMAIL_SMTP_USER` and `EMAIL_SMTP_PASSWORD` must be both set or both unset. One without the other is incomplete and the message names the missing one. Mailpit needs neither.
- `EMAIL_TRANSPORT=resend` requires `EMAIL_RESEND_API_KEY`. `EMAIL_RESEND_BASE_URL` always has a value because it is defaulted.
- Variables belonging to the transport that was **not** selected are ignored, never an error. A local `.env` routinely carries both sets.
- Every missing variable is reported in one call, one per line after the prefix, never first-failure only.

### Shared vocabulary

- `EmailAddress` — branded; one bare mailbox, no display name. This is what a recipient is.
- `EmailSender` — branded; either a bare mailbox or `Display Name <mailbox>`. `EMAIL_FROM` only.
- `EmailSubject` — branded; 1 to 200 characters, no control characters.
- `EmailTemplateName` — branded; lowercase kebab-case, at most 63 characters. Same shape as `HealthCheckName` in `observability`.
- `EmailLinkUrl` — branded; an http(s) URL. `http` is allowed so `http://localhost:3000/...` works in development.
- `EmailProductName` — branded; 1 to 64 characters, no control characters. Optional branding for template copy.
- `SmtpHostName`, `SmtpUserName`, `SmtpPassword`, `ResendApiKey`, `ResendBaseUrl` — branded. `SmtpPassword` and `ResendApiKey` are secrets: they never appear in a failure of any kind, in a log line, or in a render or send result. They do appear in an `EmailTransportConfig`, because carrying them to the send call is its entire job; `resolveEmailTransportConfig`'s success value is the single exception. `SmtpHostName` and `SmtpUserName` are not secrets and may appear in a message. `SmtpCredentials` holds the user name and password as one value, so a half-filled pair is unrepresentable.
- `EmailTransportConfig` — a discriminated union on `kind`, `smtp-email-transport` or `resend-email-transport`. `emailFrom` sits on both arms; the rest differs.
- `TransportMessageId` — branded; opaque. Its shape differs per transport (an RFC Message-ID for SMTP, a UUID for Resend), so never parse or construct one.
- `TransactionalEmailTemplate<TProps>` — `{ emailTemplateName, buildEmailSubject(props): string, buildEmailElement(props): ReactElement }`.

### Public functions

Three functions. All return their failures as values; none throws for a contract failure mode. Each takes one options object, as every other hearthkit function does; the plan's `(template, props, to)` values are present under those names.

- `resolveEmailTransportConfig({ emailEnv })` — synchronous, contacts nothing. `emailEnv` is the validated config object; extra keys are ignored, so an app passes `config` straight through. Run once at boot.
- `renderTransactionalEmail({ emailTemplate, templateProps, subject? })` — renders both message parts. Contacts nothing, needs no transport, so it is fully gateable with no service running. `subject` overrides what the template builds.
- `sendTransactionalEmail({ emailTransportConfig, emailTemplate, templateProps, to, subject? })` — renders through `renderTransactionalEmail`, then sends to exactly one recipient.

**Subject.** Each template owns its subject: `buildEmailSubject(props)` returns a string, which the package parses through `emailSubjectSchema`. `subject` on the options object overrides it and must already be branded, so a caller with a raw string parses it first. Template-owned because the known consumer is `@hearthkit/auth`, which sends from inside Better Auth callbacks and is the wrong package to own copy. A subject the template builds that fails the schema — empty, over 200 characters, or containing a control character — is reported as `email-template-render-failed`, because the template is at fault. A control character in a subject is the classic header-injection vector, so this check is load-bearing.

**Recipient.** `to` is exactly one address, typed as a plain `string` and validated at runtime with `emailAddressSchema` before any transport is contacted. Plain `string` because the recipient is the one value that always originates from user input, and late validation is useless here: `to: 'not-an-email'` never reaches the SMTP server, because nodemailer's address parser drops it and reports `No recipients defined`, a diagnostic that points at the wrong cause. The success result echoes the parsed, branded `EmailAddress`. One recipient, not a list: several people in one `To` header leak each other's identities, and a multi-recipient send has a partial-success state (nodemailer counts a message as sent if any recipient was accepted) that no single result value models honestly.

## Outputs

- `resolveEmailTransportConfig` returns `{ kind: 'email-transport-config-resolved', emailTransportConfig }` or a failure.
- `renderTransactionalEmail` returns `{ kind: 'transactional-email-rendered', emailTemplateName, subject, htmlBody, textBody }` or a failure. `htmlBody` is a complete XHTML-doctype HTML document; `textBody` is readable plain text with link URLs inlined. Both come from one render of one element.
- `sendTransactionalEmail` returns `{ kind: 'transactional-email-sent', emailTemplateName, to, subject, transportMessageId }` or a failure. `to` is the parsed, branded address; `subject` is the one the render produced.

The send result deliberately does **not** carry `htmlBody` or `textBody`: a transactional body routinely contains a single-use sign-in URL, and a result value is exactly what ends up in a log line. A caller that wants the bodies calls `renderTransactionalEmail`. `transportMessageId` is nodemailer's `info.messageId` on the SMTP path, not the queue id in the `250 2.0.0 Ok: queued as <ID>` response; that queue id equalling Mailpit's own message id is a Mailpit detail a gate may use to correlate, but nothing in the package may depend on it.

### Templates the package ships

Two, exported as `TransactionalEmailTemplate` values. The set is small on purpose: a template is copy, and copy nobody sends goes stale.

- **`magicLinkEmailTemplate`** — name `magic-link-sign-in`, props `{ signInUrl, productName?, expiryMinutes? }`. Plan 4.7 enables magic link and its gate reads the link out of Mailpit.
- **`passwordResetEmailTemplate`** — name `password-reset`, props `{ passwordResetUrl, productName?, expiryMinutes? }`. Plan 4.7 enables email and password; without this mail a user who forgets a password is locked out.

Both templates promise three things a gate can check:

1. **`textBody` carries the action URL verbatim, always. `htmlBody` carries the same URL HTML-escaped.** React renders `&` as `&amp;` in both the `href` and the visible text, so `?token=abc123&callbackURL=%2Fdashboard` appears as `?token=abc123&amp;callbackURL=%2Fdashboard`. That is the same URL and works when clicked, but it is not byte-identical, so a substring search for a multi-parameter URL against `htmlBody` finds nothing. A single-parameter URL matches in both parts, which hides the problem; Better Auth callbacks routinely carry two parameters. The plain text part is the extraction point a consumer, `auth` included, must read. Neither part shortens, wraps or tracks the URL.
2. The URL is reachable as a clickable button in the HTML part and as visible text as well, so a client that strips buttons still lets a person copy the link.
3. `productName` and `expiryMinutes` are optional. Omitted, the copy and the subject read generically ("Your sign-in link"); supplied, they read specifically ("Sign in to Acme", "This link expires in 15 minutes"). `auth` can therefore send working mail without hearthkit inventing a product-name environment variable.

An app is not limited to these two. `TransactionalEmailTemplate` is a plain object type, so an app or another package builds its own from `react-email` components and passes it to the same functions.

### Package entry point

`src/index.ts` is the package entry, a thin named re-export (no `export *`). Its value exports are a fixed allowlist of exactly these fifteen, and nothing else:

1. `resolveEmailTransportConfig`
2. `renderTransactionalEmail`
3. `sendTransactionalEmail`
4. `magicLinkEmailTemplate`
5. `passwordResetEmailTemplate`
6. `emailEnvSchemaFragment`
7. `emailFailureSchema`
8. `emailTransportConfigSchema` — the transport input every send takes; an app gets it from `resolveEmailTransportConfig` or builds it itself
9. `resolveEmailTransportConfigResultSchema`
10. `renderTransactionalEmailResultSchema`
11. `sendTransactionalEmailResultSchema`
12. `emailLinkUrlSchema` — `auth` brands the sign-in and reset URLs with it
13. `emailProductNameSchema` — `auth` brands the product name with it
14. `emailTemplateNameSchema` — an app's own template names itself with it
15. `emailSubjectSchema` — the optional subject override on `sendTransactionalEmail` is branded, so an app that overrides must construct it

Type exports are not counted and stay: the branded types under Shared vocabulary, `EmailEnvValues`, `EmailTransportConfig`, `EmailFailure`, `TransactionalEmailTemplate`, `MagicLinkEmailProps`, `PasswordResetEmailProps`, and each function's options, result and function types (`ResolveEmailTransportConfigOptions`, `ResolveEmailTransportConfigResult`, `ResolveEmailTransportConfig`, `RenderTransactionalEmailOptions`, `RenderTransactionalEmailResult`, `RenderTransactionalEmail`, `SendTransactionalEmailOptions`, `SendTransactionalEmailResult`, `SendTransactionalEmail`).

Every other value in `email-contract.ts` is internal: the six message-prefix constants, `defaultResendBaseUrl`, `implicitTlsSmtpPort`, `maximumEmailSubjectLength`, `maximumEmailLinkExpiryMinutes`, `smtpConnectionTimeoutMs`, `smtpSocketTimeoutMs`, `unknownEmailTemplateName`, `magicLinkEmailTemplateName`, `passwordResetEmailTemplateName`, `emailAddressSchema`, `emailSenderSchema`, `emailLinkExpiryMinutesSchema`, `emailTransportNameSchema`, `smtpHostNameSchema`, `smtpPortNumberSchema`, `smtpUserNameSchema`, `smtpPasswordSchema`, `smtpCredentialsSchema`, `resendApiKeySchema`, `resendBaseUrlSchema`, `smtpEmailTransportSchema`, `resendEmailTransportSchema`, `emailEnvVariableNameSchema`, `transportMessageIdSchema`, the six per-variant failure schemas, `transactionalEmailTemplateSchema`, `magicLinkEmailPropsSchema`, `passwordResetEmailPropsSchema`, and the three options schemas. The implementation and this package's own gates may import them from `email-contract.ts` directly, but they are not part of the public surface and may change without a changeset. The three per-arm success schemas (`emailTransportConfigResolvedSchema`, `transactionalEmailRenderedSchema`, `transactionalEmailSentSchema`) are module-private inside `email-contract.ts` and reachable only through the result unions; a caller that has narrowed a result on `kind` already holds the validated shape.

**The `./email-contract` subpath.** The manifest publishes a second subpath, `./email-contract`, because `@hearthkit/auth` imports it (completion plan step 5 policy). It resolves to a JSX-free named re-export module, `src/email-contract-entry.ts`, whose value exports are exactly the ten allowlisted names that live in `email-contract.ts` (items 6 to 15 above) plus every public type listed above. It carries none of the three functions or the two templates: the subpath exists to be loadable by a bare `node` process, and the `.` entry transitively imports `.tsx` template modules that bare `node` refuses. `auth`'s imports all resolve there: `emailTransportConfigSchema` at runtime, and the types `EmailFailure`, `EmailTransportConfig`, `TransportMessageId`, `EmailProductName`, `MagicLinkEmailProps` and `PasswordResetEmailProps`. Both `email-contract-entry.ts` and `email-contract.ts` import only `zod` at runtime plus a type-only `react` import for `ReactElement`, which is erased, so each runs under bare `node` and importing either has no side effect.

## Failure modes

All failures are one discriminated union, `EmailFailure`, on `kind`. Every variant carries a `message` starting with its unique literal prefix.

| `kind`                              | When                                                               | Message prefix                                 | Returned by  |
| ----------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------- | ------------ |
| `email-transport-config-incomplete` | Chosen transport is missing a variable, or a half-filled SMTP pair | `hearthkit email transport config incomplete:` | resolve      |
| `email-recipient-invalid`           | `to` is not one valid mailbox                                      | `hearthkit email recipient invalid:`           | send         |
| `email-template-render-failed`      | Template threw, or produced a subject the schema rejects           | `hearthkit email template render failed:`      | render, send |
| `email-transport-unreachable`       | Refused, unresolved, timed out, or STARTTLS required and missing   | `hearthkit email transport unreachable:`       | send         |
| `email-transport-rejected`          | Transport was reached and refused the session or the message       | `hearthkit email transport rejected:`          | send         |
| `email-send-failed`                 | Anything else, so nothing escapes as a throw                       | `hearthkit email send failed:`                 | send         |

### How a transport signal becomes a failure

The mapping is part of the contract. Anything not listed lands in the catch-all, and the catch-all is reached by an ordinary misconfiguration: pointing `EMAIL_SMTP_HOST` and `EMAIL_SMTP_PORT` at a web server makes nodemailer answer `EPROTOCOL` with `Invalid greeting. response=HTTP/1.1 400 Bad Request`, and that string in `sendFailureDetail` tells the operator what they did. Routing it to unreachable would leave the catch-all with no producer and therefore no gate.

| Transport signal                                    | Failure                       |
| --------------------------------------------------- | ----------------------------- |
| SMTP `ESOCKET`, `ECONNREFUSED`, `ETIMEDOUT`, `EDNS` | `email-transport-unreachable` |
| SMTP `ETLS`                                         | `email-transport-unreachable` |
| SMTP `EAUTH`                                        | `email-transport-rejected`    |
| SMTP `EENVELOPE`                                    | `email-transport-rejected`    |
| SMTP `EPROTOCOL`                                    | `email-send-failed`           |
| Resend `application_error` with `statusCode: null`  | `email-transport-unreachable` |
| Any other Resend `error` object                     | `email-transport-rejected`    |
| Anything else                                       | `email-send-failed`           |

Details the gates and the implementation both depend on:

- **`ETLS`** is what nodemailer raises when `requireTLS` is set and the server offers no STARTTLS upgrade. It is unreachable rather than rejected because no message was ever sent and the fix is the same class as a down relay. `EAUTH` is the mirror case: the server was reached, answered and refused the session, which is why the rejected variant refuses "the session or the message".
- **`email-recipient-invalid`** carries `recipientValue`, capped at 320 characters (the RFC address-length maximum); a longer input is truncated before being placed in the failure. It is produced by a Zod check **before** the transport is touched. This is a correctness requirement: on the SMTP path a bad address and a server-side rejection both throw `EENVELOPE`, differing only in `responseCode` (`451` with `command: 'RCPT TO'` for a rejection, `undefined` for a bad address). Translating `EENVELOPE` after the fact would produce the wrong failure. Do not do it.
- **`email-template-render-failed`** carries `emailTemplateName` and `renderFailureDetail`. A throwing React Email template throws a plain `Error` with no distinctive type at both element-construction and subject-building time, so this variant must come from wrapping both steps in try/catch, never from detecting an error class. When the template object lacks a usable name, `emailTemplateName` is the constant `unknown-email-template`, so the never-throws promise holds even for a malformed template.
- **`email-transport-unreachable`** carries `emailTransportName`, `transportErrorCode` and `transportTarget` (`host:port` for SMTP, the base URL for Resend). `transportErrorCode` is required because this variant is recognised by the code, and because it lets a gate assert the mechanism (`ETLS`) rather than only the outcome.
- **`email-transport-rejected`** carries `transportErrorCode` (nodemailer's `code`, for example `EENVELOPE`; or Resend's `error.name`, for example `validation_error`) and an optional `transportStatusCode` (the SMTP `responseCode` such as `451`, or Resend's `statusCode` such as `422`). Optional because Resend's `application_error` reports `statusCode: null`. Gates assert on these fields, not on message text.
- **`email-send-failed`** is the catch-all that keeps "never throws" honest, exactly as `storage-request-failed` does. It carries `sendFailureDetail`. **Resend errors are returned, not thrown.** The SDK answers `{ data: null, error: { statusCode, name, message } }`. The implementation branches on `error.name` and `error.statusCode`. The constructor throws synchronously on a missing key, which `resolveEmailTransportConfig` makes unreachable; the implementation still constructs defensively so the promise holds for a hand-built transport config.

### Transport behaviour the implementation must honour

- **A transport is built per call and closed before the call returns.** No module-level transporter, no pooling, no cached Resend client. No credential outlives the call, and a Vitest run or a CLI process is never held open by this package.
- **`secure` is derived, not configured.** The SMTP connection starts encrypted when the port is `465` (`implicitTlsSmtpPort`) and plain otherwise, nodemailer's own rule. Mailpit on `1025` is plain; a relay on `587` upgrades with STARTTLS. No `EMAIL_SMTP_SECURE` variable.
- **`requireTLS` is true whenever credentials are configured and the connection did not start encrypted.** A password must never cross a connection that failed to upgrade. This is gateable against the repo's Mailpit as it stands: Mailpit advertises no `STARTTLS` capability, so a send with credentials against it must fail with `email-transport-unreachable` and `transportErrorCode: 'ETLS'` (nodemailer reports `command: 'STARTTLS'`, `502 5.5.1 Command not implemented`), and Mailpit must hold no message afterwards. The negative control is the identical send without credentials, which succeeds; an implementation that drops the flag fails the gate.
- **SMTP timeouts are set explicitly**: `connectionTimeout` and `greetingTimeout` to `smtpConnectionTimeoutMs` (10 s), `socketTimeout` to `smtpSocketTimeoutMs` (20 s). Nodemailer's defaults are 120 s, 30 s and 600 s. A timeout surfaces as `email-transport-unreachable` with `ETIMEDOUT`.
- **Every message is multipart.** `html` from `render(element)` and `text` from `render(element, { plainText: true })`, always both, on both transports. The Resend request carries `from`, `to`, `subject`, `html` and `text`, an `Authorization: Bearer <key>` header from the explicit key, and the real SDK's user agent.
- **Secrets never leak.** No returned value other than a resolved transport config, and no failure, contains `SmtpPassword` or `ResendApiKey`.

Clauses no gate covers, recorded so nobody assumes coverage: the positive half of deriving `secure` from port 465 (needs a TLS server; the negative half is covered by every Mailpit send), the `EAUTH` mapping (Mailpit accepts no authentication), and `smtpSocketTimeoutMs` (needs a server that stalls after `DATA` for twenty seconds; the greeting timeout demonstrates the rule).

## Dependencies

- Packages: `@hearthkit/config` as a `workspace:*` runtime dependency (completion plan step 1). Nothing is imported from config at runtime; this package contributes `emailEnvSchemaFragment` for config to compose, and `email-contract.ts` restates config's variable-name rule locally as `emailEnvVariableNameSchema` so the file stays loadable from bare `node` with only `zod`.
- Runtime libraries (exact pins in `package.json`): `react-email@6.9.3`, `@react-email/render@2.1.0`, `nodemailer@9.0.6`, `resend@6.25.0`, `zod@4.4.3`. `react` and `react-dom` are peer dependencies, matching `@hearthkit/ui`. `@react-email/components` and the individual `@react-email/*` component packages are deprecated; nothing here may reference them.
- Services for gates:
  - **Mailpit** from the repo-root `docker-compose.yml` (`axllent/mailpit:v1.31`, SMTP `localhost:1025`, HTTP API `localhost:8025`). Gates read `GET /api/v1/messages` and `GET /api/v1/message/{ID}`, clear the inbox wholesale and assert exact counts. Its absent STARTTLS capability serves the `requireTLS` gate with no compose change.
  - **Mailpit Chaos** for `email-transport-rejected`: `MP_ENABLE_CHAOS` is on, and `PUT /api/v1/chaos` with `{"Recipient":{"ErrorCode":451,"Probability":100}}` makes a real send fail at `RCPT TO`. Gates reset every trigger to `Probability: 0` afterwards. The package never talks to that endpoint.
  - **No service** for `email-transport-config-incomplete`, `email-recipient-invalid` and `email-template-render-failed`; **a dead local port** and an unresolvable hostname for `email-transport-unreachable`, on both transports.
  - **An in-process `node:http` server** for the Resend transport, reached through `EMAIL_RESEND_BASE_URL`; `ResendOptions` publicly types `baseUrl`, so the SDK is never mocked (it does log to `console.error` outside production, so gate output is noisy). An in-process `node:net` imposter that never greets, or greets with an HTTP status line, produces `ETIMEDOUT` and `EPROTOCOL`.

## Out of scope

- **Compiling `.tsx` for publication.** Vitest and Next transform, so gates and apps work; the JSX-free `./email-contract` subpath serves anything Node-executed.
- **Anything `auth` needs beyond a URL and a template.** This package must not import `auth`, know about users or sessions, or generate tokens or URLs. Email verification and organization invitation templates are additive: one template value plus its props schema each. `auth` must extract the magic link from the plain text part of the Mailpit message, never the HTML part (template promise 1).
- **Queueing, retries, scheduling, idempotency keys, multiple recipients, `cc`, `bcc`, `replyTo`, attachments and a per-call sender.** One call is one attempt; a queue wraps the plain async call, and each field is additive on the options object.
- **Inbound mail, webhooks, bounce handling, suppression lists, delivery tracking, and verifying delivery.** A `250` from SMTP and a `200` from Resend mean accepted for delivery, nothing more.
- **Re-exporting React Email's components, a mail layout, theming, or localization.** An app imports `react-email` directly and supplies its own `TransactionalEmailTemplate` for another language or look.
- **Reading `process.env` or owning `NODE_ENV`.** Config owns both.

## Decisions

Confirmed by the orchestrator on 2026-08-29 unless dated otherwise.

1. Per-transport variables are optional in the fragment and checked by `resolveEmailTransportConfig`; a fragment refinement would be silently dropped by composition.
2. One options object per function, with the plan's three values keeping their names; the template owns the subject and the call site may override it with a branded value.
3. Two templates, magic link and password reset, each justified by a plan 4.7 flow. `renderTransactionalEmail` is exported separately: it gives the render failure a service-free producer, gives `auth` the bodies without sending, and is what `sendTransactionalEmail` calls.
4. `EMAIL_RESEND_BASE_URL` is contract, so the Resend transport is gated against a real in-process server rather than a mock.
5. Six failure variants where the plan names three: unreachable and rejected are different problems with different fixes, `ETLS` needs a name, and the catch-all makes "never throws" a promise.
6. **The entry point is a fixed allowlist, not "everything the contract module exports"** (completion plan step 5, 2026-09-09). An app imports the functions, the templates, the env fragment, the failure union, the transport input schema, the result schemas and the branded schemas it must construct. Gates and the implementation take prefixes, defaults, limits, range schemas and per-arm shapes from `email-contract.ts` directly. The `./email-contract` subpath survives only because `auth` imports it, and carries the same trimmed set.

## Verified

Checked 2026-08-29 against current docs, re-read 2026-09-09 for this revision:

- `render()` accepts `plainText` and returns an HTML string — https://react.email/docs/utilities/render
- Resend's send endpoint takes `from`, `to`, `subject`, `html`, `text` and answers `{ "id": "..." }` — https://resend.com/docs/api-reference/emails/send-email
- Nodemailer's message fields and `messageId`, and its SMTP options `secure`, `auth`, `requireTLS`, `connectionTimeout` (120000), `greetingTimeout` (30000), `socketTimeout` (600000) — https://nodemailer.com/message and https://nodemailer.com/smtp

Established by the orchestrator against the pinned libraries and the repo's Mailpit, and relied on rather than re-derived: Mailpit offers no STARTTLS, so `requireTLS` with credentials fails `ETLS` / `502 5.5.1` while the same send without credentials succeeds; `composeEnvSchemaFragments` rebuilds a fresh `z.object` from `fragment.shape`, dropping refinements; React Email escapes `&` to `&amp;` in the HTML part, so a two-parameter URL appears zero times verbatim there and verbatim in the text part; a non-SMTP listener yields `EPROTOCOL` / `Invalid greeting`; a throwing template throws a plain `Error`; `EENVELOPE` cannot distinguish a rejection from a bad address; the Resend SDK returns errors and throws only from its constructor; `email-contract.ts` runs under bare `node` and typechecks clean under `strict` and `verbatimModuleSyntax`.

## Questions for the orchestrator

1. `transportMessageIdSchema` was in neither list this revision was given. It is filed as internal above, since no consumer constructs a message id and `auth` imports only the `TransportMessageId` type. Veto if it should be public.
2. Follow-ups outside this agent's ownership. `src/index.ts` still re-exports the three now-private success schemas, so it will not compile until the implementor trims it to the allowlist and creates `src/email-contract-entry.ts`. `email-env-schema-fragment.test.ts` derives its required list from the contract module's namespace, names those three schemas outright, asserts the `./email-contract` manifest entry contains `./src/email-contract.ts`, and runs only that file under bare `node`; the gate-writer should replace the derived list with the fifteen-name allowlist, assert the new subpath path, and run both files.
