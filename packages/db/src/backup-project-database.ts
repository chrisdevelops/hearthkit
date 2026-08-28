import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BackupProjectDatabase, BackupProjectDatabaseResult } from './db-contract.ts'
import {
  backupFileUnwritableFailure,
  databasePrivilegeDeniedFailure,
  databaseServerUnreachableFailure,
  postgresToolMissingFailure,
} from './db-failure-results.ts'
import { describeCaughtError } from './postgres-error-classification.ts'
import { runPostgresToolCommand } from './postgres-tool-process.ts'
import { connectionStringForProjectDatabase } from './project-connection-string.ts'
import { findMissingProjectDatabaseFailure } from './project-database-presence.ts'

/**
 * Writes a pg_dump custom-format archive of one project database, creating the parent directories
 * of `backupFilePath` first. Needs pg_dump on PATH; failures come back as values.
 */
export const backupProjectDatabase: BackupProjectDatabase = async ({
  adminDatabaseUrl,
  projectDatabaseName,
  backupFilePath,
}) => {
  const missingDatabaseFailure = await findMissingProjectDatabaseFailure(
    adminDatabaseUrl,
    projectDatabaseName,
  )
  if (missingDatabaseFailure !== undefined) {
    return missingDatabaseFailure
  }

  try {
    await mkdir(dirname(backupFilePath), { recursive: true })
  } catch (error) {
    return backupFileUnwritableFailure(backupFilePath, describeCaughtError(error))
  }

  const outcome = await runPostgresToolCommand('pg_dump', [
    '--format=custom',
    '--no-password',
    `--file=${backupFilePath}`,
    connectionStringForProjectDatabase(adminDatabaseUrl, projectDatabaseName),
  ])
  if (outcome.kind === 'postgres-tool-not-on-path') {
    return postgresToolMissingFailure('pg_dump')
  }
  if (outcome.kind === 'postgres-tool-failed') {
    return failureForRefusedDump(backupFilePath, outcome.standardError)
  }

  try {
    const archiveStats = await stat(backupFilePath)
    return {
      kind: 'project-database-backed-up',
      projectDatabaseName,
      backupFilePath,
      backupByteCount: archiveStats.size,
    }
  } catch (error) {
    return backupFileUnwritableFailure(backupFilePath, describeCaughtError(error))
  }
}

/**
 * Reads pg_dump's own words. The database was proven present and reachable a moment ago, so the
 * remaining named outcomes are a privilege refusal, the server going away, or an unwritable path.
 */
function failureForRefusedDump(
  backupFilePath: string,
  standardError: string,
): BackupProjectDatabaseResult {
  const complaint = standardError.toLowerCase()
  if (complaint.includes('permission denied') || complaint.includes('must be owner')) {
    return databasePrivilegeDeniedFailure(standardError.trim())
  }
  if (complaint.includes('could not connect') || complaint.includes('connection to server')) {
    return databaseServerUnreachableFailure(standardError.trim())
  }
  return backupFileUnwritableFailure(backupFilePath, standardError.trim())
}
