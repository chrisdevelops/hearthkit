import type * as observabilityContract from '../src/observability-contract.ts'
import type {
  CaptureError,
  CreateHealthRouteHandler,
  CreateStructuredLogger,
  FlushErrorReporting,
  InitializeErrorReporting,
} from '../src/observability-contract.ts'

/** The env fragment's own type, read off the contract module so this fixture needs no runtime import. */
type ObservabilityEnvSchemaFragment = typeof observabilityContract.observabilityEnvSchemaFragment

/** The whole public surface a gate is allowed to call; nothing here may be imported from an internal module. */
export type HearthkitObservabilityEntry = {
  initializeErrorReporting: InitializeErrorReporting
  captureError: CaptureError
  flushErrorReporting: FlushErrorReporting
  createStructuredLogger: CreateStructuredLogger
  createHealthRouteHandler: CreateHealthRouteHandler
  observabilityEnvSchemaFragment: ObservabilityEnvSchemaFragment
}

const expectedFunctionNames = [
  'initializeErrorReporting',
  'captureError',
  'flushErrorReporting',
  'createStructuredLogger',
  'createHealthRouteHandler',
] as const

/**
 * Imports @hearthkit/observability through its public entry point at call time, so a package with no
 * implementation yet fails one gate at a time instead of breaking collection for a whole file.
 */
export async function importHearthkitObservabilityNamespace(): Promise<Record<string, unknown>> {
  try {
    return (await import('@hearthkit/observability')) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/observability (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/** The public entry point narrowed to the surface the contract promises; throws naming whatever is not exported yet. */
export async function loadHearthkitObservabilityEntry(): Promise<HearthkitObservabilityEntry> {
  const namespace = await importHearthkitObservabilityNamespace()

  const missingNames: string[] = expectedFunctionNames.filter(
    (exportName) => typeof namespace[exportName] !== 'function',
  )
  if (namespace.observabilityEnvSchemaFragment === undefined) {
    missingNames.push('observabilityEnvSchemaFragment')
  }
  if (missingNames.length > 0) {
    throw new Error(`gate expected @hearthkit/observability to export ${missingNames.join(', ')}`)
  }

  return namespace as unknown as HearthkitObservabilityEntry
}
