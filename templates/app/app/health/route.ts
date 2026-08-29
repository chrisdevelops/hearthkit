import { createHealthRouteHandler } from '@hearthkit/observability'
import { appHealthCheckRegistry } from '../../app-health-checks.ts'

/**
 * The `/health` endpoint. The container healthcheck, the deploy platform, and any uptime monitor
 * poll it, so keep it fast and keep it dependency-driven: the checks come from
 * `app-health-checks.ts`, never from an inline list here.
 *
 * No route segment config: GET handlers have been dynamic by default since Next 15, so `/health`
 * is evaluated per request without `force-dynamic`.
 */
export const GET = createHealthRouteHandler({ healthChecks: [...appHealthCheckRegistry] })
