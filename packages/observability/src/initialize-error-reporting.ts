import { init as initializeSentrySdk } from '@sentry/node'
import { readErrorReportingMode, writeErrorReportingMode } from './error-reporting-mode.ts'
import { parseGlitchtipDsnParts } from './glitchtip-dsn-parts.ts'
import {
  initializeErrorReportingOptionsSchema,
  observabilityInvalidDsnErrorPrefix,
  type InitializeErrorReporting,
} from './observability-contract.ts'

// Reconfiguring the SDK to enabled:false is what makes "last call wins" true for the SDK's own
// automatic capture (uncaught exceptions, unhandled rejections), not just for captureError.
function stopSentryErrorReporting(): void {
  if (readErrorReportingMode().kind === 'error-reporting-enabled') {
    initializeSentrySdk({ enabled: false })
  }
  writeErrorReportingMode({ kind: 'error-reporting-disabled' })
}

/** Configures error reporting once per process; synchronous, never throws, and the last call wins. */
export const initializeErrorReporting: InitializeErrorReporting = (options) => {
  try {
    const parsedOptions = initializeErrorReportingOptionsSchema.safeParse(options ?? {})
    if (!parsedOptions.success) {
      stopSentryErrorReporting()
      return { kind: 'error-reporting-disabled' }
    }

    const { glitchtipDsn, reportingEnvironment, errorSampleRate, tracesSampleRate } =
      parsedOptions.data
    if (glitchtipDsn === undefined) {
      stopSentryErrorReporting()
      return { kind: 'error-reporting-disabled' }
    }

    const dsnParts = parseGlitchtipDsnParts(glitchtipDsn)
    if (dsnParts.kind === 'glitchtip-dsn-malformed') {
      stopSentryErrorReporting()
      return {
        kind: 'error-reporting-invalid-dsn',
        glitchtipDsn,
        message: `${observabilityInvalidDsnErrorPrefix} ${String(glitchtipDsn)} was ignored and error reporting stays disabled because ${dsnParts.malformedReason}`,
      }
    }

    initializeSentrySdk({
      dsn: String(glitchtipDsn),
      environment: reportingEnvironment,
      sampleRate: errorSampleRate,
      tracesSampleRate,
    })
    writeErrorReportingMode({ kind: 'error-reporting-enabled', glitchtipDsn })
    return { kind: 'error-reporting-enabled', glitchtipDsn }
  } catch {
    // Nothing in this package may crash an app, so an SDK that refuses to start leaves reporting off.
    writeErrorReportingMode({ kind: 'error-reporting-disabled' })
    return { kind: 'error-reporting-disabled' }
  }
}
