import { spawn } from 'node:child_process'
import { cliFailureSchema, runHearthkitCli, type LocalInfraServiceName } from '@hearthkit/cli'
import type { CreateCommandRecord, CreateFailure } from './create-contract.ts'
import { createInfraUpFailedFailure, createInstallFailedFailure } from './create-failure-results.ts'

/**
 * Step six: install, start the local services, create the database. Each runs only when its condition
 * holds, and the run stops at the first failure with the tree left on disk.
 *
 * The two hearthkit commands go through `runHearthkitCli` from this package's own dependency rather
 * than through the project's `node_modules`, so they do not depend on the install having run — and so
 * a `--no-install` scaffold can still bring its services up.
 */

/** How much of a failing pnpm install travels back in the failure; enough to name the cause, short enough to print. */
const installOutputExcerptLimit = 2000

/** What the whole command phase came to; commandsRun lists only commands that completed, in run order. */
export type ScaffoldCommandsOutcome =
  | { kind: 'scaffold-commands-completed'; commandsRun: CreateCommandRecord[] }
  | { kind: 'scaffold-command-failed'; commandsRun: CreateCommandRecord[]; failure: CreateFailure }

/** Everything the command phase needs; infraServices is what step five derived, so nothing is re-derived here. */
export type RunScaffoldCommandsOptions = {
  projectDirectoryPath: string
  projectName: string
  install: boolean
  startInfra: boolean
  infraServices: readonly LocalInfraServiceName[]
  createsDatabase: boolean
}

/** Runs pnpm install in the project and answers its exit code with stdout and stderr joined in arrival order. */
async function runProjectInstall(
  projectDirectoryPath: string,
): Promise<{ exitCode: number; combinedOutput: string }> {
  return new Promise((resolveOutcome, rejectOutcome) => {
    const child = spawn('pnpm', ['install'], {
      cwd: projectDirectoryPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const outputChunks: string[] = []
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => outputChunks.push(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => outputChunks.push(chunk))
    child.on('error', (error) =>
      rejectOutcome(new Error(`hearthkit create could not spawn pnpm: ${error.message}`)),
    )
    child.on('close', (code, signal) => {
      if (code === null) {
        rejectOutcome(
          new Error(
            `hearthkit create expected pnpm install to exit, it was killed by ${String(signal)}`,
          ),
        )
        return
      }
      resolveOutcome({ exitCode: code, combinedOutput: outputChunks.join('') })
    })
  })
}

// pnpm reports a resolution failure on STDOUT rather than stderr, so an excerpt taken from the error
// stream alone is routinely empty and tells a user nothing.
/** The tail of a failing pnpm run's combined output, never empty, so the failure always says something. */
function installOutputExcerptOf(combinedOutput: string): string {
  const trimmed = combinedOutput.trim()
  return trimmed === ''
    ? 'pnpm install produced no output'
    : trimmed.slice(-installOutputExcerptLimit)
}

/** The database name `hearthkit db create` is given: the project name with every hyphen turned into an underscore. */
export function projectDatabaseNameFor(projectName: string): string {
  return projectName.replaceAll('-', '_')
}

/** Runs the commands step six lists, stopping at the first failure and reporting what did complete. */
export async function runScaffoldCommands(
  options: RunScaffoldCommandsOptions,
): Promise<ScaffoldCommandsOutcome> {
  const commandsRun: CreateCommandRecord[] = []

  if (options.install) {
    const install = await runProjectInstall(options.projectDirectoryPath)
    if (install.exitCode !== 0) {
      return {
        kind: 'scaffold-command-failed',
        commandsRun,
        failure: createInstallFailedFailure({
          installExitCode: install.exitCode,
          installOutputExcerpt: installOutputExcerptOf(install.combinedOutput),
        }),
      }
    }
    commandsRun.push({ commandName: 'pnpm install' })
  }

  if (!options.startInfra) {
    return { kind: 'scaffold-commands-completed', commandsRun }
  }

  if (options.infraServices.length > 0) {
    const infraUp = await runHearthkitCli({
      argv: ['dev', 'infra', 'up'],
      cwd: options.projectDirectoryPath,
    })
    if (infraUp.result.kind !== 'dev-infra-up-succeeded') {
      return {
        kind: 'scaffold-command-failed',
        commandsRun,
        failure: createInfraUpFailedFailure({
          failedCommand: 'hearthkit dev infra up',
          cliFailure: cliFailureSchema.parse(infraUp.result),
        }),
      }
    }
    commandsRun.push({
      commandName: 'hearthkit dev infra up',
      startedInfraServices: infraUp.result.startedInfraServices,
    })
  }

  if (!options.createsDatabase) {
    return { kind: 'scaffold-commands-completed', commandsRun }
  }

  const databaseCreate = await runHearthkitCli({
    argv: ['db', 'create', projectDatabaseNameFor(options.projectName)],
    cwd: options.projectDirectoryPath,
  })
  if (databaseCreate.result.kind !== 'db-create-command-succeeded') {
    return {
      kind: 'scaffold-command-failed',
      commandsRun,
      failure: createInfraUpFailedFailure({
        failedCommand: 'hearthkit db create',
        cliFailure: cliFailureSchema.parse(databaseCreate.result),
      }),
    }
  }
  commandsRun.push({
    commandName: 'hearthkit db create',
    projectDatabaseName: databaseCreate.result.projectDatabaseName,
    connectionString: databaseCreate.result.connectionString,
  })

  return { kind: 'scaffold-commands-completed', commandsRun }
}
