import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { z } from 'zod'

/** Unique literal prefix of the error message when the Postgres server cannot be reached or refuses the connection. */
export const dbUnreachableErrorPrefix = 'hearthkit db server unreachable:'

/** Unique literal prefix of the error message when the project database or its same-named role already exists. */
export const dbAlreadyExistsErrorPrefix = 'hearthkit db database already exists:'

/** Unique literal prefix of the error message when the named project database does not exist on the server. */
export const dbNotFoundErrorPrefix = 'hearthkit db database not found:'

/** Unique literal prefix of the error message when the admin connection lacks the privilege for the attempted action. */
export const dbPrivilegeErrorPrefix = 'hearthkit db privilege denied:'

/** Unique literal prefix of the error message when applied migration history diverges from the folder or a migration statement fails. */
export const dbMigrationConflictErrorPrefix = 'hearthkit db migration conflict:'

/** Unique literal prefix of the error message when the migrations folder path does not exist or has no journal. */
export const dbMigrationsFolderErrorPrefix = 'hearthkit db migrations folder not found:'

/** Unique literal prefix of the error message when the backup file to restore from does not exist or cannot be read. */
export const dbBackupMissingErrorPrefix = 'hearthkit db backup file not found:'

/** Unique literal prefix of the error message when the backup file path cannot be created or written during backup. */
export const dbBackupUnwritableErrorPrefix = 'hearthkit db backup file unwritable:'

/** Unique literal prefix of the error message when the backup file exists but is not a valid pg_dump custom-format archive. */
export const dbBackupInvalidErrorPrefix = 'hearthkit db backup file invalid:'

/** Unique literal prefix of the error message when a required Postgres client binary is not on PATH. */
export const dbToolMissingErrorPrefix = 'hearthkit db tool missing:'

/** Postgres connection string; must be a postgres:// or postgresql:// URL and is branded so arbitrary strings cannot be passed. */
export const postgresConnectionStringSchema = z
  .url({ protocol: /^postgres(ql)?$/ })
  .brand<'PostgresConnectionString'>()

/** Branded Postgres connection string used for both admin and project-scoped connections. */
export type PostgresConnectionString = z.infer<typeof postgresConnectionStringSchema>

/** Project database name; lowercase snake_case Postgres identifier, max 63 chars, doubles as the scoped role name. */
export const projectDatabaseNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/)
  .max(63)
  .brand<'ProjectDatabaseName'>()

/** Branded project database name; the same value names the database and its scoped login role. */
export type ProjectDatabaseName = z.infer<typeof projectDatabaseNameSchema>

/** Env schema fragment this package contributes to config; DATABASE_URL is the project-scoped connection, never the admin one. */
export const dbEnvSchemaFragment = z.object({
  DATABASE_URL: postgresConnectionStringSchema,
})

/** Every way a db lifecycle or migration call can fail; each variant's message starts with its unique literal prefix. */
export const dbFailureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('database-server-unreachable'),
    message: z.string().startsWith(dbUnreachableErrorPrefix),
  }),
  z.object({
    kind: z.literal('project-database-already-exists'),
    projectDatabaseName: projectDatabaseNameSchema,
    message: z.string().startsWith(dbAlreadyExistsErrorPrefix),
  }),
  z.object({
    kind: z.literal('project-database-not-found'),
    projectDatabaseName: projectDatabaseNameSchema,
    message: z.string().startsWith(dbNotFoundErrorPrefix),
  }),
  z.object({
    kind: z.literal('database-privilege-denied'),
    message: z.string().startsWith(dbPrivilegeErrorPrefix),
  }),
  z.object({
    kind: z.literal('database-migration-conflict'),
    message: z.string().startsWith(dbMigrationConflictErrorPrefix),
  }),
  z.object({
    kind: z.literal('migrations-folder-not-found'),
    migrationsFolderPath: z.string(),
    message: z.string().startsWith(dbMigrationsFolderErrorPrefix),
  }),
  z.object({
    kind: z.literal('backup-file-not-found'),
    backupFilePath: z.string(),
    message: z.string().startsWith(dbBackupMissingErrorPrefix),
  }),
  z.object({
    kind: z.literal('backup-file-unwritable'),
    backupFilePath: z.string(),
    message: z.string().startsWith(dbBackupUnwritableErrorPrefix),
  }),
  z.object({
    kind: z.literal('backup-file-invalid'),
    backupFilePath: z.string(),
    message: z.string().startsWith(dbBackupInvalidErrorPrefix),
  }),
  z.object({
    kind: z.literal('postgres-tool-missing'),
    toolName: z.enum(['pg_dump', 'pg_restore']),
    message: z.string().startsWith(dbToolMissingErrorPrefix),
  }),
])

