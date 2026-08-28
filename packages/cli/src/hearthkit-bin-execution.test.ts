import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  createGateDirectory,
  gateEnvironment,
  removeGateDirectory,
} from '../test-fixtures/gate-project-directories.ts'
import { cliDevInfraDownCompleteLinePrefix, cliUsageErrorPrefix } from './cli-contract.ts'

const packageDirectoryPath = dirname(dirname(fileURLToPath(import.meta.url)))
const directoriesToRemove: string[] = []

afterAll(async () => {
  for (const directoryPath of directoriesToRemove) {
    await removeGateDirectory(directoryPath)
  }
})

/**
 * The path package.json advertises as the hearthkit binary, resolved from the bin field rather than
 * hardcoded, so this gate fails when the bin wiring drifts instead of testing a file nobody installs.
 */
async function resolveAdvertisedBinPath(): Promise<string> {
  const manifest: unknown = JSON.parse(
    await readFile(resolve(packageDirectoryPath, 'package.json'), 'utf8'),
  )
  const binField =
    typeof manifest === 'object' && manifest !== null && 'bin' in manifest
      ? manifest.bin
      : undefined
  const advertisedBinEntry =
    typeof binField === 'object' && binField !== null && 'hearthkit' in binField
      ? binField.hearthkit
      : undefined
  if (typeof advertisedBinEntry !== 'string') {
    throw new Error(
      `gate expected packages/cli/package.json to declare bin.hearthkit as a path string, received ${JSON.stringify(binField)}`,
    )
  }
  const binPath = resolve(packageDirectoryPath, advertisedBinEntry)
  await access(binPath, constants.X_OK).catch(() => {
    throw new Error(
      `gate expected the advertised bin ${advertisedBinEntry} to exist and be executable at ${binPath}`,
    )
  })
  return binPath
}

/** Runs one command as a real child process and reports only what an operator sees: exit code and the two streams. */
async function spawnCliProcess(options: {
  command: string
  commandArguments: string[]
  cwd: string
}): Promise<{ exitCode: number; standardOutput: string; standardError: string }> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(options.command, options.commandArguments, {
      cwd: options.cwd,
      env: gateEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const standardOutputChunks: string[] = []
    const standardErrorChunks: string[] = []
    child.stdout.on('data', (chunk: Buffer) => standardOutputChunks.push(chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => standardErrorChunks.push(chunk.toString('utf8')))
    child.on('error', (error) =>
      rejectResult(
        new Error(`gate could not spawn ${options.command}: ${error.message}`, { cause: error }),
      ),
    )
    child.on('close', (code, signal) => {
      if (code === null) {
        rejectResult(new Error(`gate expected an exit code, the process was killed by ${signal}`))
        return
      }
      resolveResult({
        exitCode: code,
        standardOutput: standardOutputChunks.join(''),
        standardError: standardErrorChunks.join(''),
      })
    })
  })
}

/** The non-empty lines of a stream, so a gate can name the one line it expects without matching whitespace. */
function nonEmptyLines(streamText: string): string[] {
  return streamText.split('\n').filter((line) => line.trim().length > 0)
}

// These two gates are the only place the binary itself is exercised: every other CLI gate calls
// runHearthkitCli in process, which cannot catch a broken bin field, a missing executable bit or an
// exit code the wrapper failed to propagate.
describe('the hearthkit binary as a child process', () => {
  it('runs through its own shebang and exits 0 on the dev infra down no-op', async () => {
    const binPath = await resolveAdvertisedBinPath()
    const directoryPath = await createGateDirectory('bin-exit-zero')
    directoriesToRemove.push(directoryPath)

    // Executed directly, with no interpreter in front of it: this holds the shebang and the
    // executable bit, which is what makes the file runnable once a package manager links it.
    const run = await spawnCliProcess({
      command: binPath,
      commandArguments: ['dev', 'infra', 'down'],
      cwd: directoryPath,
    })

    expect(run.exitCode).toBe(0)
    expect(nonEmptyLines(run.standardError)).toEqual([])
    const printedLines = nonEmptyLines(run.standardOutput)
    expect(printedLines).toHaveLength(1)
    expect(printedLines[0]?.startsWith(cliDevInfraDownCompleteLinePrefix)).toBe(true)
  })

  it('exits 2 with the usage prefix on stderr when the command path is unknown', async () => {
    const binPath = await resolveAdvertisedBinPath()
    const directoryPath = await createGateDirectory('bin-exit-two')
    directoriesToRemove.push(directoryPath)

    // Invoked as node <bin>, the way a package manager bin shim reads the shebang and calls the
    // interpreter, so both entry routes into the same wrapper are covered by this file.
    const run = await spawnCliProcess({
      command: process.execPath,
      commandArguments: [binPath, 'db', 'frobnicate'],
      cwd: directoryPath,
    })

    expect(run.exitCode).toBe(2)
    expect(nonEmptyLines(run.standardOutput)).toEqual([])
    const reportedLines = nonEmptyLines(run.standardError)
    const lastReportedLine = reportedLines.at(-1)
    expect(lastReportedLine?.startsWith(cliUsageErrorPrefix)).toBe(true)
  })
})
