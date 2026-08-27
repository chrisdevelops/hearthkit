import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import type { RunDatabaseMigrations, RunDatabaseMigrationsResult } from './db-contract.js'
import { databaseMigrationConflictFailure } from './db-failure-results.js'
import {
  countPendingMigrations,
  findMigrationHistoryDivergence,
  readAppliedMigrationRecords,
} from './drizzle-migration-history.js'
import { readDrizzleMigrationsFolder } from './drizzle-migrations-folder.js'
import { describeCaughtError } from './postgres-error-classification.js'
import { mapPostgresErrorToDbFailure } from './postgres-error-to-db-failure.js'

/** How long to wait for the project connection before treating the server as unreachable. */
const migrationConnectionTimeoutMilliseconds = 10_000

/**
 * Applies drizzle-kit generated migrations in journal order over the project-scoped connection,
 * refusing to run when applied history no longer matches the folder. Idempotent: a run with
 * nothing pending reports zero applied.
 */
export const runDatabaseMigrations: RunDatabaseMigrations = async ({
  databaseUrl,
  migrationsFolderPath,
}) => {
  const folderRead = readDrizzleMigrationsFolder(migrationsFolderPath)
  if (folderRead.kind === 'drizzle-migrations-folder-unusable') {
    return folderRead.failure
  }

  const migrationPool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: migrationConnectionTimeoutMilliseconds,
  })
  migrationPool.on('error', () => undefined)

  try {
    const appliedRecords = await readAppliedMigrationRecords(migrationPool)
    const divergence = findMigrationHistoryDivergence(appliedRecords, folderRead.folderMigrations)
    if (divergence !== undefined) {
      return databaseMigrationConflictFailure(divergence)
    }

    const pendingMigrationCount = countPendingMigrations(
      appliedRecords,
      folderRead.folderMigrations,
    )
    await migrate(drizzle({ client: migrationPool }), {
      migrationsFolder: migrationsFolderPath,
    })
    return { kind: 'database-migrations-applied', appliedMigrationCount: pendingMigrationCount }
  } catch (error) {
    return failureForRefusedMigration(error)
  } finally {
    await migrationPool.end()
  }
}

/**
 * Anything the shared mapping does not name happened while replaying a migration statement, which
 * is exactly what the migration-conflict failure is for.
 */
function failureForRefusedMigration(error: unknown): RunDatabaseMigrationsResult {
  return (
    mapPostgresErrorToDbFailure(error) ??
    databaseMigrationConflictFailure(describeCaughtError(error))
  )
}
