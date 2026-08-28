import { describe, expect, it } from 'vitest'
import { loadHearthkitObservabilityEntry } from '../test-fixtures/hearthkit-observability-entry.ts'
import {
  createAlwaysPassingHealthCheck,
  createNeverSettlingHealthCheck,
  createPostgresPingHealthCheck,
  createRejectingHealthCheck,
  createStringRejectingHealthCheck,
  gatePostgresUrl,
  unreachablePostgresUrl,
} from '../test-fixtures/named-health-check-fixtures.ts'
import {
  expectObservabilityResultKind,
  expectThrownErrorMessage,
} from '../test-fixtures/observability-gate-expectations.ts'
import {
  healthCheckNameConflictErrorPrefix,
  healthReportSchema,
  type HealthCheckResult,
  type HealthReport,
} from './observability-contract.ts'

const healthRequest = () => new Request('http://localhost/health')

function findCheck(report: HealthReport, healthCheckName: string): HealthCheckResult {
  const found = report.checks.find((check) => String(check.healthCheckName) === healthCheckName)
  if (found === undefined) {
    throw new Error(
      `gate expected a check named ${healthCheckName} in ${JSON.stringify(report.checks)}`,
    )
  }
  return found
}

describe('createHealthRouteHandler', () => {
  it('answers 200 with an ok report when no health checks are configured', async () => {
    const { createHealthRouteHandler } = await loadHearthkitObservabilityEntry()

    const handleHealthRequest = createHealthRouteHandler()
    const response = await handleHealthRequest(healthRequest())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')

    const report = healthReportSchema.parse(await response.json())
    expect(report.status).toBe('ok')
    expect(report.checks).toEqual([])
  })

  it('answers 200 and reports health-check-passed when a real Postgres ping succeeds', async () => {
    const { createHealthRouteHandler } = await loadHearthkitObservabilityEntry()

    const handleHealthRequest = createHealthRouteHandler({
      healthChecks: [createPostgresPingHealthCheck('database', gatePostgresUrl)],
    })
    const response = await handleHealthRequest(healthRequest())

    expect(response.status).toBe(200)
    const report = healthReportSchema.parse(await response.json())
    expect(report.status).toBe('ok')
    expect(report.checks).toHaveLength(1)

    const databaseCheck = expectObservabilityResultKind(
      findCheck(report, 'database'),
      'health-check-passed',
    )
    expect(databaseCheck.durationMs).toBeGreaterThanOrEqual(0)
    expect(databaseCheck.durationMs).toBeLessThan(5_000)
  })

  it('answers 503 and reports health-check-failed with the truncated first line when a check throws', async () => {
    const { createHealthRouteHandler } = await loadHearthkitObservabilityEntry()
    const longFirstLine = `gate failure first line ${'x'.repeat(400)}`
    const rejectionMessage = `${longFirstLine}\ngate failure second line`
    const thrownStringFirstLine = 'gate string rejection first line'

    const handleHealthRequest = createHealthRouteHandler({
      healthChecks: [
        createRejectingHealthCheck('long-failure', rejectionMessage),
        createStringRejectingHealthCheck(
          'string-failure',
          `${thrownStringFirstLine}\ngate string rejection second line`,
        ),
        createPostgresPingHealthCheck('unreachable-database', unreachablePostgresUrl),
        createAlwaysPassingHealthCheck('always-passing'),
      ],
    })
    const response = await handleHealthRequest(healthRequest())

    expect(response.status).toBe(503)
    const report = healthReportSchema.parse(await response.json())
    expect(report.status).toBe('unhealthy')
    expect(report.checks).toHaveLength(4)

    const longFailure = expectObservabilityResultKind(
      findCheck(report, 'long-failure'),
      'health-check-failed',
    )
    expect(longFailure.failureMessage.startsWith('gate failure first line')).toBe(true)
    expect(longFailure.failureMessage.length).toBeLessThanOrEqual(200)
    expect(longFailure.failureMessage).not.toContain('gate failure second line')

    // A rejection that is not an Error falls back to the first line of String(thrown).
    const stringFailure = expectObservabilityResultKind(
      findCheck(report, 'string-failure'),
      'health-check-failed',
    )
    expect(stringFailure.failureMessage).toBe(thrownStringFirstLine)

    // A real connection to a closed port fails the same way, as a value in the body.
    const unreachableDatabase = expectObservabilityResultKind(
      findCheck(report, 'unreachable-database'),
      'health-check-failed',
    )
    expect(unreachableDatabase.failureMessage.length).toBeGreaterThan(0)

    // One failing check must not hide a passing one.
    expectObservabilityResultKind(findCheck(report, 'always-passing'), 'health-check-passed')
  })

  it('answers 503 and reports health-check-timed-out when a check never settles', async () => {
    const { createHealthRouteHandler } = await loadHearthkitObservabilityEntry()
    const healthCheckTimeoutMs = 250

    const handleHealthRequest = createHealthRouteHandler({
      healthChecks: [
        createNeverSettlingHealthCheck('never-settles'),
        createAlwaysPassingHealthCheck('always-passing'),
      ],
      healthCheckTimeoutMs,
    })

    const startedAt = Date.now()
    const response = await handleHealthRequest(healthRequest())
    const elapsedMs = Date.now() - startedAt

    expect(response.status).toBe(503)
    const report = healthReportSchema.parse(await response.json())
    expect(report.status).toBe('unhealthy')

    const timedOut = expectObservabilityResultKind(
      findCheck(report, 'never-settles'),
      'health-check-timed-out',
    )
    expect(timedOut.timeoutMs).toBe(healthCheckTimeoutMs)

    // The passing check still reports, and the whole response is bound by the per-check timeout.
    expectObservabilityResultKind(findCheck(report, 'always-passing'), 'health-check-passed')
    expect(elapsedMs).toBeLessThan(2_000)
  })

  it('throws health-check-name-conflict when two health checks share a name', async () => {
    const { createHealthRouteHandler } = await loadHearthkitObservabilityEntry()

    let thrown: unknown
    try {
      createHealthRouteHandler({
        healthChecks: [
          createAlwaysPassingHealthCheck('database'),
          createPostgresPingHealthCheck('database', gatePostgresUrl),
          createAlwaysPassingHealthCheck('cache'),
        ],
      })
    } catch (error) {
      thrown = error
    }

    const message = expectThrownErrorMessage(thrown)
    expect(message.startsWith(healthCheckNameConflictErrorPrefix)).toBe(true)
    expect(message).toContain('database')
  })
})
