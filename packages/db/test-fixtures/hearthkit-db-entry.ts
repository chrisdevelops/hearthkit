import type { EnvSchemaFragment } from '@hearthkit/config'
import type {
  BackupProjectDatabase,
  CreateDrizzleClient,
  CreateProjectDatabase,
  DropProjectDatabase,
  RestoreProjectDatabase,
  RunDatabaseMigrations,
} from '../src/db-contract.ts'

/** The whole public surface a gate is allowed to touch; nothing here may be imported from an internal module. */
export type HearthkitDbEntry = {
  createDrizzleClient: CreateDrizzleClient
  createProjectDatabase: CreateProjectDatabase
  dropProjectDatabase: DropProjectDatabase
  backupProjectDatabase: BackupProjectDatabase
  restoreProjectDatabase: RestoreProjectDatabase
  runDatabaseMigrations: RunDatabaseMigrations
  dbEnvSchemaFragment: EnvSchemaFragment
}

const expectedFunctionNames = [
  'createDrizzleClient',
  'createProjectDatabase',
  'dropProjectDatabase',
  'backupProjectDatabase',
  'restoreProjectDatabase',
  'runDatabaseMigrations',
] as const

/**
 * Loads @hearthkit/db through its public entry point at call time, so a package with no
 * implementation yet fails one gate at a time instead of breaking collection for a whole file.
 */
export async function loadHearthkitDbEntry(): Promise<HearthkitDbEntry> {
  let loaded: unknown
  try {
    loaded = await import('@hearthkit/db')
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/db (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const namespace = loaded as Partial<Record<keyof HearthkitDbEntry, unknown>>
  const missingNames: string[] = expectedFunctionNames.filter(
    (exportName) => typeof namespace[exportName] !== 'function',
  )
  if (namespace.dbEnvSchemaFragment === undefined) {
    missingNames.push('dbEnvSchemaFragment')
  }
  if (missingNames.length > 0) {
    throw new Error(`gate expected @hearthkit/db to export ${missingNames.join(', ')}`)
  }

  return namespace as HearthkitDbEntry
}
