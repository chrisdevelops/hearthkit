import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadHearthkitObservabilityEntry } from '../test-fixtures/hearthkit-observability-entry.ts'
import { expectObservabilityResultKind } from '../test-fixtures/observability-gate-expectations.ts'
import {
  startSentryIngestMockServer,
  startUnresponsiveIngestServer,
  type SentryIngestMockServer,
  type UnresponsiveIngestServer,
} from '../test-fixtures/sentry-ingest-mock-server.ts'
import {
  captureErrorResultSchema,
  errorEventIdSchema,
  flushErrorReportingResultSchema,
  initializeErrorReportingResultSchema,
  observabilityFlushTimeoutErrorPrefix,
  observabilityInvalidDsnErrorPrefix,
} from './observability-contract.ts'

// The reporting SDK keeps process-wide state, so these gates run in one file, in this order, and
// reconfigure through initializeErrorReporting (last call wins) rather than pretending to isolate.
let ingestMock: SentryIngestMockServer
let unresponsiveIngest: UnresponsiveIngestServer

beforeAll(async () => {
  ingestMock = await startSentryIngestMockServer()
  unresponsiveIngest = await startUnresponsiveIngestServer()
})

afterAll(async () => {
  await ingestMock.closeIngestMockServer()
  await unresponsiveIngest.closeIngestMockServer()
})

describe('error reporting', () => {
  it('skips a capture that happens before initializeErrorReporting was ever called', async () => {
    const { captureError } = await loadHearthkitObservabilityEntry()

    const capturedError = captureError(new Error('gate error raised before any initialize call'))
    captureErrorResultSchema.parse(capturedError)
    expect(capturedError.kind).toBe('error-capture-skipped')

    // Anything can be thrown in JavaScript, and none of it may reach the caller as an exception.
    expect(captureError('gate threw a plain string', { gateContext: 'before-initialize' })).toEqual(
      {
        kind: 'error-capture-skipped',
      },
    )
    expect(captureError(undefined)).toEqual({ kind: 'error-capture-skipped' })
  })

  it('disables reporting with no DSN, so captures are skipped and a flush resolves immediately', async () => {
    const { initializeErrorReporting, captureError, flushErrorReporting } =
      await loadHearthkitObservabilityEntry()

    const initialized = initializeErrorReporting()
    initializeErrorReportingResultSchema.parse(initialized)
    expect(initialized.kind).toBe('error-reporting-disabled')

    const capturedError = captureError(new Error('gate error while reporting is disabled'), {
      gateContext: 'disabled',
    })
    captureErrorResultSchema.parse(capturedError)
    expect(capturedError.kind).toBe('error-capture-skipped')

    const flushed = await flushErrorReporting()
    flushErrorReportingResultSchema.parse(flushed)
    expect(flushed.kind).toBe('error-reports-flushed')
    expect(ingestMock.receivedRequests).toHaveLength(0)
  })

  it('returns error-reporting-invalid-dsn for a URL that is not shaped like a DSN and stays disabled', async () => {
    const { initializeErrorReporting, captureError, flushErrorReporting } =
      await loadHearthkitObservabilityEntry()

    // Both point at the running mock, so anything actually sent would show up in its request log.
    for (const glitchtipDsn of [ingestMock.dsnWithoutPublicKey, ingestMock.dsnWithoutProjectId]) {
      const initialized = initializeErrorReporting({
        glitchtipDsn,
        reportingEnvironment: 'test',
      })
      initializeErrorReportingResultSchema.parse(initialized)

      const invalidDsn = expectObservabilityResultKind(initialized, 'error-reporting-invalid-dsn')
      expect(invalidDsn.message.startsWith(observabilityInvalidDsnErrorPrefix)).toBe(true)
      expect(invalidDsn.glitchtipDsn).toBe(glitchtipDsn)

      expect(captureError(new Error('gate error after an invalid DSN')).kind).toBe(
        'error-capture-skipped',
      )
    }

    expect((await flushErrorReporting()).kind).toBe('error-reports-flushed')
    expect(ingestMock.receivedRequests).toHaveLength(0)
  })

  it('captures an error with a valid DSN and delivers an envelope to the ingest endpoint on flush', async () => {
    const { initializeErrorReporting, captureError, flushErrorReporting } =
      await loadHearthkitObservabilityEntry()
    const gateRunId = `gate-run-${randomUUID()}`

    const initialized = initializeErrorReporting({
      glitchtipDsn: ingestMock.glitchtipDsn,
      reportingEnvironment: 'test',
      errorSampleRate: 1,
    })
    initializeErrorReportingResultSchema.parse(initialized)
    const enabled = expectObservabilityResultKind(initialized, 'error-reporting-enabled')
    expect(enabled.glitchtipDsn).toBe(ingestMock.glitchtipDsn)

    const capturedResult = captureError(new Error(`gate captured error ${gateRunId}`), {
      gateRunId,
    })
    captureErrorResultSchema.parse(capturedResult)
    const captured = expectObservabilityResultKind(capturedResult, 'error-captured')
    errorEventIdSchema.parse(captured.errorEventId)
    expect(String(captured.errorEventId).length).toBeGreaterThan(0)

    const flushed = await flushErrorReporting({ flushTimeoutMs: 10_000 })
    flushErrorReportingResultSchema.parse(flushed)
    expect(flushed.kind).toBe('error-reports-flushed')

    const envelopeRequests = ingestMock.receivedEnvelopeRequests()
    expect(
      envelopeRequests.length,
      `gate expected a POST to ${ingestMock.envelopeIngestPath}, received ${JSON.stringify(ingestMock.receivedRequests.map((request) => `${request.requestMethod} ${request.requestPath}`))}`,
    ).toBeGreaterThan(0)

    const envelopeBodies = envelopeRequests.map((request) => request.requestBody)
    expect(envelopeBodies.some((body) => body.includes(gateRunId))).toBe(true)

    const normalizedEventId = String(captured.errorEventId).replaceAll('-', '').toLowerCase()
    expect(
      envelopeBodies.some((body) =>
        body.replaceAll('-', '').toLowerCase().includes(normalizedEventId),
      ),
    ).toBe(true)
  })

  it('returns error-reports-flush-timed-out when pending reports cannot be delivered in time', async () => {
    const { initializeErrorReporting, captureError, flushErrorReporting } =
      await loadHearthkitObservabilityEntry()
    const flushTimeoutMs = 250

    const initialized = initializeErrorReporting({
      glitchtipDsn: unresponsiveIngest.glitchtipDsn,
      reportingEnvironment: 'test',
      errorSampleRate: 1,
    })
    expectObservabilityResultKind(initialized, 'error-reporting-enabled')

    expect(captureError(new Error('gate error that can never be delivered')).kind).toBe(
      'error-captured',
    )

    const flushed = await flushErrorReporting({ flushTimeoutMs })
    flushErrorReportingResultSchema.parse(flushed)
    const timedOut = expectObservabilityResultKind(flushed, 'error-reports-flush-timed-out')
    expect(timedOut.flushTimeoutMs).toBe(flushTimeoutMs)
    expect(timedOut.message.startsWith(observabilityFlushTimeoutErrorPrefix)).toBe(true)
  })
})
