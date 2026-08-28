import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants as fileSystemConstants } from 'node:fs'
import { constants as osConstants } from 'node:os'
import { join } from 'node:path'
import { cliDevInfraUpCompleteLinePrefix, type CliCommandResult } from './cli-contract.ts'
import { nextDevUnavailableFailure } from './cli-failure-results.ts'
import { writeStandardErrorLine } from './cli-output-streams.ts'
import type { CliRuntimeContext } from './cli-runtime-context.ts'
import { runDevInfraUpCommand } from './run-dev-infra-command.ts'

/** The project's own Next.js binary; hearthkit never installs or bundles one of its own. */
const projectNextBinaryRelativePath = join('node_modules', '.bin', 'next')

/** The exit code range a process may report; a child killed by a signal is folded into it as 128 + signal. */
const maximumProcessExitCode = 255

/** How the next dev child ended, or why it could not be started at all. */
type NextDevOutcome =
  | { kind: 'next-dev-exited'; nextDevExitCode: number }
  | { kind: 'next-dev-not-spawnable'; detail: string }

/**
 * Brings local infra up and then hands the terminal to the project's own next dev, whose stdio is
 * inherited rather than captured so Next's interactive output behaves exactly as it does directly.
 * The command's exit code is the child's, which is why it is not always 0, 1, or 2.
 */
export async function runDevCommand(context: CliRuntimeContext): Promise<CliCommandResult> {
  const infraResult = await runDevInfraUpCommand(context)
  if (infraResult.kind !== 'dev-infra-up-succeeded') {
    return infraResult
  }

  // Progress, not machine-readable output: stdout belongs to next dev from here on.
  writeStandardErrorLine(
    `${cliDevInfraUpCompleteLinePrefix} ${describeStartedServices(infraResult.startedInfraServices)}`,
  )

  const nextBinaryPath = join(context.workingDirectoryPath, projectNextBinaryRelativePath)
  try {
    await access(nextBinaryPath, fileSystemConstants.X_OK)
  } catch {
    return nextDevUnavailableFailure(
      `no runnable next binary at ${nextBinaryPath}; install next in this project first`,
    )
  }

  const outcome = await runNextDevProcess(nextBinaryPath, context)
  if (outcome.kind === 'next-dev-not-spawnable') {
    return nextDevUnavailableFailure(`${nextBinaryPath} could not be started (${outcome.detail})`)
  }

  return { kind: 'dev-command-exited', nextDevExitCode: outcome.nextDevExitCode }
}

/** Names the started services for the progress line, or says plainly that none were needed. */
function describeStartedServices(startedInfraServices: readonly string[]): string {
  return startedInfraServices.length === 0
    ? 'no local infra services needed'
    : `started ${startedInfraServices.join(', ')}`
}

/** Runs next dev to completion with inherited stdio and reports the code the shell would have seen. */
async function runNextDevProcess(
  nextBinaryPath: string,
  context: CliRuntimeContext,
): Promise<NextDevOutcome> {
  return new Promise<NextDevOutcome>((resolve) => {
    const child = spawn(nextBinaryPath, ['dev'], {
      cwd: context.workingDirectoryPath,
      env: context.environmentVariables,
      stdio: 'inherit',
    })

    let settled = false

    child.on('error', (error: Error) => {
      if (settled) {
        return
      }
      settled = true
      resolve({ kind: 'next-dev-not-spawnable', detail: error.message })
    })

    child.on('close', (exitCode, signal) => {
      if (settled) {
        return
      }
      settled = true
      resolve({ kind: 'next-dev-exited', nextDevExitCode: readChildExitCode(exitCode, signal) })
    })
  })
}

/** Folds an exit code or terminating signal into the 0 to 255 range the contract allows. */
function readChildExitCode(exitCode: number | null, signal: NodeJS.Signals | null): number {
  if (exitCode !== null) {
    return Math.min(maximumProcessExitCode, Math.max(0, exitCode))
  }
  if (signal !== null) {
    return Math.min(maximumProcessExitCode, 128 + (osConstants.signals[signal] ?? 0))
  }
  return 1
}
