import { healthReportSchema, namedHealthCheckSchema } from '@hearthkit/observability'
import { describe, expect, it } from 'vitest'
import {
  expectExportedFunction,
  importTemplateModule,
} from '../test-fixtures/app-template-gate-expectations.ts'
import { readTemplateFileText } from '../test-fixtures/app-template-tree-files.ts'
import { appHealthRoutePath, appTemplateHealthCheckNames } from './app-template-contract.ts'

/** A GET handler as Next calls it: a Web Request in, a Web Response out. */
type HealthRouteHandler = (request: Request) => Promise<Response>

describe(`GET ${appHealthRoutePath}`, () => {
  it('answers 200 with an ok report and no checks when called directly', async () => {
    const routeNamespace = await importTemplateModule(
      'app/health/route.ts',
      () => import('../app/health/route.ts'),
    )
    const handleHealthRequest = expectExportedFunction(
      routeNamespace,
      'GET',
      'app/health/route.ts',
    ) as unknown as HealthRouteHandler

    const response = await handleHealthRequest(new Request(`http://localhost${appHealthRoutePath}`))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')

    const report = healthReportSchema.parse(await response.json())
    expect(report.status).toBe('ok')
    expect(report.checks).toEqual([])

    // GET handlers have been dynamic by default since Next 15, so the route needs no segment config
    // and must not pin one: force-dynamic here would be cargo cult, force-static would cache /health.
    expect(routeNamespace.dynamic).toBeUndefined()
    expect(routeNamespace.revalidate).toBeUndefined()
  })

  it('registers no health check in Phase 4, which is why /health cannot answer 503 yet', async () => {
    // app-health-dependency-unavailable is structurally unreachable while this registry is empty.
    // The 503 path is gated inside @hearthkit/observability; the first Phase 5 package to append a
    // check makes it reachable here.
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
    expect(registeredNames).toEqual([...appTemplateHealthCheckNames])

    // The route must hand this registry to createHealthRouteHandler, not an inline empty list, or a
    // Phase 5 package appending a check would never reach /health.
    expect(readTemplateFileText('app/health/route.ts')).toContain('appHealthCheckRegistry')
  })
})
