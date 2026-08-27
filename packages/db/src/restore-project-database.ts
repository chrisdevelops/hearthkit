import type { RestoreProjectDatabase, RestoreProjectDatabaseResult } from './db-contract.js'
import {
  backupFileInvalidFailure,
  databasePrivilegeDeniedFailure,
  databaseServerUnreachableFailure,
  postgresToolMissingFailure,
} from './db-failure-results.js'
import { findUnusableArchiveFailure } from './pg-dump-archive-file.js'
import { runPostgresToolCommand } from './postgres-tool-process.js'
import { connectionStringForProjectDatabase } from './project-connection-string.js'
import { findMissingProjectDatabaseFailure } from './project-database-presence.js'

/**
 * Restores a pg_dump custom-format archive into an already existing project database, replacing
 * clashing objects. Needs pg_restore on PATH; after a drop, create the database again first.
 */
export const restoreProjectDatabase: RestoreProjectDatabase = async ({
  adminDatabaseUrl,
  projectDatabaseName,
  backupFilePath,
}) => {
  const unusableArchiveFailure = await findUnusableArchiveFailure(backupFilePath)
  if (unusableArchiveFailure !== undefined) {
    return unusableArchiveFailure
  }

  const missingDatabaseFailure = await findMissingProjectDatabaseFailure(
    adminDatabaseUrl,
    projectDatabaseName,
  )
  if (missingDatabaseFailure !== undefined) {
    return missingDatabaseFailure
  }

  const outcome = await runPostgresToolCommand('pg_restore', [
    '--clean',
    '--if-exists',
    '--exit-on-error',
    '--no-password',
    `--dbname=${connectionStringForProjectDatabase(adminDatabaseUrl, projectDatabaseName)}`,
    backupFilePath,
  ])
  if (outcome.kind === 'postgres-tool-not-on-path') {
    return postgresToolMissingFailure('pg_restore')
  }
  if (outcome.kind === 'postgres-tool-failed') {
    return failureForRefusedRestore(backupFilePath, outcome.standardError)
  }

  return { kind: 'project-database-restored', projectDatabaseName, backupFilePath }
}

/**
 * Reads pg_restore's own words. The archive header and the target database were both checked a
 * moment ago, so an archive whose body cannot be replayed is the remaining unnamed cause.
 */
function failureForRefusedRestore(
  backupFilePath: string,
  standardError: string,
): RestoreProjectDatabaseResult {
  const complaint = standardError.toLowerCase()
  if (complaint.includes('permission denied') || complaint.includes('must be owner')) {
    return databasePrivilegeDeniedFailure(standardError.trim())
  }
  if (complaint.includes('could not connect') || complaint.includes('connection to server')) {
    return databaseServerUnreachableFailure(standardError.trim())
  }
  return backupFileInvalidFailure(backupFilePath, standardError.trim())
}
