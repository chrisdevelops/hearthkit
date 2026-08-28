import { flush as flushSentryClient } from '@sentry/node'
import { readErrorReportingMode } from './error-reporting-mode.ts'
import {
  flushErrorReportingOptionsSchema,
  observabilityFlushTimeoutErrorPrefix,
  type FlushErrorReporting,
  type FlushErrorReportingResult,
} from './observability-contract.ts'

const fallbackFlushTimeoutMs = 2000

function buildFlushTimeoutFailure(flushTimeoutMs: number): FlushErrorReportingResult {
  return {
    kind: 'error-reports-flush-timed-out',
    flushTimeoutMs,
    message: `${observabilityFlushTimeoutErrorPrefix} pending error reports were still undelivered after ${flushTimeoutMs}ms`,
  }
}

/** Waits for pending events to reach the ingest endpoint; a timeout comes back as a value, never as a rejection. */
export const flushErrorReporting: FlushErrorReporting = async (options) => {
  const parsedOptions = flushErrorReportingOptionsSchema.safeParse(options ?? {})
  const flushTimeoutMs = parsedOptions.success
    ? parsedOptions.data.flushTimeoutMs
    : fallbackFlushTimeoutMs

  try {
    if (readErrorReportingMode().kind !== 'error-reporting-enabled') {
      return { kind: 'error-reports-flushed' }
    }

    const flushedInTime = await flushSentryClient(flushTimeoutMs)
    return flushedInTime
      ? { kind: 'error-reports-flushed' }
      : buildFlushTimeoutFailure(flushTimeoutMs)
  } catch {
    // An SDK that rejects mid-flush is indistinguishable from undelivered reports, so report that.
    return buildFlushTimeoutFailure(flushTimeoutMs)
  }
}
