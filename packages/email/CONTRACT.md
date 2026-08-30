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

Declared in `emailEnvSchemaFragment` and composed by `@hearthkit/config` (empty string counts as unset, per config's contract). This package never reads `process.env` itself.

Every variable carries the `EMAIL_` prefix, including the two Resend ones. `RESEND_API_KEY` and `RESEND_BASE_URL` — the names the Resend SDK reads from the environment on its own — are deliberately **not** used, so the SDK can never pick up an ambient value and mask a misconfiguration. The key is always passed to the constructor explicitly.

### How "required when" is expressed, given a flat fragment

`config` composes fragments by flattening them into one object schema and validating `process.env` in a single pass. A flat object cannot say "`EMAIL_SMTP_HOST` is required only when `EMAIL_TRANSPORT` is `smtp`" through field types alone. Three ways to resolve that were available:

1. A cross-field refinement on the fragment. **Rejected, because composition silently discards it.** `composeEnvSchemaFragments` iterates `Object.entries(fragment.shape)` into a plain record and returns a brand-new `z.object(composedShape)` built from the per-variable schemas alone. A refinement attached to the fragment is not carried onto that new schema. It would not be rejected and it would not error — it would simply never run, and `EMAIL_TRANSPORT=resend` with no API key would sail through config exactly as if no rule had been written. A silent no-op is worse than a failure, which is what makes option 3 forced rather than merely preferable. A second, independent reason applies even if composition were changed to preserve refinements: a refinement failure arrives as `{ code: 'custom', path: [] }`, an object-level issue with an empty path, so it cannot name the offending variable the way config's per-variable list does.
2. All per-transport variables optional, checked at send time. Rejected: it turns a boot-time configuration mistake into a runtime one, so the first user to request a magic link is the person who discovers the API key is missing.
3. **Chosen: all per-transport variables optional in the fragment, plus one exported function, `resolveEmailTransportConfig`, that the app calls immediately after config loads.** It narrows the flat validated environment into the `EmailTransportConfig` discriminated union and returns a named failure listing every missing variable.

**What happens when someone sets `EMAIL_TRANSPORT=resend` and leaves `EMAIL_RESEND_API_KEY` unset** — the mistake people actually make. Config itself succeeds, because the key is optional in the fragment. `resolveEmailTransportConfig` then returns:

```
{ kind: 'email-transport-config-incomplete',
  emailTransportName: 'resend',
  missingVariableNames: ['EMAIL_RESEND_API_KEY'],
  message: 'hearthkit email transport config incomplete: ...' }
```

The app's boot path throws that message, so the process fails to start with the variable name in the text — the same outcome config gives for a missing required variable, one step later. Nothing is ever sent with a half-built transport, and the Resend SDK constructor (which throws synchronously on a missing key) is never reached with one. This is what makes the third column of the table above enforceable rather than a comment.

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
- `SmtpHostName`, `SmtpUserName`, `SmtpPassword`, `ResendApiKey`, `ResendBaseUrl` — branded. `SmtpPassword` and `ResendApiKey` are secrets: they never appear in a failure of any kind, in a log line, or in a render or send result. They do appear in an `EmailTransportConfig`, which is the one value that legitimately carries them, because carrying them to the send call is its entire job — so `resolveEmailTransportConfig`'s success value is the single exception and there is no other. `SmtpHostName` and `SmtpUserName` are not secrets and may appear in a message.
- `SmtpCredentials` — the user name and password as one value, so a half-filled pair is unrepresentable.
- `EmailTransportConfig` — a discriminated union on `kind`, `smtp-email-transport` or `resend-email-transport`. `emailFrom` sits on both arms; the rest differs.
- `TransportMessageId` — branded; opaque. Its shape differs per transport (an RFC Message-ID for SMTP, a UUID for Resend), so never parse or construct one.
- `TransactionalEmailTemplate<TProps>` — `{ emailTemplateName, buildEmailSubject(props): string, buildEmailElement(props): ReactElement }`.

### Public functions

Three functions. All return their failures as values; none throws for a contract failure mode.

- `resolveEmailTransportConfig({ emailEnv })` — synchronous, contacts nothing. `emailEnv` is the validated config object; extra keys are ignored, so an app passes `config` straight through. Run once at boot.
- `renderTransactionalEmail({ emailTemplate, templateProps, subject? })` — renders both message parts. Contacts nothing, needs no transport, so it is fully gateable with no service running. `subject` overrides what the template builds.
- `sendTransactionalEmail({ emailTransportConfig, emailTemplate, templateProps, to, subject? })` — renders, then sends to exactly one recipient.

#### Why an options object rather than the plan's `(template, props, to)`

Plan section 4.6 writes `sendTransactionalEmail(template, props, to)`. This contract makes it a single options object for three reasons: the call needs at least five values once the transport and the subject are accounted for, and five positional parameters are unreadable; every other public function in hearthkit takes one options object (`createPresignedUploadUrl`, `loadHearthkitConfig`, `initializeErrorReporting`), so one concept keeps one spelling; and optional additions such as a reply-to address or a per-call sender stay additive instead of breaking a positional signature. The plan's three values are all present under the names it uses.

#### Where the subject comes from

Each template owns its subject: `buildEmailSubject(props)` returns a string, which the package parses through `emailSubjectSchema`. `subject` on the options object overrides it and must already be branded, so a caller with a raw string parses it first.

Template-owned rather than call-site-owned because the known consumer is `@hearthkit/auth`, which sends mail from inside Better Auth callbacks. If the subject lived at the call site, every English subject line would be hardcoded inside `auth`, which is the wrong package to own copy. Making the template own it means `auth` picks a template and passes props, and nothing else.

A subject the template builds that fails `emailSubjectSchema` — empty, over 200 characters, or containing a control character — is reported as `email-template-render-failed`, because the template is the thing at fault. A control character in a subject is the classic header-injection vector, so this check is load-bearing, not cosmetic.

#### Recipients

`to` is exactly one address, typed as a plain `string` and validated at runtime with `emailAddressSchema` before any transport is contacted.

Plain `string` is a deliberate departure from `storage`, where every caller-supplied value is branded and never re-validated. The recipient is the one value in this package that always originates from user input, and the orchestrator's spike showed why late validation is useless here: `to: 'not-an-email'` never reaches the SMTP server at all, because nodemailer's address parser silently drops it and reports `No recipients defined` — a diagnostic that points at the wrong cause. The branded `EmailAddress` still exists and is what the success result echoes back, so parsed addresses flow onward with the brand intact.

One recipient, not a list. Two reasons: transactional mail addressed to several people in one `To` header leaks recipient identities to each other, which is a privacy defect rather than a feature; and a multi-recipient send has a genuine partial-success state (nodemailer treats a message as sent if any recipient was accepted, listing the rest in `rejected`) that no single result value models honestly. With one recipient, a non-empty `rejected` list is unambiguous.

## Outputs

- `resolveEmailTransportConfig` returns `{ kind: 'email-transport-config-resolved', emailTransportConfig }` or a failure. The config is the discriminated union the other function consumes.
- `renderTransactionalEmail` returns `{ kind: 'transactional-email-rendered', emailTemplateName, subject, htmlBody, textBody }` or a failure. `htmlBody` is a complete XHTML-doctype HTML document; `textBody` is readable plain text with link URLs inlined. Both come from one render of one element, so the two parts of a message cannot disagree.
- `sendTransactionalEmail` returns `{ kind: 'transactional-email-sent', emailTemplateName, to, subject, transportMessageId }` or a failure. `to` is the parsed, branded address.

The send result deliberately does **not** carry `htmlBody` or `textBody`. A transactional body routinely contains a single-use sign-in URL, and a result value is exactly the sort of thing that ends up in a log line. A caller that wants the bodies calls `renderTransactionalEmail`, which is why it is a separate export.

`transportMessageId` is nodemailer's `info.messageId` on the SMTP path, not the queue id inside the `250 2.0.0 Ok: queued as <ID>` response. That queue id happening to equal Mailpit's own message id is a Mailpit implementation detail and is not promised by this contract; a gate may use it to correlate, but nothing in the package may depend on it.

### Templates the package ships

Two, exported as `TransactionalEmailTemplate` values. The set is small on purpose: a template is copy, and copy that nobody sends is copy that goes stale.

- **`magicLinkEmailTemplate`** — name `magic-link-sign-in`, props `{ signInUrl, productName?, expiryMinutes? }`. Plan 4.7 lists magic link as an enabled method and its gate reads the link out of Mailpit, so without this template that flow has no mail to send.
- **`passwordResetEmailTemplate`** — name `password-reset`, props `{ passwordResetUrl, productName?, expiryMinutes? }`. Plan 4.7 enables email and password. A user who forgets a password is locked out permanently unless this mail exists.

Both templates promise three things a gate can check:

1. **`textBody` carries the action URL verbatim, always. `htmlBody` carries the same URL HTML-escaped.** The plain text part is therefore the reliable extraction point, and it is the one a consumer should read — `auth` included, when it pulls a magic link back out of Mailpit. In the HTML part React renders `&` as `&amp;` in both the `href` attribute and the visible link text, so `?token=abc123&callbackURL=%2Fdashboard` appears as `?token=abc123&amp;callbackURL=%2Fdashboard`. That is the same URL and it works when clicked, because `&amp;` is the correct encoding of `&` in an attribute and the browser decodes it — but it is not byte-identical, so a substring search for a multi-parameter URL against `htmlBody` finds nothing. A single-parameter URL does match in both parts, which is exactly what makes this the sort of assumption that ships broken: Better Auth callbacks routinely carry `?token=…&callbackURL=…`. Neither part shortens, wraps or tracks the URL.
2. The URL is reachable as a clickable button in the HTML part and as visible text as well, so a client that strips buttons still lets a person copy the link.
3. `productName` and `expiryMinutes` are optional. Omitted, the copy and the subject read generically ("Your sign-in link"); supplied, they read specifically ("Sign in to Acme", "This link expires in 15 minutes"). `auth` can therefore send working mail without hearthkit inventing a product-name environment variable for it.

An app is not limited to these two. `TransactionalEmailTemplate` is a plain object type, so an app or another package builds its own from `react-email` components and passes it to the same functions. That is what keeps `auth`, `payments` and any future sender unblocked without this package growing a template per consumer.

### Package entry point

`src/index.ts` is the package entry, a thin named re-export (no `export *`). It re-exports by name: the three public functions; the two template values; `emailEnvSchemaFragment`; the six message-prefix constants; and every value `src/email-contract.ts` exports, with no exceptions — the same mechanical rule `storage` settled on, so a caller that has narrowed a result on `kind` can validate the success arm without rebuilding the schema.

The manifest must publish a second subpath, `./email-contract` → `./src/email-contract.ts`, exactly as `@hearthkit/ui` publishes `./ui-contract`. The `.` entry transitively imports `.tsx` template modules, which bare `node` refuses; the contract file is JSX-free and loads from bare `node`. Note for whoever writes the equivalent of `ui`'s import-specifier gate: this contract file's allowed import list is `zod` **and a type-only `react` import** for `ReactElement`, which is erased at runtime. It is one specifier wider than `ui`'s.

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

The mapping is part of the contract, not an implementation choice. Anything not listed here lands in the catch-all, and the catch-all is reached by real misconfigurations rather than only by exotic ones — that is what it is for. Pointing `EMAIL_SMTP_HOST` and `EMAIL_SMTP_PORT` at something that is listening but is not an SMTP server, a web server for instance, is the ordinary case: nodemailer answers `EPROTOCOL` with `Invalid greeting. response=HTTP/1.1 400 Bad Request`, and that string in `sendFailureDetail` tells the operator exactly what they did. Routing it to `email-transport-unreachable` for tidiness would be a worse trade, because it would leave the catch-all with no producer and therefore no gate, and a gated catch-all is worth more than a perfect taxonomy.

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

`ETLS` is the code nodemailer raises when `requireTLS` is set and the server does not offer a STARTTLS upgrade. It belongs with unreachable rather than rejected because no message was ever sent — the server never saw one — the transport could not be used at all, and the operator's fix is the same class of action as a down relay: repair TLS or remove the credentials. Leaving a security-relevant failure in the catch-all would contradict Decision 7.

`EAUTH` is the mirror case and belongs with rejected: the server was reached, answered, and refused the session. That is why the `email-transport-rejected` variant is documented as refusing "the session or the message" rather than the message alone.

Details the gates and the implementation both depend on:

- **`email-recipient-invalid`** carries `recipientValue`, capped at 320 characters (the RFC address-length maximum); a longer input is truncated to that before being placed in the failure, so a hostile value cannot blow up a log line. It is produced by a Zod check **before** the transport is touched. This is not an optimisation, it is a correctness requirement: on the SMTP path, a bad address and a server-side rejection both throw nodemailer's `EENVELOPE` and differ only in `responseCode` (`451` with `command: 'RCPT TO'` for a rejection, `undefined` and no command for a bad address), and a bad address never even reaches the server. Translating `EENVELOPE` after the fact would produce the wrong failure with a misleading message. Do not do it.
- **`email-template-render-failed`** carries `emailTemplateName` and `renderFailureDetail`. A throwing React Email template throws a plain `Error` with the original message at both element-construction and render time, with no distinctive type to match on, so this variant must be produced by wrapping both steps in try/catch — never by detecting an error class. When the template object itself lacks a usable name, `emailTemplateName` is the exported constant `unknown-email-template`, so the field is always present and the never-throws promise holds even for a malformed template.
- **`email-transport-unreachable`** carries `emailTransportName`, `transportErrorCode` and `transportTarget` (`host:port` for SMTP, the base URL for Resend). `transportErrorCode` is required rather than optional because this variant is recognised _by_ the code, so the code is always in hand — and because it is what lets a gate assert the mechanism (`ETLS`) rather than merely the outcome. Without it, an implementation that failed to connect for an unrelated reason would satisfy the STARTTLS gate by accident.
- **`email-transport-rejected`** carries `transportErrorCode` (nodemailer's `code`, for example `EENVELOPE`; or Resend's `error.name`, for example `validation_error`) and an optional `transportStatusCode` (the SMTP `responseCode` such as `451`, or Resend's `statusCode` such as `422`). Optional because Resend's `application_error` reports `statusCode: null`. Gates should assert on `transportErrorCode` and `transportStatusCode` rather than on message text.
- **`email-send-failed`** is the catch-all that keeps "never throws" honest, exactly as `storage-request-failed` does in `storage`. It carries `sendFailureDetail`. It exists so no unexpected error is silently mis-mapped into a nicer-sounding variant and no call ever throws instead of returning.

**Resend errors are returned, not thrown.** The SDK answers `{ data: null, error: { statusCode, name, message } }`. The implementation must branch on `error.name` and `error.statusCode`, not wrap the call in a catch and hope. The one thing it does throw is the constructor, synchronously, on a missing key — which `resolveEmailTransportConfig` makes unreachable, and which the implementation should still construct defensively so the promise holds if a caller hand-builds a transport config.

### Transport behaviour the implementation must honour

- **A transport is built per call and closed before the call returns.** No module-level nodemailer transporter, no pooling, no cached Resend client. Same rule `storage` follows, for the same reasons: no credential outlives the call, a secrets manager only has to repopulate the environment, and a Vitest run or a CLI process is never held open by this package.
- **`secure` is derived, not configured.** The SMTP connection starts encrypted when the port is `465` (exported as `implicitTlsSmtpPort`) and starts plain otherwise, which is nodemailer's own rule. Mailpit on `1025` is plain; a relay on `587` starts plain and upgrades with STARTTLS. No `EMAIL_SMTP_SECURE` variable, because that rule covers every realistic target and an extra knob is an extra thing to get wrong.
- **`requireTLS` is true whenever credentials are configured and the connection did not start encrypted.** A password must never cross a connection that failed to upgrade. Mailpit has no credentials, so ordinary sends are unaffected. **This rule is gateable against the repo's Mailpit as it stands, with no compose change**: Mailpit advertises no `STARTTLS` capability in its EHLO response, because it has no TLS certificate configured. So a send with credentials configured against Mailpit on 1025 must fail with `email-transport-unreachable` and `transportErrorCode: 'ETLS'` (nodemailer reports `command: 'STARTTLS'` and `502 5.5.1 Command not implemented`), and Mailpit must hold no message afterwards. The negative control is what makes that gate load-bearing rather than decorative: the identical send with `requireTLS` omitted succeeds with `250 2.0.0 Ok: queued as ...` and the password crosses in clear, so an implementation that drops the flag fails the gate.
- **SMTP timeouts are set explicitly**: `connectionTimeout` and `greetingTimeout` to `smtpConnectionTimeoutMs` (10 s), `socketTimeout` to `smtpSocketTimeoutMs` (20 s). Nodemailer's defaults are 120 s, 30 s and 600 s, which would let one stalled relay hold a web request open for two minutes. A timeout surfaces as `email-transport-unreachable`.
- **Every message is multipart.** `html` from `render(element)` and `text` from `render(element, { plainText: true })`, always both, on both transports.

### Clauses no gate covers

Three clauses above are stated as requirements and cannot be gated. They are recorded here so a future reader does not assume coverage exists, and so a reviewer can weigh the risk deliberately. Everything else in this contract has a gate.

- **Deriving `secure` from `implicitTlsSmtpPort` (465).** Proving the positive half needs a server holding a privileged port and presenting a certificate, which the local infrastructure does not have. Only the negative half is covered, by every passing Mailpit send on 1025: an implementation that set `secure: true` unconditionally would fail all of them. An implementation that never set `secure: true` at all would pass every gate.
- **`EAUTH` mapping to `email-transport-rejected`.** Not producible against the repo's Mailpit, which accepts no authentication. Unlike the `requireTLS` rule this costs little: it is a one-line classification, not a security property the implementation could quietly drop and still appear to work.
- **`smtpSocketTimeoutMs` (20 s idle socket).** Producing it needs a server that greets, accepts the envelope, then stalls after `DATA`, plus twenty seconds of wall clock per run. The greeting timeout already demonstrates the shape of the rule, so the marginal value of a slow bespoke gate is low.

## Dependencies

- Packages: `@hearthkit/config` as a **devDependency only** (workspace). Nothing is imported from config at runtime — this package contributes `emailEnvSchemaFragment` for config to compose; it never consumes config itself. That is also why `email-contract.ts` restates config's environment-variable-name rule locally as `emailEnvVariableNameSchema` instead of importing `envVariableNameSchema`: the file must stay loadable from bare `node` with only `zod` at runtime.
- Runtime libraries (implementor adds, exact pins): `react-email@6.9.3` (the unified package, which exports `Html`, `Head`, `Body`, `Container`, `Heading`, `Text`, `Button`, `Preview` and the rest), `@react-email/render@2.1.0` (the renderer), `nodemailer@9.0.6`, `resend@6.25.0`, `zod@4.4.3`. `react` and `react-dom` are **peer** dependencies, matching `@hearthkit/ui`.
  **`@react-email/components` and the twenty individual `@react-email/*` component packages are deprecated. Nothing in this package may reference them.**
- Dev dependencies (implementor adds, exact pins): `@types/nodemailer@8.0.1`, `@types/react`, `@types/react-dom`, `react`, `react-dom`, `vitest@4.1.11`, `typescript@7.0.2`, `@types/node@24.13.3`, `@hearthkit/config` (workspace).
- Services for gates:
  - **Mailpit** from the repo-root `docker-compose.yml` (`axllent/mailpit:v1.31`, SMTP on `localhost:1025`, HTTP API on `localhost:8025`). The plan's gate — send a template, query Mailpit's API, confirm subject and body — reads `GET /api/v1/messages` and `GET /api/v1/message/{ID}`.
  - **Mailpit Chaos** for `email-transport-rejected`. The repo's Mailpit runs with `MP_ENABLE_CHAOS: 'true'`; `PUT /api/v1/chaos` with `{"Recipient":{"ErrorCode":451,"Probability":100}}` makes a real send fail at `RCPT TO`. This is a gate mechanism, not part of the package's surface — the package never talks to that endpoint. Gates must reset all three triggers to `Probability: 0` afterwards.
  - **Mailpit's absent STARTTLS capability** for the `requireTLS` gate described above. Unrelated to Chaos, and it needs no compose change or Mailpit configuration of any kind.
  - **No service at all** for `email-transport-config-incomplete`, `email-recipient-invalid` and `email-template-render-failed`, all of which are reachable with nothing running.
  - **An in-process `node:http` server** for the Resend transport, reached by pointing `EMAIL_RESEND_BASE_URL` at it — the technique `observability` and `storage` already use. Plan section 4.6 says the Resend transport needs "a mocked HTTP layer only, since it cannot run offline"; that is wrong in a useful direction, and the orchestrator has verified it. `ResendOptions` publicly types `baseUrl?: string`, so no `any` cast is needed and CLAUDE.md's no-`any` rule holds. This is precisely why `EMAIL_RESEND_BASE_URL` exists in the contract instead of the SDK's default being hardcoded. The Resend SDK itself is never mocked.
  - **A dead local port** for the plain `email-transport-unreachable` case, on both transports.
- Nuisance the gate-writer should expect: Resend's SDK writes to `console.error` through its own `logError` whenever `NODE_ENV !== 'production'`, so gate output is noisier than the assertions suggest.

## Out of scope

- **Compiling `.tsx` for publication.** Templates are `.tsx`, so bare `node` cannot import the `.` entry — it does not strip JSX. Vitest and Next both transform, so gates and consuming apps work today. This is the same publish-time-build constraint already recorded for `@hearthkit/ui` in Phase 6, plus the related limit that Node refuses type stripping for files resolved under `node_modules`. It is a Phase 6 packaging decision and this contract does not attempt to solve it. The mitigation that already worked once is copied here: the JSX-free `./email-contract` subpath, so anything Node-executed can read the contract without touching a template.
- **Anything `auth` will need in Phase 5.** This package must not import `auth`, know about users, sessions or organizations, or generate tokens or URLs. `auth` builds the URL, picks a template and calls `sendTransactionalEmail`. Two templates it may want that are not shipped — **email verification** and **organization invitation** — are additive: each is one new template value plus its props schema, and neither changes a signature. Plan 4.7's gates need neither (its flow is sign up, sign in, magic link, session; and adding an org member directly rather than by invitation). One fact `auth` should inherit rather than rediscover: **extract the magic link from the plain text part of the Mailpit message, never the HTML part.** A callback URL carrying more than one query parameter is HTML-escaped in the HTML part and a substring search there will find nothing, while a single-parameter URL matches in both and hides the problem. See template promise 1.
- **Queueing, retries, scheduling and idempotency keys.** One call is one attempt. An app that needs a delivery guarantee needs a queue, which is deferred and unblocked: sending is a plain async call with no hidden state, so a queue wraps it without changing it.
- **Multiple recipients, `cc`, `bcc` and `replyTo`.** Argued under Recipients above. Each is additive on the options object.
- **Attachments.** Not in the plan entry; additive on both transports.
- **A per-call sender.** `emailFrom` comes from the transport config, which is what `EMAIL_FROM` is for. An optional per-call override is additive.
- **Inbound mail, webhooks, bounce handling, suppression lists and delivery tracking.** None is in the plan entry, and Resend and SMTP expose them so differently that a shared abstraction would be guesswork.
- **Re-exporting React Email's components.** An app writing its own template imports `react-email` directly. Re-exporting sixty-seven components would create a second name for every one of them, which is exactly the drift CLAUDE.md's one-concept-one-spelling rule forbids.
- **A shared visual layout or theming system for mail.** The shipped templates carry plain, legible chrome. Mail theming is not CSS-variable theming, so nothing here reuses `@hearthkit/ui`'s tokens, and a layout export is additive if it is ever wanted.
- **Localization.** Copy is English. An app needing another language supplies its own `TransactionalEmailTemplate`, which is the same escape hatch `ui` gives with component shadowing.
- **Reading `process.env`, and owning `NODE_ENV`.** Config owns both. Because credentials arrive per call and no client is cached, the deferred secrets manager only has to repopulate the environment before the next call.
- **Verifying that a message was delivered.** A `250` from an SMTP server and a `200` from Resend mean accepted for delivery, nothing more. This package reports acceptance and says so.

## Decisions

The five things the loop asked to be settled here rather than left to the implementor, plus the two that the verified facts forced. All seven were reviewed and confirmed by the orchestrator on 2026-08-29.

1. **Per-transport variables are optional in the fragment and checked by `resolveEmailTransportConfig`.** Argued in full under Inputs, with the `EMAIL_TRANSPORT=resend` case spelled out. The cost is one exported function and one failure mode beyond the plan's three. The benefit is that the generated app in Phase 6 writes `resolveEmailTransportConfig({ emailEnv: config })` instead of three non-null assertions that fail silently when they are wrong — and that the alternative, a refinement on the fragment, would be silently dropped by composition rather than enforced.
2. **One options object, not three positional parameters**, with the plan's three values keeping their names. Argued under Public functions.
3. **The template owns the subject; the call site may override it with a branded value.** Argued under Where the subject comes from.
4. **Two templates, magic link and password reset**, each justified against a plan 4.7 requirement. Apps and packages supply their own for anything else.
5. **`renderTransactionalEmail` is exported separately from sending.** It gives the render failure a producer that needs no service at all, it gives gates a way to assert on rendered output directly, it gives `auth` the HTML without sending, and it is the building block `sendTransactionalEmail` calls, so the two can never render differently.
6. **`EMAIL_RESEND_BASE_URL` is part of the contract, not an SDK default buried in the implementation.** Without it the Resend transport can only be tested against a mock, and a mocked HTTP layer proves that the mock works. With it the transport is gated against a real in-process server, which is the standard this repo already holds `observability` and `storage` to.
7. **The failure union has six variants where the plan names three.** `email-transport-unreachable` is forced because unreachable and rejected are different problems with different fixes — and because `ETLS`, a security-relevant failure, needs a name rather than a catch-all. `email-transport-config-incomplete` is forced by Decision 1. `email-send-failed` is the catch-all that makes "never throws" a promise rather than an aspiration. The plan's list is incomplete rather than restrictive, which is how the same widening was accepted for `storage`.

## Verified

Checked 2026-08-29 against current docs.

- `render()` accepts `pretty`, `plainText` and `htmlToTextOptions`, and returns an HTML string — https://react.email/docs/utilities/render
- Resend's send endpoint takes `from`, `to`, `subject`, `html`, `text`, `reply_to`, `cc`, `bcc`, `headers`, `tags` and `attachments`, and answers with `{ "id": "..." }` on success — https://resend.com/docs/api-reference/emails/send-email
- Nodemailer's message fields are `from`, `to`, `cc`, `bcc`, `replyTo`, `subject`, `text`, `html`; `sendMail` resolves with `messageId` and an `envelope`, and a multi-recipient message counts as sent if any recipient was accepted, with the rest in `rejected` — https://nodemailer.com/message
- Nodemailer's SMTP transport takes `host`, `port`, `secure`, `auth`, `requireTLS`, `ignoreTLS`, `connectionTimeout` (default 120000), `greetingTimeout` (default 30000) and `socketTimeout` (default 600000); `secure: false` means the connection starts unencrypted and STARTTLS upgrades it automatically unless `ignoreTLS` is set — https://nodemailer.com/smtp
- Zod 4 exposes string formats as top-level functions (`z.email()`, `z.url()`), and `.brand<'...'>()` exists on every schema — https://zod.dev/v4/changelog and https://zod.dev/api (established during the `config` loop and relied on here rather than re-derived)

Established by the orchestrator on 2026-08-29 and 2026-08-30, and built on rather than re-derived here:

- The dependency set (`react-email@6.9.3`, `@react-email/render@2.1.0`, `nodemailer@9.0.6`, `@types/nodemailer@8.0.1`, `resend@6.25.0`) and the deprecation of `@react-email/components`; `render(element, { plainText: true })` producing readable text with link URLs inlined; a throwing template throwing a plain `Error` with no distinctive type; unauthenticated Mailpit sends on port 1025 succeeding with `250 2.0.0 Ok: queued as <ID>`; an unreachable SMTP transport throwing `ESOCKET` / `CONN` / `connect ECONNREFUSED`; `EENVELOPE` being unable to distinguish a rejection from a bad address; `ResendOptions.baseUrl` being public and typed, so no `any` cast is needed; the Resend SDK returning errors rather than throwing them, and its constructor throwing on a missing key; and Mailpit Chaos making a real `RCPT TO` rejection reproducible.
- **Mailpit advertises no `STARTTLS` capability**, so `requireTLS: true` with credentials against it fails with `code: 'ETLS'`, `command: 'STARTTLS'`, `502 5.5.1 Command not implemented` — while the same send with `requireTLS` omitted succeeds and the password crosses in clear. That pair is the gate and its negative control.
- **`composeEnvSchemaFragments` rebuilds a fresh `z.object` from `Object.entries(fragment.shape)`**, so a refinement attached to a fragment never runs; and a refinement failure would in any case arrive as `{ code: 'custom', path: [] }` with an empty path. Both checked against the repo's zod 4.4.3. This is the evidence behind option 1's rejection above.
- **`email-contract.ts` typechecks clean in isolation** — `tsc --noEmit` with `strict` and `verbatimModuleSyntax`, zod 4.4.3 and `@types/react` 19.2.18 linked, **exit 0, no diagnostics**. The type-only `react` import is correctly marked and the `z.custom` predicate compiles. Note that a repo-wide `pnpm run typecheck` exits 0 without checking this file at all, because `packages/email` has no `package.json` and is therefore not in the workspace project list; that exit code is not evidence about this package.
- **React Email escapes `&` in the HTML part**, measured against the pinned `react-email@6.9.3` and `@react-email/render@2.1.0`. A single-parameter URL (`https://gate.test/sign-in?token=abc123`) appears verbatim in `htmlBody` three times and in `textBody`. A two-parameter URL (`…?token=abc123&callbackURL=%2Fdashboard`) and a three-parameter URL both appear **zero** times in `htmlBody` and verbatim in `textBody`, because the `href` and the visible text both render `&amp;`. This is the evidence behind template promise 1 and it corrects an earlier draft of this contract, which promised the HTML part verbatim and would have broken `auth`.
- **A listener that is not an SMTP server yields `code: 'EPROTOCOL'`, `command: 'CONN'`, `Invalid greeting. response=HTTP/1.1 400 Bad Request`.** That is the ordinary misconfiguration behind the catch-all's `EPROTOCOL` row, and the reason the catch-all has a producer and therefore a gate.
- **The gates fail correctly against an empty implementation: 5 files, 24 of 24 gates failed**, every one with a "not implemented yet" diagnostic, and no collection error or syntax error.
- **Import discipline audited**: the only route into the package is a single dynamic `import('@hearthkit/email')` in one fixture, and there are **no mocks anywhere**. Plan section 4.6's exemption for a mocked Resend HTTP layer went unused, because the in-process `node:http` server reached through `EMAIL_RESEND_BASE_URL` replaced it. That is Decision 6 paying off in the gates rather than only on paper.

Not verified by this agent, which has no shell in this session: nothing here has been executed, and `packages/email` still has no manifest. `email-contract.ts` imports `zod` at runtime and `react` type-only, so importing it has no runtime effect.

## Questions for the orchestrator

Every question from rounds one and two has been ruled on and folded into the body above. Two are recorded here rather than silently absorbed, because in both cases the original reasoning was wrong and a future reader should see the correction rather than only the conclusion.

1. **Superseded — `requireTLS` is gateable after all.** Round one asked to accept an ungated security requirement, on the mistaken premise that gating it needed Mailpit to accept authentication. It needs the opposite: Mailpit not offering STARTTLS, which it already does not. The rule, its gate and its negative control are stated under Transport behaviour, and the compose file is untouched.
2. **Superseded — the HTML part does not carry the URL verbatim.** Round two's template promise 1 claimed it did. React escapes `&` to `&amp;`, so it holds only for a single-parameter URL, and fails for exactly the multi-parameter callback URLs Better Auth produces. Corrected in promise 1 and in the `auth` note under Out of scope, with the measurement in Verified.

Open:

1. **`pnpm run format:check` on `packages/email/CONTRACT.md`.** The tables are padded to Prettier's column rules by hand, since this agent has no shell. The widths were re-measured after this round's edits with anchored regexes over the file, and the escaped-pipe convention was confirmed against `packages/config/CONTRACT.md`, which passes — but measurement is not a Prettier run. If it fails, the fix is `pnpm run format` on that one path.
