import { afterAll, describe, expect, it } from 'vitest'
import { expectDbFailure, expectResultKind } from '../test-fixtures/db-result-expectations.js'
import {
  absentMigrationsFolderPath,
  gateBaselineMigrationCount,
  gateMigrationsFolderPath,
} from '../test-fixtures/gate-migrations-folders.js'
import { loadHearthkitDbEntry } from '../test-fixtures/hearthkit-db-entry.js'
import {
  createAdminOwnedGateDatabase,
  queryRowsAs,
  removeGateDatabase,
  uniqueGateDatabaseName,
  unreachableDatabaseUrl,
} from '../test-fixtures/postgres-gate-server.js'
import {
  dbMigrationConflictErrorPrefix,
  dbMigrationsFolderErrorPrefix,
  dbUnreachableErrorPrefix,
  runDatabaseMigrationsResultSchema,
  type PostgresConnectionString,
  type ProjectDatabaseName,
} from './db-contract.js'

const namesToRemove: ProjectDatabaseName[] = []

/** An empty throwaway database with nothing applied to it yet, cleaned up in afterAll. */
async function freshMigrationTargetUrl(purpose: string): Promise<PostgresConnectionString> {
  const name = uniqueGateDatabaseName(purpose)
  namesToRemove.push(name)
  return createAdminOwnedGateDatabase(name)
}

afterAll(async () => {
  for (const name of namesToRemove) {
    await removeGateDatabase(name)
  }
})

describe('runDatabaseMigrations', () => {
  it('applies pending migrations in journal order and applies nothing on a second run', async () => {
    const { runDatabaseMigrations } = await loadHearthkitDbEntry()
    const databaseUrl = await freshMigrationTargetUrl('migrate')
    const migrationsFolderPath = gateMigrationsFolderPath('gate-baseline')

    const firstRun = await runDatabaseMigrations({ databaseUrl, migrationsFolderPath })
    runDatabaseMigrationsResultSchema.parse(firstRun)
    expect(expectResultKind(firstRun, 'database-migrations-applied').appliedMigrationCount).toBe(
      gateBaselineMigrationCount,
    )

    // Both migrations really ran, in order: 0001 adds the column to the table 0000 created.
    expect(
      await queryRowsAs(databaseUrl, 'select id, title, body from gate_notes order by id'),
    ).toEqual([{ id: 1, title: 'first note', body: null }])

    const secondRun = await runDatabaseMigrations({ databaseUrl, migrationsFolderPath })
    runDatabaseMigrationsResultSchema.parse(secondRun)
    expect(expectResultKind(secondRun, 'database-migrations-applied').appliedMigrationCount).toBe(0)
  })

  it('returns migrations-folder-not-found for a missing folder and for a folder with no journal', async () => {
    const { runDatabaseMigrations } = await loadHearthkitDbEntry()
    const databaseUrl = await freshMigrationTargetUrl('migrate_folder')

    const missingFolderPath = absentMigrationsFolderPath()
    const missingFolder = await runDatabaseMigrations({
      databaseUrl,
      migrationsFolderPath: missingFolderPath,
    })
    runDatabaseMigrationsResultSchema.parse(missingFolder)
    const missingFolderFailure = expectDbFailure(missingFolder, 'migrations-folder-not-found')
    expect(missingFolderFailure.migrationsFolderPath).toBe(missingFolderPath)
    expect(missingFolderFailure.message.startsWith(dbMigrationsFolderErrorPrefix)).toBe(true)

    // A folder of .sql files without meta/_journal.json is not a migrations folder either.
    const journalLessPath = gateMigrationsFolderPath('gate-missing-journal')
    const journalLessFailure = expectDbFailure(
      await runDatabaseMigrations({ databaseUrl, migrationsFolderPath: journalLessPath }),
      'migrations-folder-not-found',
    )
    expect(journalLessFailure.migrationsFolderPath).toBe(journalLessPath)
  })

  it('returns database-migration-conflict when a migration statement fails', async () => {
    const { runDatabaseMigrations } = await loadHearthkitDbEntry()
    const databaseUrl = await freshMigrationTargetUrl('migrate_broken')

    const result = await runDatabaseMigrations({
      databaseUrl,
      migrationsFolderPath: gateMigrationsFolderPath('gate-failing-statement'),
    })

    runDatabaseMigrationsResultSchema.parse(result)
    const failure = expectDbFailure(result, 'database-migration-conflict')
    expect(failure.message.startsWith(dbMigrationConflictErrorPrefix)).toBe(true)
  })

  it('returns database-migration-conflict when an already applied migration was edited', async () => {
    const { runDatabaseMigrations } = await loadHearthkitDbEntry()
    const databaseUrl = await freshMigrationTargetUrl('migrate_altered')

    expectResultKind(
      await runDatabaseMigrations({
        databaseUrl,
        migrationsFolderPath: gateMigrationsFolderPath('gate-baseline'),
      }),
      'database-migrations-applied',
    )

    // Same journal entries, different SQL for the migration that was already applied.
    const result = await runDatabaseMigrations({
      databaseUrl,
      migrationsFolderPath: gateMigrationsFolderPath('gate-altered-history'),
    })

    runDatabaseMigrationsResultSchema.parse(result)
    const failure = expectDbFailure(result, 'database-migration-conflict')
    expect(failure.message.startsWith(dbMigrationConflictErrorPrefix)).toBe(true)
  })

  it('returns database-server-unreachable when the project connection points at a closed port', async () => {
    const { runDatabaseMigrations } = await loadHearthkitDbEntry()

    const result = await runDatabaseMigrations({
      databaseUrl: unreachableDatabaseUrl,
      migrationsFolderPath: gateMigrationsFolderPath('gate-baseline'),
    })

    runDatabaseMigrationsResultSchema.parse(result)
    const failure = expectDbFailure(result, 'database-server-unreachable')
    expect(failure.message.startsWith(dbUnreachableErrorPrefix)).toBe(true)
  })
})
