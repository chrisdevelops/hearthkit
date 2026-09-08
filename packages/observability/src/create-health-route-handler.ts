import {
  createHealthRouteHandlerOptionsSchema,
  healthCheckNameConflictErrorPrefix,
  type CreateHealthRouteHandler,
  type CreateHealthRouteHandlerOptions,
  type HealthReport,
  type NamedHealthCheck,
} from './observability-contract.ts'
import { runNamedHealthCheck } from './run-named-health-check.ts'

const fallbackHealthCheckTimeoutMs = 5000
const healthReportJsonContentType = 'application/json; charset=utf-8'

function throwOnDuplicateHealthCheckName(healthChecks: readonly NamedHealthCheck[]): void {
  const seenHealthCheckNames = new Set<string>()
  for (const { healthCheckName } of healthChecks) {
    const seenName = String(healthCheckName)
    if (seenHealthCheckNames.has(seenName)) {
      throw new Error(
        `${healthCheckNameConflictErrorPrefix} two health checks are both named ${seenName}`,
      )
    }
    seenHealthCheckNames.add(seenName)
  }
}

// Validation is advisory here: the contract allows only the duplicate-name throw, so options the
// schema rejects fall back to the documented default instead of crashing an app at boot.
function readHealthCheckTimeoutMs(requestedTimeoutMs: number | undefined): number {
  return typeof requestedTimeoutMs === 'number' &&
    Number.isInteger(requestedTimeoutMs) &&
    requestedTimeoutMs > 0
    ? requestedTimeoutMs
    : fallbackHealthCheckTimeoutMs
}

function buildHealthResponse(healthReport: HealthReport): Response {
  return new Response(JSON.stringify(healthReport), {
    status: healthReport.status === 'ok' ? 200 : 503,
    headers: { 'content-type': healthReportJsonContentType },
  })
}

/** Builds the /health GET handler; throws only when two checks share a name, and the handler itself never throws. */
export const createHealthRouteHandler: CreateHealthRouteHandler = (options) => {
  const requestedOptions: CreateHealthRouteHandlerOptions = options ?? {}
  const parsedOptions = createHealthRouteHandlerOptionsSchema.safeParse(requestedOptions)
  const healthChecks: readonly NamedHealthCheck[] = parsedOptions.success
    ? parsedOptions.data.healthChecks
    : // The option type is zod's input type, which carries no HealthCheckName brand, so this branch
      // parses the checks on their own through the same contract schema. Keeping the caller's
      // checks beats turning /health into a permanent 200 when only the timeout was rejected; a
      // check the schema itself rejects throws here, at boot, rather than running under a name the
      // contract never allowed.
      createHealthRouteHandlerOptionsSchema.shape.healthChecks.parse(requestedOptions.healthChecks)
  const healthCheckTimeoutMs = readHealthCheckTimeoutMs(
    parsedOptions.success
      ? parsedOptions.data.healthCheckTimeoutMs
      : requestedOptions.healthCheckTimeoutMs,
  )

  throwOnDuplicateHealthCheckName(healthChecks)

  return async (_request: Request): Promise<Response> => {
    try {
      const checks = await Promise.all(
        healthChecks.map((namedHealthCheck) =>
          runNamedHealthCheck(namedHealthCheck, healthCheckTimeoutMs),
        ),
      )
      const isHealthy = checks.every((check) => check.kind === 'health-check-passed')
      return buildHealthResponse({ status: isHealthy ? 'ok' : 'unhealthy', checks })
    } catch {
      // Unreachable in practice: every check outcome is already a value. Never answer ok on a surprise.
      return buildHealthResponse({ status: 'unhealthy', checks: [] })
    }
  }
}
