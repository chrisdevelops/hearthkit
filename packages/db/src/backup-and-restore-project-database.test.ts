import { stat } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  absentArchiveFilePath,
  archivePathBlockedByAFile,
  createBackupGateDirectory,
  emptyPathDirectory,
  invalidArchiveFilePath,
  removeBackupGateDirectory,
  unwrittenArchivePath,
  withoutPostgresToolsOnPath,
  writeGateArchiveWithPgDump,
} from '../test-fixtures/backup-archive-gate-files.js'
import { expectDbFailure, expectResultKind } from '../test-fixtures/db-result-expectations.js'
import { loadHearthkitDbEntry } from '../test-fixtures/hearthkit-db-entry.js'
import {
  createAdminOwnedGateDatabase,
  gateAdminDatabaseUrl,
  gateDatabaseExists,
  queryRowsAs,
  removeGateDatabase,
  uniqueGateDatabaseName,
  withPostgresClient,
} from '../test-fixtures/postgres-gate-server.js'
import {
  backupProjectDatabaseResultSchema,
  dbBackupInvalidErrorPrefix,
  dbBackupMissingErrorPrefix,
  dbBackupUnwritableErrorPrefix,
  dbToolMissingErrorPrefix,
  restoreProjectDatabaseResultSchema,
  type PostgresConnectionString,
  type ProjectDatabaseName,
} from './db-contract.js'

const namesToRemove: ProjectDatabaseName[] = []

/** A fresh name that afterAll will clean up whether or not the gate managed to create it. */
function gateDatabaseName(purpose: string): ProjectDatabaseName {
  const name = uniqueGateDatabaseName(purpose)
  namesToRemove.push(name)
  return name
}

// The failure gates need a database and an archive that are unquestionably fine, so the only thing
// that can go wrong is the one thing each gate is about. Neither is built with this package.
const standingDatabaseName = gateDatabaseName('archive_target')
let standingDatabaseUrl: PostgresConnectionString
let gateDirectoryPath: string
let validArchiveFilePath: string

beforeAll(async () => {
  gateDirectoryPath = await createBackupGateDirectory()
  standingDatabaseUrl = await createAdminOwnedGateDatabase(standingDatabaseName)
  await withPostgresClient(standingDatabaseUrl, async (client) => {
    await client.query('create table gate_orders (id integer primary key, item text not null)')
    await client.query("insert into gate_orders (id, item) values (1, 'kettle')")
  })
  validArchiveFilePath = await writeGateArchiveWithPgDump(standingDatabaseUrl, gateDirectoryPath)
})

afterAll(async () => {
  for (const name of namesToRemove) {
    await removeGateDatabase(name)
  }
  await removeBackupGateDirectory(gateDirectoryPath)
})

