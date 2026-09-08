import { healthReportSchema, namedHealthCheckSchema } from '@hearthkit/observability'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  expectExportedFunctionOfType,
  importTemplateModule,
} from '../test-fixtures/app-template-gate-expectations.ts'
import {
  gateSupersetEnv,
  reserveDeadLoopbackPort,
} from '../test-fixtures/app-template-gate-environment.ts'
import { readTemplateFileText } from '../test-fixtures/app-template-tree-files.ts'
import {
  appHealthDependencyUnavailableErrorPrefix,
  appHealthRoutePath,
  appTemplateFailureSchema,
  appTemplateHealthCheckNames,
  appTemplateOptionalPackageNames,
  appTemplateSectionsByOptionalPackage,
  appTemplateSupersetEnvVariableNames,
} from './app-template-contract.ts'

/** A GET handler as Next calls it: a Web Request in, a Web Response out. */
type HealthRouteHandler = (request: Request) => Promise<Response>

/** Narrows the route's GET export to the handler signature; the gate below checks what it answers. */
const healthRouteHandlerSchema = z.custom<HealthRouteHandler>(
  (value) => typeof value === 'function',
)

/** Every check name the superset registers: none always-on, plus each selected package's. */
const supersetHealthCheckNames = [
  ...appTemplateHealthCheckNames,
  ...appTemplateOptionalPackageNames.flatMap(
    (optionalPackageName) =>
      appTemplateSectionsByOptionalPackage[optionalPackageName].healthCheckNames,
  ),
]

/** Stubs a full superset environment with DATABASE_URL pointed wherever the caller says. */
function stubSupersetEnvironment(overrides: Readonly<Record<string, string>>): void {
  for (const [variableName, value] of Object.entries(
    gateSupersetEnv({
      supersetEnvVariableNames: appTemplateSupersetEnvVariableNames,
      optionalEnvVariableNames: appTemplateOptionalPackageNames.flatMap(
        (optionalPackageName) =>
          appTemplateSectionsByOptionalPackage[optionalPackageName].envVariableNames,
      ),
      overrides,
    }),
  )) {
    vi.stubEnv(variableName, value)
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe(`GET ${appHealthRoutePath}`, () => {
  it('answers 503 naming the database check when DATABASE_URL points at a closed port', async () => {
    // app-health-dependency-unavailable was structurally unreachable while the registry was empty.
    // @hearthkit/auth's database check is its first and only producer, and a closed loopback port is
    // the whole of what it takes to reach it — no Postgres, so this stays in the fast tier.
    const deadDatabasePortNumber = await reserveDeadLoopbackPort()
    stubSupersetEnvironment({
      DATABASE_URL: `postgres://hearthkit:hearthkit@127.0.0.1:${String(deadDatabasePortNumber)}/hearthkit`,
    })

    const routeNamespace = await importTemplateModule(
      'app/health/route.ts',
      () => import('../app/health/route.ts'),
    )
    const handleHealthRequest = expectExportedFunctionOfType(
      routeNamespace,
      'GET',
      'app/health/route.ts',
      healthRouteHandlerSchema,
    )

    const response = await handleHealthRequest(new Request(`http://localhost${appHealthRoutePath}`))

    expect(response.status).toBe(503)
    expect(response.headers.get('content-type')).toContain('application/json')

    const report = healthReportSchema.parse(await response.json())
    expect(report.status).toBe('unhealthy')
    const failedHealthChecks = report.checks.filter((check) => check.kind !== 'health-check-passed')
    expect(failedHealthChecks.map((check) => String(check.healthCheckName))).toEqual(['database'])

    // GET handlers have been dynamic by default since Next 15, so the route needs no segment config
    // and must not pin one: force-dynamic here would be cargo cult, force-static would cache /health
    // and answer a stale ok for as long as the cache lived.
    expect(routeNamespace.dynamic).toBeUndefined()
    expect(routeNamespace.revalidate).toBeUndefined()

    const healthDependencyFailure = appTemplateFailureSchema.parse({
      kind: 'app-health-dependency-unavailable',
      failedHealthChecks,
      message: `${appHealthDependencyUnavailableErrorPrefix} database`,
    })
    expect(healthDependencyFailure.kind).toBe('app-health-dependency-unavailable')
  })

  it('registers exactly the checks the selected packages contribute, which in the superset is auth database', async () => {
    // Empty always-on, plus one per selected package: appTemplateHealthCheckNames is the
    // empty-selection registry and @hearthkit/auth's marked block is what appends to it. Nothing
    // else registers a check, deliberately — a storage bucket ping or verifyPaymentsTablesExist
    // would put a service in the /health path of every request.
    stubSupersetEnvironment({})
    const registryNamespace = await importTemplateModule(
      'app-health-checks.ts',
      () => import('../app-health-checks.ts'),
    )
    const registry = registryNamespace.appHealthCheckRegistry

    if (!Array.isArray(registry)) {
      throw new Error(
        'gate expected templates/app/app-health-checks.ts to export appHealthCheckRegistry as an array',
      )
    }

    const registeredNames = registry.map((namedHealthCheck) =>
      String(namedHealthCheckSchema.parse(namedHealthCheck).healthCheckName),
    )
    expect(registeredNames).toEqual([...supersetHealthCheckNames])
    expect(supersetHealthCheckNames).toEqual(['database'])
    expect([...appTemplateHealthCheckNames]).toEqual([])

    // The route must hand this registry to createHealthRouteHandler, not an inline empty list, or a
    // package appending a check would never reach /health.
    expect(readTemplateFileText('app/health/route.ts')).toContain('appHealthCheckRegistry')
  })
})
