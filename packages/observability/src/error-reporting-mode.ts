import type { GlitchtipDsn } from './observability-contract.ts'

/** Whether error reporting is currently sending; anything but enabled means captures are silent skips. */
export type ErrorReportingMode =
  | { kind: 'error-reporting-enabled'; glitchtipDsn: GlitchtipDsn }
  | { kind: 'error-reporting-disabled' }

// Deliberately process-wide singleton state: the Sentry-compatible SDK keeps global state too, and
// Next.js calls initializeErrorReporting once per process from instrumentation.ts. Last call wins.
let currentErrorReportingMode: ErrorReportingMode = { kind: 'error-reporting-disabled' }

/** Reads the process-wide reporting mode; before any initialize call it reads as disabled. */
export function readErrorReportingMode(): ErrorReportingMode {
  return currentErrorReportingMode
}

/** Replaces the process-wide reporting mode; only initializeErrorReporting is allowed to call this. */
export function writeErrorReportingMode(errorReportingMode: ErrorReportingMode): void {
  currentErrorReportingMode = errorReportingMode
}
