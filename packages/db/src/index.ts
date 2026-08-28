/** Public entry point of @hearthkit/db: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Lazy typed Drizzle client over node-postgres; the caller must close it. */
export { createDrizzleClient } from './create-drizzle-client.ts'

/** Creates a project database plus its same-named scoped login role. */
export { createProjectDatabase } from './create-project-database.ts'

/** Drops a project database with force and drops its role. */
export { dropProjectDatabase } from './drop-project-database.ts'

/** Writes a pg_dump custom-format archive of a project database. */
export { backupProjectDatabase } from './backup-project-database.ts'

/** Restores a pg_dump custom-format archive into an existing project database. */
export { restoreProjectDatabase } from './restore-project-database.ts'

/** Applies drizzle-kit generated migrations over the project-scoped connection. */
export { runDatabaseMigrations } from './run-database-migrations.ts'

/** Contract values: this package's env fragment, the result and failure schemas gates parse with, and the branded vocabulary schemas. */
export {
  backupProjectDatabaseResultSchema,
  createProjectDatabaseResultSchema,
  dbEnvSchemaFragment,
  dbFailureSchema,
  dropProjectDatabaseResultSchema,
  postgresConnectionStringSchema,
  projectDatabaseNameSchema,
  restoreProjectDatabaseResultSchema,
  runDatabaseMigrationsResultSchema,
} from './db-contract.ts'

/** Contract values: the unique literal prefix every returned failure message starts with. */
export {
  dbAlreadyExistsErrorPrefix,
  dbBackupInvalidErrorPrefix,
  dbBackupMissingErrorPrefix,
  dbBackupUnwritableErrorPrefix,
  dbMigrationConflictErrorPrefix,
  dbMigrationsFolderErrorPrefix,
  dbNotFoundErrorPrefix,
  dbPrivilegeErrorPrefix,
  dbToolMissingErrorPrefix,
  dbUnreachableErrorPrefix,
} from './db-contract.ts'

/** Contract types: the failure union and the two branded primitives the whole package speaks in. */
export type { DbFailure, PostgresConnectionString, ProjectDatabaseName } from './db-contract.ts'
