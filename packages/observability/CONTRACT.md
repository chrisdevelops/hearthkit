# @hearthkit/observability — contract

## Purpose

Error reporting to GlitchTip (which speaks the Sentry protocol), structured logging with pino, and a `/health` route handler for Next.js. The package is safe by default: without `GLITCHTIP_DSN` error reporting is a complete no-op, logs always go to stdout as newline-delimited JSON, and `/health` works with zero configured checks. Nothing in this package can crash an app — the only throwing path is a boot-time misconfiguration (duplicate health check names). SDK sample rates default conservatively (tracing off) so a runaway error loop cannot fill GlitchTip's disk with transactions.

## Inputs

### Environment variables

| Name            | Type                                                     | Required                   | Example                                  |
| --------------- | -------------------------------------------------------- | -------------------------- | ---------------------------------------- |
| `GLITCHTIP_DSN` | http(s) URL in Sentry DSN form                           | optional                   | `https://abc123@glitchtip.example.com/1` |
| `LOG_LEVEL`     | enum `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` | optional, defaults `info` | `debug`                                  |

Declared in `observabilityEnvSchemaFragment`, composed by `@hearthkit/config` (empty string counts as unset, per config's contract). This package never reads `process.env` itself: the app composes config and passes values into the functions below, the same pattern `db` uses for `DATABASE_URL`. `NODE_ENV` stays owned by config; its value is passed here as the `reportingEnvironment` parameter.

### Shared vocabulary

- `GlitchtipDsn` — branded; an http(s) URL. The fragment only checks URL shape; `initializeErrorReporting` checks full DSN shape (public key before `@`, non-empty project id as the last path segment).
- `LogLevelName` — pino's default levels: `trace`, `debug`, `info`, `warn`, `error`, `fatal`.
- `ErrorEventId` — branded; the id the SDK assigns to a captured event.
- `HealthCheckName` — branded; lowercase kebab-case (`/^[a-z][a-z0-9-]*$/`), max 63 chars. Example: `database`.
- `ReportingEnvironment` — same values as config's `NODE_ENV`: `development` | `test` | `production`.

### Public functions

- `initializeErrorReporting(options?)` — `glitchtipDsn?`: branded DSN; `reportingEnvironment?`: defaults `development`; `errorSampleRate?`: 0–1, defaults `1`; `tracesSampleRate?`: 0–1, defaults `0`. Synchronous, never throws. Callable more than once; the last call wins (reconfigures). With no `glitchtipDsn`, reporting is disabled and every later capture is a silent skip.
- `captureError(error, errorContext?)` — `error`: anything thrown (`unknown`); `errorContext?`: record of extra fields attached to the event. Synchronous, never throws — not even before any `initializeErrorReporting` call. Delivery is asynchronous; call `flushErrorReporting` before asserting delivery.
- `flushErrorReporting(options?)` — `flushTimeoutMs?`: positive integer, defaults `2000`. Waits for pending events to send. Resolves immediately as flushed when reporting is disabled. Never throws (returns a failure value on timeout).
- `createStructuredLogger(options?)` — `logLevel?`: `LogLevelName`, defaults `info` (the app passes `config.LOG_LEVEL`); `loggerName?`: non-empty string added as the `name` binding. Synchronous, never throws.
- `createHealthRouteHandler(options?)` — `healthChecks?`: array of `{ healthCheckName, runHealthCheck }`, defaults `[]`; `healthCheckTimeoutMs?`: positive integer per check, defaults `5000`. `runHealthCheck` is `() => Promise<void>`: resolving means healthy, throwing or rejecting means failed. Throws only on duplicate `healthCheckName` values (boot-time misconfiguration); the returned handler itself never throws.

This is how database reachability is reported without depending on `@hearthkit/db` (the dependency graph forbids it): the app wires the check in, e.g. ``{ healthCheckName: 'database', runHealthCheck: async () => { await drizzleClient.execute(sql`select 1`) } }``. The Phase 4 template owns that wiring.

## Outputs

- `initializeErrorReporting` returns a discriminated union on `kind`:
  - `{ kind: 'error-reporting-enabled', glitchtipDsn }` — Sentry-compatible SDK initialized; events go to the DSN's `/api/<projectId>/envelope/` endpoint.
  - `{ kind: 'error-reporting-disabled' }` — no DSN given; no-op mode.
  - `{ kind: 'error-reporting-invalid-dsn', ... }` — DSN given but not DSN-shaped; reporting stays disabled (see Failure modes).
- `captureError` returns `{ kind: 'error-captured', errorEventId }` when reporting is enabled, or `{ kind: 'error-capture-skipped' }` when reporting is disabled or uninitialized. The skip is designed no-op behavior, not a failure. Error sampling below 1 is delegated to the SDK: a Sentry-compatible SDK returns an event id even for events it later samples out, so `captureError` may return `error-captured` for an event the SDK subsequently drops.
- `flushErrorReporting` resolves `{ kind: 'error-reports-flushed' }` or the `error-reports-flush-timed-out` failure.
- `createStructuredLogger` returns a pino `Logger` (`StructuredLogger`) that writes newline-delimited JSON to stdout. Messages below `logLevel` are dropped.
- `createHealthRouteHandler` returns a `HealthRouteHandler`: `(request: Request) => Promise<Response>`, directly usable as a Next.js App Router handler (`export const GET = createHealthRouteHandler(...)` in `app/health/route.ts`). The handler ignores the request entirely — method, headers, and query have no effect; it responds identically to any request. The response is JSON (`HealthReport`):
  - `{ status: 'ok', checks: [...] }` with HTTP **200** when every check passed (including zero checks).
  - `{ status: 'unhealthy', checks: [...] }` with HTTP **503** when any check failed or timed out.
  - Each entry in `checks` is a `HealthCheckResult`: `health-check-passed` (with `durationMs`), `health-check-failed` (with `failureMessage`), or `health-check-timed-out` (with `timeoutMs`). Checks run concurrently, each bounded by `healthCheckTimeoutMs`.
  - `failureMessage` derivation: when the rejection value is an `Error`, the first line of its `message`; otherwise the first line of `String(thrown)` (so a rejection with `undefined` yields the string `"undefined"`). Either way, truncated to 200 chars.

### Package entry point

`src/index.ts` is the package entry, a thin named re-export (no `export *`). It re-exports: the five public functions; `observabilityEnvSchemaFragment`; the prefix constants (`observabilityInvalidDsnErrorPrefix`, `observabilityFlushTimeoutErrorPrefix`, `healthCheckNameConflictErrorPrefix`); the schemas gates and apps consume (`observabilityFailureSchema`, `initializeErrorReportingResultSchema`, `captureErrorResultSchema`, `flushErrorReportingResultSchema`, `healthCheckResultSchema`, `healthReportSchema`, `namedHealthCheckSchema`, `glitchtipDsnSchema`, `logLevelNameSchema`, `healthCheckNameSchema`, `errorEventIdSchema`); and the types listed in `observability-contract.ts`.

## Failure modes

None fatal at runtime, per the plan. All failures are one discriminated union, `ObservabilityFailure`, on `kind`. Every variant carries a `message` starting with its unique literal prefix.

| `kind`                          | When                                                                                                    | Message prefix                            | Surface                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `error-reporting-invalid-dsn`   | DSN passed but missing a public key before `@` or a project id path segment; reporting stays disabled   | `hearthkit observability invalid dsn:`    | returned by `initializeErrorReporting`                     |
| `error-reports-flush-timed-out` | Pending events not delivered within `flushTimeoutMs`                                                    | `hearthkit observability flush timed out:` | returned by `flushErrorReporting`                          |
| `health-check-name-conflict`    | Two health checks share a `healthCheckName`; carries the name                                            | `hearthkit health check name conflict:`   | **thrown** as an `Error` by `createHealthRouteHandler`     |

Per-check runtime failures are not `ObservabilityFailure` — they are reported inside the HTTP body as `HealthCheckResult` variants and gate on the discriminant plus the status code:

| `kind`                   | When                                                | Effect                          |
| ------------------------ | --------------------------------------------------- | ------------------------------- |
| `health-check-failed`    | `runHealthCheck` threw or rejected                  | overall `unhealthy`, HTTP 503   |
| `health-check-timed-out` | `runHealthCheck` did not settle in `healthCheckTimeoutMs` | overall `unhealthy`, HTTP 503   |

Explicit non-failures the gates also cover: `captureError` with no DSN (and before any init) returns `error-capture-skipped` and never throws; `flushErrorReporting` in disabled mode resolves flushed; the health handler with zero checks returns 200.

## Dependencies

- Packages: `@hearthkit/config` as a **devDependency only** (workspace). Nothing is imported from config at runtime — this package contributes `observabilityEnvSchemaFragment` for config to compose; it never consumes config itself. Gates import config types/schemas at test time only.
- Services for gates: none from compose for the reporting gates — the "local mock endpoint" is an in-process Node HTTP server the gate starts, asserting a POST arrives at `/api/<projectId>/envelope/` (the Sentry ingest path for a DSN `http://key@127.0.0.1:<port>/<projectId>`). The database-reachability gate uses repo-root compose Postgres 17 through a plain `pg` client wired in as a named health check — never through `@hearthkit/db`, which this package must not import.
- Runtime libraries (implementor adds, exact pins): `pino@10.3.1`, `@sentry/node@10.71.0` (or another Sentry-compatible SDK that satisfies this contract), `zod@4.4.3`.
- Dev dependencies (implementor adds, exact pins; the gates need them): `pg@8.23.0` and `@types/pg@8.23.1` (plain Postgres client for the database-reachability health gate), `vitest@4.1.11`, `typescript@7.0.2`, `@types/node` (TS 7 does not auto-include it), and `@hearthkit/config` (workspace, see above).

## Out of scope

- **Tracing, performance monitoring, metrics (deferred).** `tracesSampleRate` defaults to `0` but the option already exists, so enabling tracing later is a config change, not a redesign. Metrics are additive.
- **Alerting and uptime monitoring.** Uptime Kuma polls `/health` and Sentry's external check watches Uptime Kuma (plan section 8.3, Phase 7). This package only serves the endpoint they poll.
- **Log shipping and aggregation (deferred).** Logs are newline-delimited JSON on stdout; Docker/Dokploy capture them. A future shipper reads stdout — nothing here assumes a destination.
- **Pretty-printing logs.** Dev ergonomics belong to the app (pipe through `pino-pretty`); the package always emits JSON.
- **Browser/client-side error reporting (deferred).** This package is server-side Node only. A client entry is additive later; nothing here blocks it.
- **Owning `NODE_ENV` or reading `process.env`.** Config owns both; values arrive as explicit parameters.
- **Provisioning GlitchTip.** Phase 7 VPS bootstrap owns that; here the DSN is just a value.
- **Defining health checks.** Apps (and the Phase 4 template) own check wiring; this package only runs and reports them.

## Verified

Checked 2026-08-28:

- pino latest is 10.3.1 — https://registry.npmjs.org/pino/latest
- pino default levels are `trace`(10) `debug`(20) `info`(30) `warn`(40) `error`(50) `fatal`(60); default level `info`; default destination is stdout with newline-delimited JSON — https://github.com/pinojs/pino/blob/main/docs/api.md
- `@sentry/node` latest is 10.71.0 — https://registry.npmjs.org/@sentry/node/latest
- Sentry SDK: if `dsn` is not set the SDK sends no events (no-op); option names are `sampleRate` (errors, default 1.0) and `tracesSampleRate` (transactions); an `enabled` option exists — https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/
- Sentry DSN format is `{PROTOCOL}://{PUBLIC_KEY}@{HOST}{PATH}/{PROJECT_ID}` and SDKs POST envelopes to `{BASE_URI}/api/{PROJECT_ID}/envelope/` (this is what the mock-endpoint gate asserts) — https://develop.sentry.dev/sdk/foundations/transport/authentication/
- Next.js 16.3.3 App Router route handlers: `route.ts` exports `async function GET(request: Request): Promise<Response>` using Web `Request`/`Response`, so a plain `(request: Request) => Promise<Response>` function assigned to `GET` is valid — https://nextjs.org/docs/app/api-reference/file-conventions/route

Not yet verifiable: `packages/observability` has no `package.json`; the type-only import of pino's `Logger` in `observability-contract.ts` resolves once the implementor adds `pino@10.3.1`. The import is type-only, so the contract file still has no runtime effect.

## Questions for the orchestrator

Defaults were chosen so downstream work is not blocked; veto any of these and the contract will be revised.

1. **Sample-rate defaults.** The plan's "conservative sample rates" note is interpreted as `tracesSampleRate` defaulting to `0` (transactions are the volume that fills disk; tracing is deferred anyway) while `errorSampleRate` defaults to `1` — sampling errors below 1 would silently drop real errors and undermine success criterion 4 ("an error in production appears in GlitchTip"). Confirm, or name a lower error default.
2. **Health body verbosity.** `health-check-failed` includes `failureMessage` (first line of the thrown error, truncated to 200 chars). `/health` may be publicly reachable via Uptime Kuma; confirm exposing that line is acceptable for a single-maintainer stack, or it will be stripped when `reportingEnvironment` is `production`.
3. **Module-level reporting state.** `captureError` and `flushErrorReporting` act on singleton state configured by `initializeErrorReporting` (matching the Sentry SDK's own global model and Next.js `instrumentation.ts` usage), with last-call-wins reconfiguration. Confirm this over a handle-passing design.
