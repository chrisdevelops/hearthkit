import { stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import type { ProjectDatabaseName } from '@hearthkit/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  expectCliFailure,
  expectCliSuccess,
  runHearthkitCliGate,
  singleStandardOutputLine,
} from '../test-fixtures/cli-run-expectations.js'
import {
  createGateDirectory,
  gateEnvironment,
  removeGateDirectory,
} from '../test-fixtures/gate-project-directories.js'
import {
  gateCliBaselineMigrationCount,
  gateCliMigrationsFolderPath,
} from '../test-fixtures/gate-migrations-folder.js'
import {
  createAdminOwnedGateDatabase,
  gateAdminDatabaseUrl,
  gateDatabaseExists,
  queryRowsAs,
  removeGateDatabase,
  runPsqlStatement,
  uniqueGateDatabaseName,
} from '../test-fixtures/postgres-gate-psql.js'
import {
  adminDatabaseUrlEnvVariableName,
  cliAdminUrlInvalidErrorPrefix,
  cliDatabaseUrlInvalidErrorPrefix,
  cliDatabaseUrlMissingErrorPrefix,
  cliDbBackupCompleteLinePrefix,
  cliDbCreateCredentialsWarningPrefix,
  cliDbDropCompleteLinePrefix,
  cliDbMigrateCompleteLinePrefix,
  cliDbRestoreCompleteLinePrefix,
  cliUsageErrorPrefix,
  defaultLocalAdminDatabaseUrl,
} from './cli-contract.js'

const namesToRemove: ProjectDatabaseName[] = []
let workingDirectoryPath: string

/** A fresh database name that afterAll will clean up whether or not the gate managed to create it. */
function gateDatabaseName(purpose: string): ProjectDatabaseName {
  const projectDatabaseName = uniqueGateDatabaseName(purpose)
  namesToRemove.push(projectDatabaseName)
  return projectDatabaseName
}

beforeAll(async () => {
  workingDirectoryPath = await createGateDirectory('db-commands')
})

afterAll(async () => {
  for (const projectDatabaseName of namesToRemove) {
    await removeGateDatabase(projectDatabaseName)
  }
  await removeGateDirectory(workingDirectoryPath)
})

