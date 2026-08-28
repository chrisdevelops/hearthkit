import { resolve } from 'node:path'
import {
  backupProjectDatabase,
  createProjectDatabase,
  dropProjectDatabase,
  restoreProjectDatabase,
  runDatabaseMigrations,
} from '@hearthkit/db'
import type { CliCommandInvocation, CliCommandResult } from './cli-contract.ts'
import { dbCommandFailedFailure } from './cli-failure-results.ts'
import type { CliRuntimeContext } from './cli-runtime-context.ts'

/** The five invocations that are only a thin call into @hearthkit/db; no database logic lives in this package. */
export type DbLifecycleInvocation = Extract<
  CliCommandInvocation,
  { commandPath: 'db create' | 'db drop' | 'db migrate' | 'db backup' | 'db restore' }
>

/**
 * Runs one db command through @hearthkit/db and translates its result. Any DbFailure is carried out
 * verbatim, so the underlying message and its prefix reach the operator unchanged. Paths given on
 * the command line are reported exactly as typed but resolved against the working directory first.
 */
export async function runDbLifecycleCommand(options: {
  invocation: DbLifecycleInvocation
  context: CliRuntimeContext
}): Promise<CliCommandResult> {
  const { invocation, context } = options

  if (invocation.commandPath === 'db create') {
    const result = await createProjectDatabase({
      adminDatabaseUrl: invocation.adminDatabaseUrl,
      projectDatabaseName: invocation.projectDatabaseName,
    })
    if (result.kind !== 'project-database-created') {
      return dbCommandFailedFailure(result)
    }
    return {
      kind: 'db-create-command-succeeded',
      projectDatabaseName: result.projectDatabaseName,
      connectionString: result.connectionString,
    }
  }

  if (invocation.commandPath === 'db drop') {
    const result = await dropProjectDatabase({
      adminDatabaseUrl: invocation.adminDatabaseUrl,
      projectDatabaseName: invocation.projectDatabaseName,
    })
    if (result.kind !== 'project-database-dropped') {
      return dbCommandFailedFailure(result)
    }
    return {
      kind: 'db-drop-command-succeeded',
      projectDatabaseName: result.projectDatabaseName,
    }
  }

  if (invocation.commandPath === 'db migrate') {
    const result = await runDatabaseMigrations({
      databaseUrl: invocation.databaseUrl,
      migrationsFolderPath: resolve(context.workingDirectoryPath, invocation.migrationsFolderPath),
    })
    if (result.kind !== 'database-migrations-applied') {
      return dbCommandFailedFailure(result)
    }
    return {
      kind: 'db-migrate-command-succeeded',
      appliedMigrationCount: result.appliedMigrationCount,
    }
  }

  if (invocation.commandPath === 'db backup') {
    const result = await backupProjectDatabase({
      adminDatabaseUrl: invocation.adminDatabaseUrl,
      projectDatabaseName: invocation.projectDatabaseName,
      backupFilePath: resolve(context.workingDirectoryPath, invocation.backupFilePath),
    })
    if (result.kind !== 'project-database-backed-up') {
      return dbCommandFailedFailure(result)
    }
    return {
      kind: 'db-backup-command-succeeded',
      projectDatabaseName: result.projectDatabaseName,
      backupFilePath: invocation.backupFilePath,
      backupByteCount: result.backupByteCount,
    }
  }

  const result = await restoreProjectDatabase({
    adminDatabaseUrl: invocation.adminDatabaseUrl,
    projectDatabaseName: invocation.projectDatabaseName,
    backupFilePath: resolve(context.workingDirectoryPath, invocation.backupFilePath),
  })
  if (result.kind !== 'project-database-restored') {
    return dbCommandFailedFailure(result)
  }
  return {
    kind: 'db-restore-command-succeeded',
    projectDatabaseName: result.projectDatabaseName,
    backupFilePath: invocation.backupFilePath,
  }
}
