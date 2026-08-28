import { captureException } from '@sentry/node'
import { readErrorReportingMode } from './error-reporting-mode.ts'
import { errorEventIdSchema, type CaptureError } from './observability-contract.ts'

/** Hands any thrown value to the SDK; returns a skip rather than throwing when reporting is off or unstarted. */
export const captureError: CaptureError = (error, errorContext) => {
  try {
    if (readErrorReportingMode().kind !== 'error-reporting-enabled') {
      return { kind: 'error-capture-skipped' }
    }

    const errorEventId = captureException(
      error,
      errorContext === undefined ? undefined : { extra: errorContext },
    )
    const parsedEventId = errorEventIdSchema.safeParse(errorEventId)
    if (!parsedEventId.success) {
      return { kind: 'error-capture-skipped' }
    }

    return { kind: 'error-captured', errorEventId: parsedEventId.data }
  } catch {
    // Reporting an error must never become a second error the caller has to handle.
    return { kind: 'error-capture-skipped' }
  }
}
