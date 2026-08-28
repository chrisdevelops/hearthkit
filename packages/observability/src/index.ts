/** Public entry point of @hearthkit/observability: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Configures error reporting for the process; last call wins and it never throws. */
export { initializeErrorReporting } from './initialize-error-reporting.ts'

/** Reports a thrown value; a silent skip when reporting is disabled or never initialized. */
export { captureError } from './capture-error.ts'

/** Waits for pending error reports to be delivered; a timeout comes back as a value. */
export { flushErrorReporting } from './flush-error-reporting.ts'

/** Builds the pino logger that writes newline-delimited JSON to stdout. */
export { createStructuredLogger } from './create-structured-logger.ts'

/** Builds the Next.js /health route handler; only a duplicate check name throws. */
export { createHealthRouteHandler } from './create-health-route-handler.ts'

/** Contract values: this package's env fragment, the three error prefixes, and the runtime schemas gates and apps parse results with. */
export {
  captureErrorResultSchema,
  errorEventIdSchema,
  flushErrorReportingResultSchema,
  glitchtipDsnSchema,
  healthCheckNameConflictErrorPrefix,
  healthCheckNameSchema,
  healthCheckResultSchema,
  healthReportSchema,
  initializeErrorReportingResultSchema,
  logLevelNameSchema,
  namedHealthCheckSchema,
  observabilityEnvSchemaFragment,
  observabilityFailureSchema,
  observabilityFlushTimeoutErrorPrefix,
  observabilityInvalidDsnErrorPrefix,
} from './observability-contract.ts'

/** Contract types: the branded vocabulary, the failure union, and the option, result and function shapes of every export above. */
export type {
  CaptureError,
  CaptureErrorResult,
  CreateHealthRouteHandler,
  CreateHealthRouteHandlerOptions,
  CreateStructuredLogger,
  CreateStructuredLoggerOptions,
  ErrorContext,
  ErrorEventId,
  FlushErrorReporting,
  FlushErrorReportingOptions,
  FlushErrorReportingResult,
  GlitchtipDsn,
  HealthCheckName,
  HealthCheckResult,
  HealthReport,
  HealthRouteHandler,
  InitializeErrorReporting,
  InitializeErrorReportingOptions,
  InitializeErrorReportingResult,
  LogLevelName,
  NamedHealthCheck,
  ObservabilityFailure,
  ReportingEnvironment,
  StructuredLogger,
} from './observability-contract.ts'
