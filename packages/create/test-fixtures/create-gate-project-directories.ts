import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { chmod, mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type * as HearthkitCreateModule from '../src/create-contract.ts'
import type {
  DecideTemplatePathPrune,
  PruneOptionalSectionBlocks,
} from './create-gate-template-manifest.ts'

/**
 * Throwaway directories, unique names, the child-process helpers and the one loader every gate goes
 * through. Nothing here writes inside the repo: a gate that scaffolded into packages/create would
 * leave a tree behind that `git status` reports and that the next run would refuse as not empty.
 */

/** Absolute path of packages/create, resolved from this file so nothing hardcodes a repo location. */
export const createPackageDirectoryPath = fileURLToPath(new URL('..', import.meta.url))

/**
 * Where every gate directory is written. os.tmpdir() by default, which is outside the repo on every
 * platform; HEARTHKIT_CREATE_GATE_ROOT redirects it at a session scratchpad without editing a gate.
 */
export const createGateRootPath = process.env.HEARTHKIT_CREATE_GATE_ROOT ?? tmpdir()

/** A throwaway directory outside the repo, resolved through realpath so macOS /var symlinks never break a path assertion. */
export async function createGateDirectory(purpose: string): Promise<string> {
  const created = await mkdtemp(join(createGateRootPath, `hearthkit-create-gate-${purpose}-`))
  return realpath(created)
}

/** Removes a gate directory and everything under it; safe to call on a path that was never created. */
export async function removeGateDirectory(directoryPath: string): Promise<void> {
  await chmod(directoryPath, 0o700).catch(() => undefined)
  await rm(directoryPath, { recursive: true, force: true })
}

/**
 * A project name unique to this run, already in the shape hearthkitProjectNameSchema accepts.
 *
 * Unique per run because two runs of the same gate must not collide on a compose project name, a
 * database name or a Stripe object name, and because a repeated run has to be able to start from a
 * directory that does not exist yet.
 */
export function uniqueGateProjectName(purpose: string): string {
  return `hk-create-${purpose}-${randomUUID().replaceAll('-', '').slice(0, 8)}`
}

/** A TCP port nothing is listening on right now, taken by binding port 0 and releasing it. */
export async function reserveFreeTcpPort(): Promise<number> {
  return new Promise<number>((resolvePort, rejectPort) => {
    const probe = createServer()
    probe.on('error', rejectPort)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => rejectPort(new Error('gate could not read a reserved TCP port')))
        return
      }
      const { port } = address
      probe.close(() => resolvePort(port))
    })
  })
}

/**
 * Runs a callback with process.env patched, restoring every key afterwards even when the callback
 * throws. create reads no variable of its own, but the hearthkit commands it runs read the
 * environment of the process it runs in, so this is how a gate makes one of them fail.
 */
export async function withEnvironmentVariables<TResult>(
  overrides: Record<string, string | undefined>,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const previousValues = new Map<string, string | undefined>()
  for (const [variableName, value] of Object.entries(overrides)) {
    previousValues.set(variableName, process.env[variableName])
    if (value === undefined) {
      delete process.env[variableName]
    } else {
      process.env[variableName] = value
    }
  }
  try {
    return await run()
  } finally {
    for (const [variableName, value] of previousValues) {
      if (value === undefined) {
        delete process.env[variableName]
      } else {
        process.env[variableName] = value
      }
    }
  }
}

/**
 * A DOCKER_HOST no daemon answers on, so `docker info` exits nonzero within milliseconds.
 *
 * The port is reserved and released first, so it is a port that is genuinely closed on this machine
 * rather than a number chosen by hand that something else may have bound.
 */
export async function closedDockerHostAddress(): Promise<string> {
  return `tcp://127.0.0.1:${String(await reserveFreeTcpPort())}`
}

