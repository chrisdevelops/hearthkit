import { spawn } from 'node:child_process'

/**
 * Child-process helper for `verify:container`. Nothing here is app code: it is pruned with the rest
 * of `src/` before a project is generated.
 */

/** What a finished child process produced; a spawn failure comes back as exit code 127, never as a throw. */
export type VerifyCommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

/** How to run one child process; output is always captured and optionally mirrored to this process. */
export type VerifyCommandOptions = {
  command: string
  commandArguments: readonly string[]
  workingDirectoryPath: string
  extraEnvironment?: Readonly<Record<string, string>>
  streamOutput?: boolean
}

/** Runs one command to completion, capturing stdout and stderr; it never throws, the exit code is the result. */
export function runVerifyCommand(options: VerifyCommandOptions): Promise<VerifyCommandResult> {
  return new Promise<VerifyCommandResult>((resolve) => {
    const child = spawn(options.command, [...options.commandArguments], {
      cwd: options.workingDirectoryPath,
      env: { ...process.env, ...options.extraEnvironment },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      if (options.streamOutput === true) {
        process.stdout.write(chunk)
      }
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      if (options.streamOutput === true) {
        process.stderr.write(chunk)
      }
    })

    child.on('error', (error: Error) => {
      resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.message}\n` })
    })

    child.on('close', (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr })
    })
  })
}

/** The last non-empty line of some captured output, trimmed and length-bounded so it stays one line. */
export function lastOutputLine(capturedOutput: string, maximumLength = 200): string {
  const lines = capturedOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const lastLine = lines.at(-1) ?? ''
  return lastLine.length > maximumLength ? `${lastLine.slice(0, maximumLength)}…` : lastLine
}
