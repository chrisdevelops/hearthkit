import { resolve } from 'node:path'
import type { ProjectDatabaseName } from '@hearthkit/db'
import { defaultBackupDirectoryPath } from './cli-contract.ts'

/**
 * Where db backup writes when --backup-file is absent: ./backups/<name>-<YYYYMMDDTHHMMSSZ>.dump,
 * returned absolute so the printed path stays correct whatever directory the operator reads it in.
 */
export function buildDefaultBackupFilePath(options: {
  workingDirectoryPath: string
  projectDatabaseName: ProjectDatabaseName
  backupInstant?: Date
}): string {
  const stamp = formatBackupFileTimestamp(options.backupInstant ?? new Date())
  return resolve(
    options.workingDirectoryPath,
    defaultBackupDirectoryPath,
    `${options.projectDatabaseName}-${stamp}.dump`,
  )
}

/** Compacts an instant to the UTC stamp the default file name carries: 20260827T154500Z, no separators, no milliseconds. */
function formatBackupFileTimestamp(backupInstant: Date): string {
  return backupInstant
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
}
