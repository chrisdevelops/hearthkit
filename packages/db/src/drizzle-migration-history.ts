import type { MigrationMeta } from 'drizzle-orm/migrator'
import type { Pool } from 'pg'

/** Schema drizzle's node-postgres migrator writes its applied history into when no override is given. */
const drizzleMigrationsSchemaName = 'drizzle'

/** Table drizzle's node-postgres migrator writes its applied history into when no override is given. */
const drizzleMigrationsTableName = '__drizzle_migrations'

/** One row of drizzle's applied history: the sha256 of the migration file and the journal `when` it was applied under. */
export type AppliedMigrationRecord = {
  migrationHash: string
  journalMilliseconds: number
}

/**
 * Reads drizzle's applied history, returning an empty list when the history table is not there yet.
 * Uses to_regclass so an unmigrated database is not mistaken for a broken one.
 */
export async function readAppliedMigrationRecords(
  migrationPool: Pool,
): Promise<AppliedMigrationRecord[]> {
  const presence = await migrationPool.query<{ history_table: string | null }>(
    'select to_regclass($1) as history_table',
    [`${drizzleMigrationsSchemaName}.${drizzleMigrationsTableName}`],
  )
  if (presence.rows[0]?.history_table == null) {
    return []
  }

  const applied = await migrationPool.query<{ hash: string; created_at: string | number | null }>(
    `select hash, created_at from ${drizzleMigrationsSchemaName}.${drizzleMigrationsTableName} order by created_at asc`,
  )
  return applied.rows.map((row) => ({
    migrationHash: row.hash,
    journalMilliseconds: Number(row.created_at ?? 0),
  }))
}

/**
 * Names how applied history diverges from the folder, or returns undefined when they still agree.
 * Drizzle's own migrator only compares the newest applied timestamp, so it would silently skip an
 * already applied migration whose file was edited; this is where that is caught.
 */
export function findMigrationHistoryDivergence(
  appliedRecords: readonly AppliedMigrationRecord[],
  folderMigrations: readonly MigrationMeta[],
): string | undefined {
  const hashByJournalMilliseconds = new Map(
    folderMigrations.map((migration) => [migration.folderMillis, migration.hash]),
  )

  for (const applied of appliedRecords) {
    const folderHash = hashByJournalMilliseconds.get(applied.journalMilliseconds)
    if (folderHash === undefined) {
      return `an applied migration stamped ${applied.journalMilliseconds} is no longer in the folder`
    }
    if (folderHash !== applied.migrationHash) {
      return `the migration stamped ${applied.journalMilliseconds} was edited after it was applied (applied sha256 ${applied.migrationHash}, folder sha256 ${folderHash})`
    }
  }
  return undefined
}

/** How many folder migrations the migrator will actually run: drizzle applies only entries newer than the newest applied one. */
export function countPendingMigrations(
  appliedRecords: readonly AppliedMigrationRecord[],
  folderMigrations: readonly MigrationMeta[],
): number {
  const newestApplied = appliedRecords.reduce(
    (newest, applied) => Math.max(newest, applied.journalMilliseconds),
    Number.NEGATIVE_INFINITY,
  )
  return folderMigrations.filter((migration) => migration.folderMillis > newestApplied).length
}
