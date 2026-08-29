import {
  captureError,
  createStructuredLogger,
  initializeErrorReporting,
} from '@hearthkit/observability'
import { requireAppRuntimeConfig } from './app-runtime-config.ts'

/**
 * Next.js instrumentation: the first code this server runs, and the last place an unhandled server
 * error passes through. Next calls `register` once per server instance before any request is
 * served, and `onRequestError` for every error thrown while rendering a page or running a route.
 */

/** The one line `register` writes to stdout on a healthy boot; a container run greps for it. */
const appStartupLogMessage = 'hearthkit app started'

/** Request fields Next passes to onRequestError; declared structurally so no Next internal path is imported. */
type ErrorRequest = Readonly<{ path: string; method: string }>

/** Router context Next passes to onRequestError; declared structurally so no Next internal path is imported. */
type ErrorRequestContext = Readonly<{
  routerKind: string
  routePath: string
  routeType: string
}>

/**
 * Validates the environment, turns on error reporting, and logs one startup line.
 *
 * An invalid value throws config's own message, which is what stops a misconfigured server from
 * going on to answer 200. Nothing here touches a Node-only API such as `process.exit`, because Next
 * compiles this file for the Edge runtime too and would warn on every build.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return
  }

  const appRuntimeConfig = requireAppRuntimeConfig()

  initializeErrorReporting({
    glitchtipDsn: appRuntimeConfig.GLITCHTIP_DSN,
    reportingEnvironment: appRuntimeConfig.NODE_ENV,
  })

  createStructuredLogger({ logLevel: appRuntimeConfig.LOG_LEVEL }).info(appStartupLogMessage)
}

/** Reports a server error to GlitchTip with the request and router context attached; a no-op without a DSN. */
export function onRequestError(
  error: unknown,
  errorRequest: ErrorRequest,
  errorRequestContext: ErrorRequestContext,
): void {
  captureError(error, {
    requestPath: errorRequest.path,
    requestMethod: errorRequest.method,
    routerKind: errorRequestContext.routerKind,
    routePath: errorRequestContext.routePath,
    routeType: errorRequestContext.routeType,
  })
}
