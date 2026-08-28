import type { Logger as PinoLogger } from 'pino'
import { z } from 'zod'

/** Unique literal prefix of the failure message when a GLITCHTIP_DSN value is URL-valid but not shaped like a Sentry DSN. */
export const observabilityInvalidDsnErrorPrefix = 'hearthkit observability invalid dsn:'

/** Unique literal prefix of the failure message when pending error reports were not delivered within the flush timeout. */
export const observabilityFlushTimeoutErrorPrefix = 'hearthkit observability flush timed out:'

/** Unique literal prefix of the error thrown by createHealthRouteHandler when two health checks share one name. */
export const healthCheckNameConflictErrorPrefix = 'hearthkit health check name conflict:'

/** GlitchTip DSN; an http(s) URL branded so arbitrary strings cannot be passed, full DSN shape is checked at initialize time. */
export const glitchtipDsnSchema = z.url({ protocol: /^https?$/ }).brand<'GlitchtipDsn'>()

/** Branded GlitchTip DSN accepted by the env fragment and initializeErrorReporting. */
export type GlitchtipDsn = z.infer<typeof glitchtipDsnSchema>

/** Log level name; pino's default levels in ascending severity, minimum level defaults to info. */
export const logLevelNameSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])

/** Log level name accepted by LOG_LEVEL and createStructuredLogger. */
export type LogLevelName = z.infer<typeof logLevelNameSchema>

/** Error event id assigned by the Sentry-compatible SDK to a captured event; branded so plain strings cannot be passed. */
export const errorEventIdSchema = z.string().min(1).brand<'ErrorEventId'>()

/** Branded id of one captured error event, returned by captureError when reporting is enabled. */
export type ErrorEventId = z.infer<typeof errorEventIdSchema>

/** Health check name; lowercase kebab-case, max 63 chars, branded so checks are always named deliberately. */
export const healthCheckNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(63)
  .brand<'HealthCheckName'>()

/** Branded name of one health check, echoed in the /health response body. */
export type HealthCheckName = z.infer<typeof healthCheckNameSchema>

/** Sample rate between 0 and 1 used for both error and traces sampling options. */
export const reportingSampleRateSchema = z.number().min(0).max(1)

/** Reporting environment tag; same values as config's NODE_ENV, which stays owned by config and is passed in explicitly. */
export const reportingEnvironmentSchema = z.enum(['development', 'test', 'production'])

/** Environment tag attached to reported errors; the app passes config.NODE_ENV here. */
export type ReportingEnvironment = z.infer<typeof reportingEnvironmentSchema>

/** Env schema fragment this package contributes to config; GLITCHTIP_DSN unset means error reporting is a no-op. */
export const observabilityEnvSchemaFragment = z.object({
  GLITCHTIP_DSN: glitchtipDsnSchema.optional(),
  LOG_LEVEL: logLevelNameSchema.default('info'),
})

/** Failure when a DSN is passed but has no public key before the at-sign or no project id path segment; reporting stays disabled. */
export const errorReportingInvalidDsnFailureSchema = z.object({
  kind: z.literal('error-reporting-invalid-dsn'),
  glitchtipDsn: glitchtipDsnSchema,
  message: z.string().startsWith(observabilityInvalidDsnErrorPrefix),
})

/** Failure when flushErrorReporting could not deliver pending events within flushTimeoutMs. */
export const errorReportsFlushTimeoutFailureSchema = z.object({
  kind: z.literal('error-reports-flush-timed-out'),
  flushTimeoutMs: z.number().int().positive(),
  message: z.string().startsWith(observabilityFlushTimeoutErrorPrefix),
})

/** Failure when two health checks share a name; thrown as an Error by createHealthRouteHandler at wiring time. */
export const healthCheckNameConflictFailureSchema = z.object({
  kind: z.literal('health-check-name-conflict'),
  healthCheckName: healthCheckNameSchema,
  message: z.string().startsWith(healthCheckNameConflictErrorPrefix),
})

/** Every observability failure; none is fatal at runtime, only the name conflict is thrown and only at wiring time. */
export const observabilityFailureSchema = z.discriminatedUnion('kind', [
  errorReportingInvalidDsnFailureSchema,
  errorReportsFlushTimeoutFailureSchema,
  healthCheckNameConflictFailureSchema,
])