describe('backupProjectDatabase and restoreProjectDatabase', () => {
  it('backs up a project database, drops it, recreates it, restores it and finds the rows again', async () => {
    const {
      backupProjectDatabase,
      createProjectDatabase,
      dropProjectDatabase,
      restoreProjectDatabase,
    } = await loadHearthkitDbEntry()
    const projectDatabaseName = gateDatabaseName('cycle')

    const created = expectResultKind(
      await createProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName,
      }),
      'project-database-created',
    )
    await withPostgresClient(created.connectionString, async (client) => {
      await client.query('create table gate_orders (id integer primary key, item text not null)')
      await client.query("insert into gate_orders (id, item) values (1, 'kettle'), (2, 'hearth')")
    })

    // The parent directories of this path do not exist yet; backup has to create them.
    const backupFilePath = unwrittenArchivePath(gateDirectoryPath)
    const backupResult = await backupProjectDatabase({
      adminDatabaseUrl: gateAdminDatabaseUrl,
      projectDatabaseName,
      backupFilePath,
    })
    backupProjectDatabaseResultSchema.parse(backupResult)
    const backedUp = expectResultKind(backupResult, 'project-database-backed-up')
    expect(backedUp.projectDatabaseName).toBe(projectDatabaseName)
    expect(backedUp.backupFilePath).toBe(backupFilePath)
    expect(backedUp.backupByteCount).toBe((await stat(backupFilePath)).size)

    expectResultKind(
      await dropProjectDatabase({ adminDatabaseUrl: gateAdminDatabaseUrl, projectDatabaseName }),
      'project-database-dropped',
    )
    expect(await gateDatabaseExists(projectDatabaseName)).toBe(false)

    // Restore needs the target database back first; the archive holds objects, not the database.
    const recreated = expectResultKind(
      await createProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName,
      }),
      'project-database-created',
    )

    const restoreResult = await restoreProjectDatabase({
      adminDatabaseUrl: gateAdminDatabaseUrl,
      projectDatabaseName,
      backupFilePath,
    })
    restoreProjectDatabaseResultSchema.parse(restoreResult)
    const restored = expectResultKind(restoreResult, 'project-database-restored')
    expect(restored.projectDatabaseName).toBe(projectDatabaseName)
    expect(restored.backupFilePath).toBe(backupFilePath)

    // The rows came back, and the recreated project role can still read them.
    expect(
      await queryRowsAs(recreated.connectionString, 'select id, item from gate_orders order by id'),
    ).toEqual([
      { id: 1, item: 'kettle' },
      { id: 2, item: 'hearth' },
    ])
  })

  it('returns backup-file-unwritable when the archive path cannot be created', async () => {
    const { backupProjectDatabase } = await loadHearthkitDbEntry()
    const backupFilePath = await archivePathBlockedByAFile(gateDirectoryPath)

    const result = await backupProjectDatabase({
      adminDatabaseUrl: gateAdminDatabaseUrl,
      projectDatabaseName: standingDatabaseName,
      backupFilePath,
    })

    backupProjectDatabaseResultSchema.parse(result)
    const failure = expectDbFailure(result, 'backup-file-unwritable')
    expect(failure.backupFilePath).toBe(backupFilePath)
    expect(failure.message.startsWith(dbBackupUnwritableErrorPrefix)).toBe(true)
  })

  it('returns backup-file-not-found when the archive to restore is not there', async () => {
    const { restoreProjectDatabase } = await loadHearthkitDbEntry()
    const backupFilePath = absentArchiveFilePath(gateDirectoryPath)

    const result = await restoreProjectDatabase({
      adminDatabaseUrl: gateAdminDatabaseUrl,
      projectDatabaseName: standingDatabaseName,
      backupFilePath,
    })

    restoreProjectDatabaseResultSchema.parse(result)
    const failure = expectDbFailure(result, 'backup-file-not-found')
    expect(failure.backupFilePath).toBe(backupFilePath)
    expect(failure.message.startsWith(dbBackupMissingErrorPrefix)).toBe(true)
  })

  it('returns backup-file-invalid when the file is not a pg_dump custom-format archive', async () => {
    const { restoreProjectDatabase } = await loadHearthkitDbEntry()
    const backupFilePath = await invalidArchiveFilePath(gateDirectoryPath)

    const result = await restoreProjectDatabase({
      adminDatabaseUrl: gateAdminDatabaseUrl,
      projectDatabaseName: standingDatabaseName,
      backupFilePath,
    })

    restoreProjectDatabaseResultSchema.parse(result)
    const failure = expectDbFailure(result, 'backup-file-invalid')
    expect(failure.backupFilePath).toBe(backupFilePath)
    expect(failure.message.startsWith(dbBackupInvalidErrorPrefix)).toBe(true)
  })

  it('returns postgres-tool-missing naming pg_dump when PATH has no postgres client tools', async () => {
    const { backupProjectDatabase } = await loadHearthkitDbEntry()
    const emptyDirectoryPath = await emptyPathDirectory(gateDirectoryPath)
    const backupFilePath = unwrittenArchivePath(gateDirectoryPath)

    const result = await withoutPostgresToolsOnPath(emptyDirectoryPath, () =>
      backupProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName: standingDatabaseName,
        backupFilePath,
      }),
    )

    backupProjectDatabaseResultSchema.parse(result)
    const failure = expectDbFailure(result, 'postgres-tool-missing')
    expect(failure.toolName).toBe('pg_dump')
    expect(failure.message.startsWith(dbToolMissingErrorPrefix)).toBe(true)
    expect(failure.message).toContain('pg_dump')
  })

  it('returns postgres-tool-missing naming pg_restore when PATH has no postgres client tools', async () => {
    const { restoreProjectDatabase } = await loadHearthkitDbEntry()
    const emptyDirectoryPath = await emptyPathDirectory(gateDirectoryPath)

    const result = await withoutPostgresToolsOnPath(emptyDirectoryPath, () =>
      restoreProjectDatabase({
        adminDatabaseUrl: gateAdminDatabaseUrl,
        projectDatabaseName: standingDatabaseName,
        backupFilePath: validArchiveFilePath,
      }),
    )

    restoreProjectDatabaseResultSchema.parse(result)
    const failure = expectDbFailure(result, 'postgres-tool-missing')
    expect(failure.toolName).toBe('pg_restore')
    expect(failure.message.startsWith(dbToolMissingErrorPrefix)).toBe(true)
    expect(failure.message).toContain('pg_restore')
  })
})