/** Discriminated failure union returned (never thrown) by every lifecycle and migration function in this package. */
export type DbFailure = z.infer<typeof dbFailureSchema>

/** Runtime shape of createDrizzleClient options; schema is the app's Drizzle table map, typed precisely only via CreateDrizzleClient. */
export const createDrizzleClientOptionsSchema = z.object({
  databaseUrl: postgresConnectionStringSchema,
  schema: z.record(z.string(), z.unknown()).optional(),
})

/** Runtime shape of the client handle; the precise Drizzle client type lives on DrizzleClientHandle, not in Zod. */
export const drizzleClientHandleSchema = z.object({
  drizzleClient: z.custom<NodePgDatabase<Record<string, unknown>>>(
    (value) => typeof value === 'object' && value !== null,
  ),
  closeDatabaseClient: z.custom<() => Promise<void>>((value) => typeof value === 'function'),
})

/** Handle returned by createDrizzleClient; callers must call closeDatabaseClient to end the pool or the process hangs. */
export type DrizzleClientHandle<TSchema extends Record<string, unknown> = Record<string, never>> = {
  drizzleClient: NodePgDatabase<TSchema>
  closeDatabaseClient: () => Promise<void>
}

/** Signature of createDrizzleClient: builds a lazy client, never connects eagerly, so bad servers fail on first query. */
export type CreateDrizzleClient = <
  TSchema extends Record<string, unknown> = Record<string, never>,
>(options: {
  databaseUrl: PostgresConnectionString
  schema?: TSchema
}) => DrizzleClientHandle<TSchema>

/** Options for createProjectDatabase; adminDatabaseUrl must connect as a role allowed to create databases and roles. */
export const createProjectDatabaseOptionsSchema = z.object({
  adminDatabaseUrl: postgresConnectionStringSchema,
  projectDatabaseName: projectDatabaseNameSchema,
})

/** Options type for createProjectDatabase. */
export type CreateProjectDatabaseOptions = z.infer<typeof createProjectDatabaseOptionsSchema>

/** Success shape of createProjectDatabase; connectionString embeds the generated role password and is returned only this once. */
export const projectDatabaseCreatedSchema = z.object({
  kind: z.literal('project-database-created'),
  projectDatabaseName: projectDatabaseNameSchema,
  connectionString: postgresConnectionStringSchema,
})

/** Full result union of createProjectDatabase for runtime validation in gates. */
export const createProjectDatabaseResultSchema = z.union([
  projectDatabaseCreatedSchema,
  dbFailureSchema,
])

/** Result type of createProjectDatabase. */
export type CreateProjectDatabaseResult = z.infer<typeof createProjectDatabaseResultSchema>

/** Signature of createProjectDatabase: creates database plus same-named scoped role, revokes PUBLIC connect, returns connection string. */
export type CreateProjectDatabase = (
  options: CreateProjectDatabaseOptions,
) => Promise<CreateProjectDatabaseResult>

/** Options for dropProjectDatabase; drops the database with force (terminating live connections) and its same-named role. */
export const dropProjectDatabaseOptionsSchema = z.object({
  adminDatabaseUrl: postgresConnectionStringSchema,
  projectDatabaseName: projectDatabaseNameSchema,
})

/** Options type for dropProjectDatabase. */
export type DropProjectDatabaseOptions = z.infer<typeof dropProjectDatabaseOptionsSchema>

/** Success shape of dropProjectDatabase; both the database and its role are gone when this returns. */
export const projectDatabaseDroppedSchema = z.object({
  kind: z.literal('project-database-dropped'),
  projectDatabaseName: projectDatabaseNameSchema,
})

/** Full result union of dropProjectDatabase for runtime validation in gates. */
export const dropProjectDatabaseResultSchema = z.union([
  projectDatabaseDroppedSchema,
  dbFailureSchema,
])

/** Result type of dropProjectDatabase. */
export type DropProjectDatabaseResult = z.infer<typeof dropProjectDatabaseResultSchema>

