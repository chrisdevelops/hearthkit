import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator'
import type { DbFailure } from './db-contract.js'
import { migrationsFolderNotFoundFailure } from './db-failure-results.js'
import { describeCaughtError } from './postgres-error-classification.js'

/** The file drizzle-kit writes beside the .sql files; without it a directory of SQL is not a migrations folder. */
const drizzleJournalRelativePath = join('meta', '_journal.json')

/** Either the migrations drizzle would apply, in journal order, or the failure to hand back instead. */
export type DrizzleMigrationsFolderReadResult =
  | { kind: 'drizzle-migrations-folder-read'; folderMigrations: MigrationMeta[] }
  | { kind: 'drizzle-migrations-folder-unusable'; failure: DbFailure }

/**
 * Reads a drizzle-kit migrations folder with drizzle's own reader, so the sha256 of each file
 * matches the hash the migrator records. Reports a missing folder or journal as a failure value.
 */
export function readDrizzleMigrationsFolder(
  migrationsFolderPath: string,
): DrizzleMigrationsFolderReadResult {
  if (!existsSync(migrationsFolderPath) || !statSync(migrationsFolderPath).isDirectory()) {
    return unusableFolder(migrationsFolderPath, 'is not a directory')
  }
  if (!existsSync(join(migrationsFolderPath, drizzleJournalRelativePath))) {
    return unusableFolder(migrationsFolderPath, `has no ${drizzleJournalRelativePath}`)
  }

  try {
    return {
      kind: 'drizzle-migrations-folder-read',
      folderMigrations: readMigrationFiles({ migrationsFolder: migrationsFolderPath }),
    }
  } catch (error) {
    return unusableFolder(migrationsFolderPath, describeCaughtError(error))
  }
}

/** Wraps the folder failure so callers narrow on one discriminant instead of two shapes of result. */
function unusableFolder(
  migrationsFolderPath: string,
  detail: string,
): DrizzleMigrationsFolderReadResult {
  return {
    kind: 'drizzle-migrations-folder-unusable',
    failure: migrationsFolderNotFoundFailure(migrationsFolderPath, detail),
  }
}