/** Every file under a directory as sorted POSIX relative paths, skipping the install and build output a gate never asserts on. */
export async function listProjectFilePaths(projectDirectoryPath: string): Promise<string[]> {
  const skippedDirectoryNames = new Set(['node_modules', '.next', '.git', 'hearthkit-packages'])
  const found: string[] = []

  const walk = async (absoluteDirectoryPath: string, relativePrefix: string): Promise<void> => {
    for (const entry of await readdir(absoluteDirectoryPath, { withFileTypes: true })) {
      const relativePath = relativePrefix === '' ? entry.name : `${relativePrefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (!skippedDirectoryNames.has(entry.name)) {
          await walk(join(absoluteDirectoryPath, entry.name), relativePath)
        }
        continue
      }
      if (entry.isFile()) {
        found.push(relativePath)
      }
    }
  }

  await walk(projectDirectoryPath, '')
  return found.toSorted()
}

/** Text of a file inside a scaffolded project; throws naming the path so a missing file reads as itself. */
export async function readProjectFileText(
  projectDirectoryPath: string,
  projectRelativePath: string,
): Promise<string> {
  try {
    return await readFile(join(projectDirectoryPath, ...projectRelativePath.split('/')), 'utf8')
  } catch (error) {
    throw new Error(
      `gate could not read ${projectRelativePath} in the scaffolded project at ${projectDirectoryPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/** Parsed package.json of a scaffolded project, as a plain record a gate can index. */
export async function readProjectManifest(
  projectDirectoryPath: string,
): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(
    await readProjectFileText(projectDirectoryPath, 'package.json'),
  )
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`gate expected ${projectDirectoryPath}/package.json to hold a JSON object`)
  }
  return { ...parsed }
}

/** The string-valued entries of one manifest section, for scripts and the two dependency maps. */
export function manifestSectionOf(
  manifest: Record<string, unknown>,
  sectionName: 'scripts' | 'dependencies' | 'devDependencies',
): Record<string, string> {
  const section = manifest[sectionName]
  const stringEntries: Record<string, string> = {}
  if (typeof section === 'object' && section !== null && !Array.isArray(section)) {
    for (const [entryName, entryValue] of Object.entries(section)) {
      if (typeof entryValue === 'string') {
        stringEntries[entryName] = entryValue
      }
    }
  }
  return stringEntries
}

/** What running one external command produced; a gate asserts on the exit code and the two streams only. */
export type GateProcessOutcome = {
  exitCode: number
  standardOutput: string
  standardError: string
}

/** Runs one command to completion, optionally writing to its stdin, and never rejects on a nonzero exit. */
export async function runGateCommand(options: {
  command: string
  commandArguments: readonly string[]
  workingDirectoryPath: string
  environmentOverrides?: Record<string, string | undefined>
  standardInputText?: string
  streamOutput?: boolean
}): Promise<GateProcessOutcome> {
  return new Promise<GateProcessOutcome>((resolveOutcome, rejectOutcome) => {
    const child = spawn(options.command, [...options.commandArguments], {
      cwd: options.workingDirectoryPath,
      env: { ...process.env, ...options.environmentOverrides },
      stdio: [options.standardInputText === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    })

    const standardOutputChunks: string[] = []
    const standardErrorChunks: string[] = []
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      standardOutputChunks.push(chunk)
      if (options.streamOutput === true) {
        process.stdout.write(chunk)
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      standardErrorChunks.push(chunk)
      if (options.streamOutput === true) {
        process.stderr.write(chunk)
      }
    })

    if (options.standardInputText !== undefined && child.stdin !== null) {
      child.stdin.end(options.standardInputText, 'utf8')
    }

    child.on('error', (error) =>
      rejectOutcome(
        new Error(`gate could not spawn ${options.command}: ${error.message}`, { cause: error }),
      ),
    )
    child.on('close', (code, signal) => {
      if (code === null) {
        rejectOutcome(
          new Error(
            `gate expected ${options.command} to exit, it was killed by ${String(signal)}: ${standardErrorChunks.join('')}`,
          ),
        )
        return
      }
      resolveOutcome({
        exitCode: code,
        standardOutput: standardOutputChunks.join(''),
        standardError: standardErrorChunks.join(''),
      })
    })
  })
}

/**
 * The path package.json advertises as this package's binary, read from the manifest rather than
 * hardcoded so the gate fails when the bin wiring drifts instead of running a file nobody installs.
 *
 * `npm init @hearthkit` runs `npm exec @hearthkit/create`, which runs the package's single bin
 * whatever it is called, so a string bin and a one-entry object bin are both accepted.
 */
export async function resolveAdvertisedCreateBinPath(): Promise<string> {
  const manifestPath = join(createPackageDirectoryPath, 'package.json')
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `gate could not read ${manifestPath} (packages/create has no package.json yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const binField =
    typeof manifest === 'object' && manifest !== null && 'bin' in manifest
      ? (manifest as { bin?: unknown }).bin
      : undefined

  const advertisedBinEntries =
    typeof binField === 'string'
      ? [binField]
      : typeof binField === 'object' && binField !== null
        ? Object.values(binField as Record<string, unknown>).filter(
            (entry): entry is string => typeof entry === 'string',
          )
        : []

  const [advertisedBinEntry] = advertisedBinEntries
  if (advertisedBinEntries.length !== 1 || advertisedBinEntry === undefined) {
    throw new Error(
      `gate expected packages/create/package.json to declare exactly one bin path, received ${JSON.stringify(binField)}`,
    )
  }
  return join(createPackageDirectoryPath, ...advertisedBinEntry.split('/'))
}

/**
 * The public surface of @hearthkit/create a gate is allowed to touch: the three functions plus
 * everything index.ts re-exports from the contract.
 *
 * The two pruning functions carry the signature types the template manifest declares, because
 * create re-exports the template's own pruning contract rather than restating it.
 */
export type HearthkitCreateEntry = typeof HearthkitCreateModule & {
  createHearthkitProject: HearthkitCreateModule.CreateHearthkitProject
  decideTemplatePathPrune: DecideTemplatePathPrune
  pruneOptionalSectionBlocks: PruneOptionalSectionBlocks
}

/**
 * Loads @hearthkit/create through its public entry point at call time.
 *
 * At call time rather than at the top of a gate file so a package with no `src/index.ts` yet fails
 * one gate at a time, naming what is missing, instead of breaking collection for the whole file.
 */
export async function loadHearthkitCreateEntry(): Promise<HearthkitCreateEntry> {
  let loaded: unknown
  try {
    loaded = await import('@hearthkit/create')
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/create (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const namespace = loaded as Partial<Record<string, unknown>>
  const missingExportNames = [
    'createHearthkitProject',
    'createFailureSchema',
    'hearthkitProjectCreatedSchema',
    'decideTemplatePathPrune',
    'pruneOptionalSectionBlocks',
  ].filter((exportName) => namespace[exportName] === undefined)
  if (missingExportNames.length > 0) {
    throw new Error(
      `gate expected @hearthkit/create to export ${missingExportNames.join(', ')} by name from src/index.ts`,
    )
  }

  return namespace as unknown as HearthkitCreateEntry
}

/** The message of whatever the callback threw, for the gates that assert on a thrown template defect rather than a CreateFailure. */
export function messageOfThrownFrom(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error('gate expected the call to throw, it returned normally')
}

/**
 * The success shape, parsed through the contract schema, or a thrown error carrying the failure's
 * own message. A gate that expected a scaffold and got a CreateFailure should read as that failure,
 * not as a Zod union mismatch listing seven variants.
 */
export function expectHearthkitProjectCreated(
  entry: HearthkitCreateEntry,
  result: HearthkitCreateModule.CreateHearthkitProjectResult,
): HearthkitCreateModule.HearthkitProjectCreated {
  if (result.kind !== 'hearthkit-project-created') {
    throw new Error(`gate expected a scaffolded project, create returned ${result.message}`)
  }
  return entry.hearthkitProjectCreatedSchema.parse(result)
}
