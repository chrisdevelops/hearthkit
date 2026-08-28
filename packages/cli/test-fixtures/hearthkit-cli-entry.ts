import type { GenerateLocalInfraCompose, RunHearthkitCli } from '../src/cli-contract.js'

/** The whole public surface a gate is allowed to touch; nothing here may be imported from an internal module. */
export type HearthkitCliEntry = {
  runHearthkitCli: RunHearthkitCli
  generateLocalInfraCompose: GenerateLocalInfraCompose
}

const expectedFunctionNames = ['runHearthkitCli', 'generateLocalInfraCompose'] as const

/**
 * Loads @hearthkit/cli through its public entry point at call time, so a package with no
 * implementation yet fails one gate at a time instead of breaking collection for a whole file.
 */
export async function loadHearthkitCliEntry(): Promise<HearthkitCliEntry> {
  let loaded: unknown
  try {
    loaded = await import('@hearthkit/cli')
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/cli (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const namespace = loaded as Partial<Record<keyof HearthkitCliEntry, unknown>>
  const missingNames = expectedFunctionNames.filter(
    (exportName) => typeof namespace[exportName] !== 'function',
  )
  if (missingNames.length > 0) {
    throw new Error(`gate expected @hearthkit/cli to export ${missingNames.join(', ')}`)
  }

  return namespace as HearthkitCliEntry
}
