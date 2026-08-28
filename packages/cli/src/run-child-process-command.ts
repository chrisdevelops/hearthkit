import { spawn } from 'node:child_process'
import { writeStandardErrorChunk } from './cli-output-streams.js'
import type { CliRuntimeContext } from './cli-runtime-context.js'

/**
 * What spawning one external command produced. A binary that is not on PATH is an outcome rather
 * than an exception, because "docker is not installed" is a named failure mode of this package.
 */
export type ChildProcessOutcome =
  | {
      kind: 'child-process-exited'
      exitCode: number
      standardOutput: string
      standardError: string
    }
  | { kind: 'child-process-not-on-path' }

/** How to run one external command; the binary is named bare so the context's PATH decides which one runs. */
export type ChildProcessCommandOptions = {
  commandName: string
  commandArguments: readonly string[]
  context: CliRuntimeContext
  forwardStandardError?: boolean
  timeoutMilliseconds?: number
}

/** Long enough for docker to pull an image over a slow link, short enough that a wedged daemon still returns. */
const defaultChildProcessTimeoutMilliseconds = 600_000

/**
 * Spawns one external command with the caller's working directory and environment, so PATH lookup
 * happens against the environment the CLI was given rather than the one this process was started in.
 * Never rejects: a missing binary and a nonzero exit are both outcomes.
 */
export async function runChildProcessCommand(
  options: ChildProcessCommandOptions,
): Promise<ChildProcessOutcome> {
  return new Promise<ChildProcessOutcome>((resolve) => {
    const child = spawn(options.commandName, [...options.commandArguments], {
      cwd: options.context.workingDirectoryPath,
      env: options.context.environmentVariables,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMilliseconds ?? defaultChildProcessTimeoutMilliseconds,
    })

    const standardOutputChunks: string[] = []
    const standardErrorChunks: string[] = []
    let settled = false

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => standardOutputChunks.push(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      standardErrorChunks.push(chunk)
      if (options.forwardStandardError === true) {
        writeStandardErrorChunk(chunk)
      }
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) {
        return
      }
      settled = true
      if (error.code === 'ENOENT') {
        resolve({ kind: 'child-process-not-on-path' })
        return
      }
      resolve({
        kind: 'child-process-exited',
        exitCode: 1,
        standardOutput: standardOutputChunks.join(''),
        standardError: `${standardErrorChunks.join('')}${error.message}`,
      })
    })

    child.on('close', (exitCode) => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        kind: 'child-process-exited',
        exitCode: exitCode ?? 1,
        standardOutput: standardOutputChunks.join(''),
        standardError: standardErrorChunks.join(''),
      })
    })
  })
}