/** Discriminated failure union of this package; each variant's message starts with its unique literal prefix. */
export type ObservabilityFailure = z.infer<typeof observabilityFailureSchema>

/** Options for initializeErrorReporting; conservative defaults keep tracing off so a runaway loop cannot fill GlitchTip's disk. */
export const initializeErrorReportingOptionsSchema = z.object({
  glitchtipDsn: glitchtipDsnSchema.optional(),
  reportingEnvironment: reportingEnvironmentSchema.default('development'),
  errorSampleRate: reportingSampleRateSchema.default(1),
  tracesSampleRate: reportingSampleRateSchema.default(0),
})

/** Options type for initializeErrorReporting; every field is optional, calling with nothing yields disabled no-op mode. */
export type InitializeErrorReportingOptions = z.input<typeof initializeErrorReportingOptionsSchema>

/** Success shape when a DSN was accepted and the Sentry-compatible SDK is sending events. */
export const errorReportingEnabledSchema = z.object({
  kind: z.literal('error-reporting-enabled'),
  glitchtipDsn: glitchtipDsnSchema,
})

/** Success shape of no-op mode: no DSN given, so captureError silently skips and nothing is ever sent. */
export const errorReportingDisabledSchema = z.object({
  kind: z.literal('error-reporting-disabled'),
})

/** Full result union of initializeErrorReporting for runtime validation in gates. */
export const initializeErrorReportingResultSchema = z.union([
  errorReportingEnabledSchema,
  errorReportingDisabledSchema,
  errorReportingInvalidDsnFailureSchema,
])

/** Result type of initializeErrorReporting. */
export type InitializeErrorReportingResult = z.infer<typeof initializeErrorReportingResultSchema>

/** Signature of initializeErrorReporting: synchronous, never throws, callable again and the last call wins. */
export type InitializeErrorReporting = (
  options?: InitializeErrorReportingOptions,
) => InitializeErrorReportingResult

/** Extra fields attached to a captured error event; values must be JSON-serializable to survive transport. */
export const errorContextSchema = z.record(z.string(), z.unknown())

/** Extra-context type accepted by captureError. */
export type ErrorContext = z.infer<typeof errorContextSchema>

/** Success shape when an event was handed to the SDK; delivery is asynchronous, flush before asserting arrival. */
export const errorCapturedSchema = z.object({
  kind: z.literal('error-captured'),
  errorEventId: errorEventIdSchema,
})

/** Designed no-op shape when reporting is disabled or uninitialized; not a failure. Sampling is the SDK's job, not observable here. */
export const errorCaptureSkippedSchema = z.object({
  kind: z.literal('error-capture-skipped'),
})

/** Full result union of captureError for runtime validation in gates. */
export const captureErrorResultSchema = z.union([errorCapturedSchema, errorCaptureSkippedSchema])

/** Result type of captureError. */
export type CaptureErrorResult = z.infer<typeof captureErrorResultSchema>

/** Signature of captureError: accepts anything thrown, never throws itself, even before initializeErrorReporting ran. */
export type CaptureError = (error: unknown, errorContext?: ErrorContext) => CaptureErrorResult

/** Options for flushErrorReporting; flushTimeoutMs bounds how long delivery of pending events may take. */
export const flushErrorReportingOptionsSchema = z.object({
  flushTimeoutMs: z.number().int().positive().default(2000),
})

/** Options type for flushErrorReporting; omit entirely to use the default timeout. */
export type FlushErrorReportingOptions = z.input<typeof flushErrorReportingOptionsSchema>

/** Success shape when all pending error reports were delivered, or reporting is disabled so there was nothing to send. */
export const errorReportsFlushedSchema = z.object({
  kind: z.literal('error-reports-flushed'),
})

/** Full result union of flushErrorReporting for runtime validation in gates. */
export const flushErrorReportingResultSchema = z.union([
  errorReportsFlushedSchema,
  errorReportsFlushTimeoutFailureSchema,
])

/** Result type of flushErrorReporting. */
export type FlushErrorReportingResult = z.infer<typeof flushErrorReportingResultSchema>