describe('hearthkit db commands', () => {
  it('prints exactly the project connection string on stdout and creates a database that connects', async () => {
    const projectDatabaseName = gateDatabaseName('create')

    // Neither the flag nor the env variable is set, so the admin URL falls back to the local default.
    const run = await runHearthkitCliGate({
      argv: ['db', 'create', projectDatabaseName],
      cwd: workingDirectoryPath,
      env: gateEnvironment(),
    })

    const success = expectCliSuccess(run, 'db-create-command-succeeded', 0)
    expect(success.projectDatabaseName).toBe(projectDatabaseName)
    expect(singleStandardOutputLine(run)).toBe(success.connectionString)
    expect(success.connectionString).toContain(new URL(defaultLocalAdminDatabaseUrl).host)
    expect(success.connectionString).toContain(projectDatabaseName)
    // The credentials are shown once and never persisted, so the warning has to be on stderr.
    expect(
      run.standardError
        .split('\n')
        .find((line) => line.startsWith(cliDbCreateCredentialsWarningPrefix)),
    ).toBeDefined()
    expect(await gateDatabaseExists(projectDatabaseName)).toBe(true)
    expect(await queryRowsAs(success.connectionString, 'select 1')).toEqual(['1'])
  })

  it('drops the database named on the command line using the admin url flag', async () => {
    const projectDatabaseName = gateDatabaseName('drop')
    await createAdminOwnedGateDatabase(projectDatabaseName)

    const run = await runHearthkitCliGate({
      argv: ['db', 'drop', projectDatabaseName, '--admin-database-url', gateAdminDatabaseUrl],
      cwd: workingDirectoryPath,
      env: gateEnvironment(),
    })

    const success = expectCliSuccess(run, 'db-drop-command-succeeded', 0)
    expect(success.projectDatabaseName).toBe(projectDatabaseName)
    const line = singleStandardOutputLine(run)
    expect(line.startsWith(cliDbDropCompleteLinePrefix)).toBe(true)
    expect(line).toContain(projectDatabaseName)
    expect(await gateDatabaseExists(projectDatabaseName)).toBe(false)
  })

  it('applies every migration in the folder once and reports zero applied on a second run', async () => {
    const projectDatabaseName = gateDatabaseName('migrate')
    const databaseUrl = await createAdminOwnedGateDatabase(projectDatabaseName)

    const firstRun = await runHearthkitCliGate({
      argv: [
        'db',
        'migrate',
        '--database-url',
        databaseUrl,
        '--migrations-folder',
        gateCliMigrationsFolderPath(),
      ],
      cwd: workingDirectoryPath,
      env: gateEnvironment(),
    })

    const firstSuccess = expectCliSuccess(firstRun, 'db-migrate-command-succeeded', 0)
    expect(firstSuccess.appliedMigrationCount).toBe(gateCliBaselineMigrationCount)
    const firstLine = singleStandardOutputLine(firstRun)
    expect(firstLine.startsWith(cliDbMigrateCompleteLinePrefix)).toBe(true)
    expect(firstLine).toContain(String(gateCliBaselineMigrationCount))
    expect(await queryRowsAs(databaseUrl, 'select title from gate_cli_notes order by id')).toEqual([
      'first note',
    ])

    // The second run resolves the connection from DATABASE_URL instead of the flag.
    const secondRun = await runHearthkitCliGate({
      argv: ['db', 'migrate', '--migrations-folder', gateCliMigrationsFolderPath()],
      cwd: workingDirectoryPath,
      env: gateEnvironment({ DATABASE_URL: databaseUrl }),
    })

    expect(
      expectCliSuccess(secondRun, 'db-migrate-command-succeeded', 0).appliedMigrationCount,
    ).toBe(0)
  })

  it('writes the backup archive to the default backups directory with the byte count it reports', async () => {
    const projectDatabaseName = gateDatabaseName('backup')
    const databaseUrl = await createAdminOwnedGateDatabase(projectDatabaseName)
    await runPsqlStatement(
      databaseUrl,
      "create table gate_cli_orders (id integer primary key, item text not null); insert into gate_cli_orders values (1, 'kettle')",
    )

    // The admin URL comes from the operator environment variable this time, not from a flag.
    const run = await runHearthkitCliGate({
      argv: ['db', 'backup', projectDatabaseName],
      cwd: workingDirectoryPath,
      env: gateEnvironment({ [adminDatabaseUrlEnvVariableName]: gateAdminDatabaseUrl }),
    })

    const success = expectCliSuccess(run, 'db-backup-command-succeeded', 0)
    expect(success.projectDatabaseName).toBe(projectDatabaseName)
    // The default path is returned absolute, resolved from the working directory.
    expect(isAbsolute(success.backupFilePath)).toBe(true)
    expect(success.backupFilePath).toContain('backups')
    expect(basename(success.backupFilePath)).toMatch(
      new RegExp(`^${projectDatabaseName}-\\d{8}T\\d{6}Z\\.dump$`),
    )
    const archiveStats = await stat(resolve(workingDirectoryPath, success.backupFilePath))
    expect(archiveStats.size).toBe(success.backupByteCount)
    const line = singleStandardOutputLine(run)
    expect(line.startsWith(cliDbBackupCompleteLinePrefix)).toBe(true)
    expect(line).toContain(String(success.backupByteCount))
  })

  it('backs up a database, drops it, creates it again, restores the archive and finds the rows', async () => {
    const projectDatabaseName = gateDatabaseName('restore')
    const environment = gateEnvironment({
      [adminDatabaseUrlEnvVariableName]: gateAdminDatabaseUrl,
    })
    const backupFilePath = join(workingDirectoryPath, `${projectDatabaseName}.dump`)

    const created = expectCliSuccess(
      await runHearthkitCliGate({
        argv: ['db', 'create', projectDatabaseName],
        cwd: workingDirectoryPath,
        env: environment,
      }),
      'db-create-command-succeeded',
      0,
    )
    await runPsqlStatement(
      created.connectionString,
      "create table gate_cli_orders (id integer primary key, item text not null); insert into gate_cli_orders values (1, 'kettle'), (2, 'hearth')",
    )

    const backedUp = expectCliSuccess(
      await runHearthkitCliGate({
        argv: ['db', 'backup', projectDatabaseName, '--backup-file', backupFilePath],
        cwd: workingDirectoryPath,
        env: environment,
      }),
      'db-backup-command-succeeded',
      0,
    )
    expect(backedUp.backupFilePath).toBe(backupFilePath)

    expectCliSuccess(
      await runHearthkitCliGate({
        argv: ['db', 'drop', projectDatabaseName],
        cwd: workingDirectoryPath,
        env: environment,
      }),
      'db-drop-command-succeeded',
      0,
    )
    expect(await gateDatabaseExists(projectDatabaseName)).toBe(false)

    // Restore needs the target database back first; the archive holds objects, not the database.
    const recreated = expectCliSuccess(
      await runHearthkitCliGate({
        argv: ['db', 'create', projectDatabaseName],
        cwd: workingDirectoryPath,
        env: environment,
      }),
      'db-create-command-succeeded',
      0,
    )

    const restoreRun = await runHearthkitCliGate({
      argv: ['db', 'restore', projectDatabaseName, backupFilePath],
      cwd: workingDirectoryPath,
      env: environment,
    })

    const restored = expectCliSuccess(restoreRun, 'db-restore-command-succeeded', 0)
    expect(restored.projectDatabaseName).toBe(projectDatabaseName)
    expect(restored.backupFilePath).toBe(backupFilePath)
    const line = singleStandardOutputLine(restoreRun)
    expect(line.startsWith(cliDbRestoreCompleteLinePrefix)).toBe(true)
    expect(line).toContain(projectDatabaseName)
    expect(
      await queryRowsAs(recreated.connectionString, 'select item from gate_cli_orders order by id'),
    ).toEqual(['kettle', 'hearth'])
  })

  it('fails with exit code 2 when the database name argument is not a project database name', async () => {
    const run = await runHearthkitCliGate({
      argv: ['db', 'create', 'Gate_Uppercase_Name'],
      cwd: workingDirectoryPath,
      env: gateEnvironment(),
    })

    const failure = expectCliFailure(run, 'cli-usage-invalid', 2)
    expect(failure.message.startsWith(cliUsageErrorPrefix)).toBe(true)
    expect(run.standardError).toContain(failure.message)
    expect(run.standardOutput.trim()).toBe('')
    expect(await gateDatabaseExists('Gate_Uppercase_Name')).toBe(false)
  })

  it('fails with admin-database-url-invalid when the admin url flag is not a postgres url', async () => {
    const projectDatabaseName = gateDatabaseName('bad_admin_url')

    const run = await runHearthkitCliGate({
      argv: [
        'db',
        'create',
        projectDatabaseName,
        '--admin-database-url',
        'not-a-postgres-url://hearthkit',
      ],
      cwd: workingDirectoryPath,
      env: gateEnvironment(),
    })

    const failure = expectCliFailure(run, 'admin-database-url-invalid', 1)
    expect(failure.message.startsWith(cliAdminUrlInvalidErrorPrefix)).toBe(true)
    expect(run.standardError).toContain(failure.message)
    expect(await gateDatabaseExists(projectDatabaseName)).toBe(false)
  })

  it('fails with database-url-missing when db migrate has neither the flag nor DATABASE_URL', async () => {
    const run = await runHearthkitCliGate({
      argv: ['db', 'migrate', '--migrations-folder', gateCliMigrationsFolderPath()],
      cwd: workingDirectoryPath,
      env: gateEnvironment(),
    })

    const failure = expectCliFailure(run, 'database-url-missing', 1)
    expect(failure.message.startsWith(cliDatabaseUrlMissingErrorPrefix)).toBe(true)
    expect(failure.message).toContain('DATABASE_URL')
    expect(run.standardError).toContain(failure.message)
  })

  it('fails with database-url-invalid when the given project database url is not a postgres url', async () => {
    const run = await runHearthkitCliGate({
      argv: [
        'db',
        'migrate',
        '--database-url',
        'http://localhost:5432/gate',
        '--migrations-folder',
        gateCliMigrationsFolderPath(),
      ],
      cwd: workingDirectoryPath,
      env: gateEnvironment(),
    })

    const failure = expectCliFailure(run, 'database-url-invalid', 1)
    expect(failure.message.startsWith(cliDatabaseUrlInvalidErrorPrefix)).toBe(true)
    expect(run.standardError).toContain(failure.message)
  })

  it('carries the db failure verbatim when dropping a database that is not on the server', async () => {
    const projectDatabaseName = uniqueGateDatabaseName('absent')

    const run = await runHearthkitCliGate({
      argv: ['db', 'drop', projectDatabaseName],
      cwd: workingDirectoryPath,
      env: gateEnvironment({ [adminDatabaseUrlEnvVariableName]: gateAdminDatabaseUrl }),
    })

    const failure = expectCliFailure(run, 'db-command-failed', 1)
    expect(failure.dbFailure.kind).toBe('project-database-not-found')
    // The CLI never re-words a db failure, so its own message is the db message unchanged.
    expect(failure.message).toBe(failure.dbFailure.message)
    expect(failure.message.startsWith('hearthkit db ')).toBe(true)
    expect(run.standardError).toContain(failure.message)
  })
})
