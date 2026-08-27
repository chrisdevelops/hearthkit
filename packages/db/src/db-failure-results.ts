import {
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
  type DbFailure,
  type ProjectDatabaseName,
} from './db-contract.js'

/** Every failure this package returns is built here, so each message keeps its unique literal prefix in one place. */
type DbFailureOf<TKind extends DbFailure['kind']> = Extract<DbFailure, { kind: TKind }>

/** Server could not be reached or refused the connection; `detail` is the driver's own words. */
export function databaseServerUnreachableFailure(
  detail: string,
): DbFailureOf<'database-server-unreachable'> {
  return {
    kind: 'database-server-unreachable',
    message: `${dbUnreachableErrorPrefix} ${detail}`,
  }
}

/** The name is taken: either the database or its same-named role is already on the server. */
export function projectDatabaseAlreadyExistsFailure(
  projectDatabaseName: ProjectDatabaseName,
): DbFailureOf<'project-database-already-exists'> {
  return {
    kind: 'project-database-already-exists',
    projectDatabaseName,
    message: `${dbAlreadyExistsErrorPrefix} ${projectDatabaseName} is already taken by a database or a same-named role on this server`,
  }
}

/** No database of that name is on the server, so there is nothing to drop, back up or restore into. */
export function projectDatabaseNotFoundFailure(
  projectDatabaseName: ProjectDatabaseName,
): DbFailureOf<'project-database-not-found'> {
  return {
    kind: 'project-database-not-found',
    projectDatabaseName,
    message: `${dbNotFoundErrorPrefix} ${projectDatabaseName} is not a database on this server`,
  }
}

/** The connected role lacks the privilege the action needs, such as an admin connection without CREATEDB or CREATEROLE. */
export function databasePrivilegeDeniedFailure(
  detail: string,
): DbFailureOf<'database-privilege-denied'> {
  return {
    kind: 'database-privilege-denied',
    message: `${dbPrivilegeErrorPrefix} ${detail}`,
  }
}

/** Applied migration history diverges from the folder, or a migration statement failed against the database. */
export function databaseMigrationConflictFailure(
  detail: string,
): DbFailureOf<'database-migration-conflict'> {
  return {
    kind: 'database-migration-conflict',
    message: `${dbMigrationConflictErrorPrefix} ${detail}`,
  }
}

/** The path is not a drizzle migrations folder: it is missing, or it has no meta/_journal.json. */
export function migrationsFolderNotFoundFailure(
  migrationsFolderPath: string,
  detail: string,
): DbFailureOf<'migrations-folder-not-found'> {
  return {
    kind: 'migrations-folder-not-found',
    migrationsFolderPath,
    message: `${dbMigrationsFolderErrorPrefix} ${migrationsFolderPath} ${detail}`,
  }
}

/** The archive to restore from is missing or cannot be read. */
export function backupFileNotFoundFailure(
  backupFilePath: string,
  detail: string,
): DbFailureOf<'backup-file-not-found'> {
  return {
    kind: 'backup-file-not-found',
    backupFilePath,
    message: `${dbBackupMissingErrorPrefix} ${backupFilePath} ${detail}`,
  }
}

/** The archive path cannot be created or written, so no backup was produced. */
export function backupFileUnwritableFailure(
  backupFilePath: string,
  detail: string,
): DbFailureOf<'backup-file-unwritable'> {
  return {
    kind: 'backup-file-unwritable',
    backupFilePath,
    message: `${dbBackupUnwritableErrorPrefix} ${backupFilePath} ${detail}`,
  }
}

/** The file is readable but is not a pg_dump custom-format archive. */
export function backupFileInvalidFailure(
  backupFilePath: string,
  detail: string,
): DbFailureOf<'backup-file-invalid'> {
  return {
    kind: 'backup-file-invalid',
    backupFilePath,
    message: `${dbBackupInvalidErrorPrefix} ${backupFilePath} ${detail}`,
  }
}

/** A required Postgres client binary is not on PATH; the message names the tool immediately after the prefix. */
export function postgresToolMissingFailure(
  toolName: 'pg_dump' | 'pg_restore',
): DbFailureOf<'postgres-tool-missing'> {
  return {
    kind: 'postgres-tool-missing',
    toolName,
    message: `${dbToolMissingErrorPrefix} ${toolName} was not found on PATH; install the Postgres 17 client tools`,
  }
}