/** Signature of flushErrorReporting: never throws; timeout comes back as a returned failure value. */
export type FlushErrorReporting = (
  options?: FlushErrorReportingOptions,
) => Promise<FlushErrorReportingResult>

/** Options for createStructuredLogger; the app passes config.LOG_LEVEL as logLevel, loggerName becomes the name binding. */
export const createStructuredLoggerOptionsSchema = z.object({
  logLevel: logLevelNameSchema.default('info'),
  loggerName: z.string().min(1).optional(),
})

/** Options type for createStructuredLogger; omit entirely for an info-level unnamed logger. */
export type CreateStructuredLoggerOptions = z.input<typeof createStructuredLoggerOptionsSchema>

/** The returned logger is a pino Logger writing newline-delimited JSON to stdout. */
export type StructuredLogger = PinoLogger

/** Runtime check that a value looks like a pino logger; the precise type lives on StructuredLogger, not in Zod. */
export const structuredLoggerSchema = z.custom<StructuredLogger>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { info?: unknown }).info === 'function' &&
    typeof (value as { error?: unknown }).error === 'function',
)

/** Signature of createStructuredLogger: synchronous, never throws, always writes JSON lines to stdout. */
export type CreateStructuredLogger = (options?: CreateStructuredLoggerOptions) => StructuredLogger

/** Runtime check that a health check function was supplied; resolving means healthy, throwing or rejecting means failed. */
export const runHealthCheckFunctionSchema = z.custom<() => Promise<void>>(
  (value) => typeof value === 'function',
)

/** One named health check wired in by the app; this is how a db ping reaches /health without observability importing db. */
export const namedHealthCheckSchema = z.object({
  healthCheckName: healthCheckNameSchema,
  runHealthCheck: runHealthCheckFunctionSchema,
})

/** Named health check type accepted by createHealthRouteHandler. */
export type NamedHealthCheck = {
  healthCheckName: HealthCheckName
  runHealthCheck: () => Promise<void>
}

/** Options for createHealthRouteHandler; checks run concurrently, each bounded by healthCheckTimeoutMs. */
export const createHealthRouteHandlerOptionsSchema = z.object({
  healthChecks: z.array(namedHealthCheckSchema).default([]),
  healthCheckTimeoutMs: z.number().int().positive().default(5000),
})

/** Options type for createHealthRouteHandler; omit entirely for a checkless handler that always returns 200. */
export type CreateHealthRouteHandlerOptions = z.input<typeof createHealthRouteHandlerOptionsSchema>

/** Result of one health check inside the /health response body; failed and timed-out entries make the whole report 503. */
export const healthCheckResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('health-check-passed'),
    healthCheckName: healthCheckNameSchema,
    durationMs: z.number().min(0),
  }),
  z.object({
    kind: z.literal('health-check-failed'),
    healthCheckName: healthCheckNameSchema,
    failureMessage: z.string().max(200),
  }),
  z.object({
    kind: z.literal('health-check-timed-out'),
    healthCheckName: healthCheckNameSchema,
    timeoutMs: z.number().int().positive(),
  }),
])

/** Per-check result type reported in the /health JSON body. */
export type HealthCheckResult = z.infer<typeof healthCheckResultSchema>

/** JSON body of the /health response; status ok means HTTP 200, unhealthy means HTTP 503. */
export const healthReportSchema = z.object({
  status: z.enum(['ok', 'unhealthy']),
  checks: z.array(healthCheckResultSchema),
})

/** Health report type returned as the /health response body. */
export type HealthReport = z.infer<typeof healthReportSchema>

/** A Next.js App Router GET route handler; assign it directly to the exported GET in app/health/route.ts. */
export type HealthRouteHandler = (request: Request) => Promise<Response>

/** Runtime check that a health route handler was produced; the precise type lives on HealthRouteHandler, not in Zod. */
export const healthRouteHandlerSchema = z.custom<HealthRouteHandler>(
  (value) => typeof value === 'function',
)

/** Signature of createHealthRouteHandler: throws only on duplicate check names; the returned handler never throws. */
export type CreateHealthRouteHandler = (
  options?: CreateHealthRouteHandlerOptions,
) => HealthRouteHandler
