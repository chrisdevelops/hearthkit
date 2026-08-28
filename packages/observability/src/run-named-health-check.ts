import { deriveHealthCheckFailureMessage } from './health-check-failure-message.ts'
import type { HealthCheckResult, NamedHealthCheck } from './observability-contract.ts'

const healthCheckTimedOutMarker = Symbol('hearthkit health check timed out')

/** Runs one check under a hard timeout and turns every outcome, including a throw, into a result value. */
export async function runNamedHealthCheck(
  namedHealthCheck: NamedHealthCheck,
  healthCheckTimeoutMs: number,
): Promise<HealthCheckResult> {
  const { healthCheckName, runHealthCheck } = namedHealthCheck
  const startedAt = performance.now()
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined

  try {
    const timeoutPromise = new Promise<typeof healthCheckTimedOutMarker>((resolve) => {
      timeoutTimer = setTimeout(() => resolve(healthCheckTimedOutMarker), healthCheckTimeoutMs)
    })
    // The async wrapper also catches a check that throws synchronously instead of rejecting.
    const outcome = await Promise.race([(async () => runHealthCheck())(), timeoutPromise])

    if (outcome === healthCheckTimedOutMarker) {
      return {
        kind: 'health-check-timed-out',
        healthCheckName,
        timeoutMs: healthCheckTimeoutMs,
      }
    }

    return {
      kind: 'health-check-passed',
      healthCheckName,
      durationMs: Math.round(performance.now() - startedAt),
    }
  } catch (thrown) {
    return {
      kind: 'health-check-failed',
      healthCheckName,
      failureMessage: deriveHealthCheckFailureMessage(thrown),
    }
  } finally {
    clearTimeout(timeoutTimer)
  }
}
