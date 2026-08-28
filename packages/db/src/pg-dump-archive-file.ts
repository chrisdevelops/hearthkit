import { Buffer } from 'node:buffer'
import { open, stat } from 'node:fs/promises'
import type { DbFailure } from './db-contract.ts'
import { backupFileInvalidFailure, backupFileNotFoundFailure } from './db-failure-results.ts'
import { describeCaughtError } from './postgres-error-classification.ts'

/** First five bytes of every pg_dump custom-format archive, checked before pg_restore is spawned. */
const customFormatArchiveMagic = 'PGDMP'

/**
 * Returns the failure to hand back when the path is not a readable pg_dump custom-format archive,
 * and undefined when it is. Checked here so an unreadable file is never blamed on pg_restore.
 */
export async function findUnusableArchiveFailure(
  backupFilePath: string,
): Promise<DbFailure | undefined> {
  try {
    const archiveStats = await stat(backupFilePath)
    if (!archiveStats.isFile()) {
      return backupFileNotFoundFailure(backupFilePath, 'is not a readable file')
    }
  } catch (error) {
    return backupFileNotFoundFailure(backupFilePath, describeCaughtError(error))
  }

  let leadingBytes: Buffer
  let bytesRead: number
  try {
    const archiveHandle = await open(backupFilePath, 'r')
    try {
      leadingBytes = Buffer.alloc(customFormatArchiveMagic.length)
      const readResult = await archiveHandle.read(leadingBytes, 0, leadingBytes.length, 0)
      bytesRead = readResult.bytesRead
    } finally {
      await archiveHandle.close()
    }
  } catch (error) {
    return backupFileNotFoundFailure(backupFilePath, describeCaughtError(error))
  }

  const magic = leadingBytes.subarray(0, bytesRead).toString('latin1')
  if (magic !== customFormatArchiveMagic) {
    return backupFileInvalidFailure(
      backupFilePath,
      'does not start with the PGDMP marker of a pg_dump custom-format archive',
    )
  }
  return undefined
}