/** Signature of dropProjectDatabase: irreversible; terminates active connections before dropping. */
export type DropProjectDatabase = (
  options: DropProjectDatabaseOptions,
) => Promise<DropProjectDatabaseResult>

/** Options for backupProjectDatabase; backupFilePath is where the pg_dump custom-format archive is written, parent dirs created. */
export const backupProjectDatabaseOptionsSchema = z.object({
  adminDatabaseUrl: postgresConnectionStringSchema,
  projectDatabaseName: projectDatabaseNameSchema,
  backupFilePath: z.string().min(1),
})

/** Options type for backupProjectDatabase. */
export type BackupProjectDatabaseOptions = z.infer<typeof backupProjectDatabaseOptionsSchema>

/** Success shape of backupProjectDatabase; backupByteCount is the size of the written archive file. */
export const projectDatabaseBackedUpSchema = z.object({
  kind: z.literal('project-database-backed-up'),
  projectDatabaseName: projectDatabaseNameSchema,
  backupFilePath: z.string().min(1),
  backupByteCount: z.number().int().positive(),
})

/** Full result union of backupProjectDatabase for runtime validation in gates. */
export const backupProjectDatabaseResultSchema = z.union([
  projectDatabaseBackedUpSchema,
  dbFailureSchema,
])

/** Result type of backupProjectDatabase. */
export type BackupProjectDatabaseResult = z.infer<typeof backupProjectDatabaseResultSchema>

/** Signature of backupProjectDatabase: shells out to pg_dump, so the host needs Postgres 17 client tools on PATH. */
export type BackupProjectDatabase = (
  options: BackupProjectDatabaseOptions,
) => Promise<BackupProjectDatabaseResult>

/** Options for restoreProjectDatabase; the target project database must already exist (recreate it first after a drop). */
export const restoreProjectDatabaseOptionsSchema = z.object({
  adminDatabaseUrl: postgresConnectionStringSchema,
  projectDatabaseName: projectDatabaseNameSchema,
  backupFilePath: z.string().min(1),
})

/** Options type for restoreProjectDatabase. */
export type RestoreProjectDatabaseOptions = z.infer<typeof restoreProjectDatabaseOptionsSchema>

/** Success shape of restoreProjectDatabase; the archive's objects and rows exist in the target database when this returns. */
export const projectDatabaseRestoredSchema = z.object({
  kind: z.literal('project-database-restored'),
  projectDatabaseName: projectDatabaseNameSchema,
  backupFilePath: z.string().min(1),
})

/** Full result union of restoreProjectDatabase for runtime validation in gates. */
export const restoreProjectDatabaseResultSchema = z.union([
  projectDatabaseRestoredSchema,
  dbFailureSchema,
])

/** Result type of restoreProjectDatabase. */
export type RestoreProjectDatabaseResult = z.infer<typeof restoreProjectDatabaseResultSchema>

/** Signature of restoreProjectDatabase: shells out to pg_restore into an existing project database, replacing clashing objects. */
export type RestoreProjectDatabase = (
  options: RestoreProjectDatabaseOptions,
) => Promise<RestoreProjectDatabaseResult>

/** Options for runDatabaseMigrations; databaseUrl is the project-scoped DATABASE_URL, not the admin connection. */
export const runDatabaseMigrationsOptionsSchema = z.object({
  databaseUrl: postgresConnectionStringSchema,
  migrationsFolderPath: z.string().min(1),
})

/** Options type for runDatabaseMigrations. */
export type RunDatabaseMigrationsOptions = z.infer<typeof runDatabaseMigrationsOptionsSchema>

/** Success shape of runDatabaseMigrations; appliedMigrationCount counts newly applied migrations, zero when already current. */
export const databaseMigrationsAppliedSchema = z.object({
  kind: z.literal('database-migrations-applied'),
  appliedMigrationCount: z.number().int().min(0),
})

/** Full result union of runDatabaseMigrations for runtime validation in gates. */
export const runDatabaseMigrationsResultSchema = z.union([
  databaseMigrationsAppliedSchema,
  dbFailureSchema,
])

/** Result type of runDatabaseMigrations. */
export type RunDatabaseMigrationsResult = z.infer<typeof runDatabaseMigrationsResultSchema>

/** Signature of runDatabaseMigrations: applies drizzle-kit generated migrations in order, idempotent when nothing is pending. */
export type RunDatabaseMigrations = (
  options: RunDatabaseMigrationsOptions,
) => Promise<RunDatabaseMigrationsResult>
