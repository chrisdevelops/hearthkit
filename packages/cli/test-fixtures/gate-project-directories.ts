import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A throwaway working directory outside the repo, resolved through realpath so macOS /var symlinks never break a path assertion. */
export async function createGateDirectory(purpose: string): Promise<string> {
  const created = await mkdtemp(join(tmpdir(), `hearthkit-cli-gate-${purpose}-`))
  return realpath(created)
}

/** Removes a gate directory, restoring write permission first so the read-only compose gate can still clean up. */
export async function removeGateDirectory(directoryPath: string): Promise<void> {
  await chmod(directoryPath, 0o700).catch(() => undefined)
  await rm(directoryPath, { recursive: true, force: true })
}

/** Compose project name unique to this run, already in the lowercase kebab shape hearthkitProjectNameSchema accepts. */
export function uniqueGateProjectName(purpose: string): string {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8)
  return `hearthkit-gate-${purpose}-${suffix}`
}

/**
 * Writes the ./package.json the CLI reads to decide which local infra services a project needs.
 * The manifest name may carry a scope so a gate can check the scope is stripped from compose names.
 */
export async function writeGateProjectManifest(options: {
  directoryPath: string
  manifestName: string
  hearthkitDependencies?: string[]
}): Promise<string> {
  const dependencies = Object.fromEntries(
    (options.hearthkitDependencies ?? []).map((packageName) => [packageName, 'workspace:*']),
  )
  const manifestPath = join(options.directoryPath, 'package.json')
  await writeFile(
    manifestPath,
    `${JSON.stringify({ name: options.manifestName, version: '0.0.0', private: true, dependencies }, null, 2)}\n`,
    'utf8',
  )
  return manifestPath
}

/** Writes a docker-compose.yml the CLI must treat as the user's own file and never overwrite. */
export async function writeGateComposeFile(
  directoryPath: string,
  composeFileContent: string,
): Promise<string> {
  const composeFilePath = join(directoryPath, 'docker-compose.yml')
  await writeFile(composeFilePath, composeFileContent, 'utf8')
  return composeFilePath
}

/**
 * A hand-written compose file with no published host ports, so it can run beside the generated one.
 * The container name is fixed by the caller so the gate can remove exactly what it started.
 */
export function existingComposeFileContent(containerName: string): string {
  return [
    'services:',
    '  mailpit:',
    '    image: axllent/mailpit:v1.31',
    `    container_name: ${containerName}`,
    '',
  ].join('\n')
}

/** A compose file docker compose rejects offline: the build context does not exist, so up exits nonzero at once. */
export const unbuildableComposeFileContent = [
  'services:',
  '  gate-broken:',
  '    build:',
  '      context: ./gate-context-that-does-not-exist',
  '',
].join('\n')

/**
 * A stand-in for the project's own next binary at node_modules/.bin/next: it records the arguments
 * it was given and exits with a chosen code, so a dev gate proves the exec and the exit code
 * without installing Next.js. It is a fake binary, never a mock of hearthkit code.
 */
export async function writeFakeNextBinary(options: {
  directoryPath: string
  exitCode: number
}): Promise<{ binaryPath: string; markerFilePath: string }> {
  const binDirectoryPath = join(options.directoryPath, 'node_modules', '.bin')
  await mkdir(binDirectoryPath, { recursive: true })
  const binaryPath = join(binDirectoryPath, 'next')
  const markerFilePath = join(options.directoryPath, 'gate-fake-next-arguments.txt')
  await writeFile(
    binaryPath,
    [
      '#!/bin/sh',
      'printf "gate fake next started with: %s\\n" "$*"',
      `printf '%s' "$*" > '${markerFilePath}'`,
      `exit ${options.exitCode}`,
      '',
    ].join('\n'),
    'utf8',
  )
  await chmod(binaryPath, 0o755)
  return { binaryPath, markerFilePath }
}

/** Drops write permission so the CLI cannot create docker-compose.yml in this directory; package.json stays readable. */
export async function makeGateDirectoryReadOnly(directoryPath: string): Promise<void> {
  await chmod(directoryPath, 0o500)
}

/** An empty directory to use as the whole PATH, so no docker executable can be found on it. */
export async function createEmptyPathDirectory(): Promise<string> {
  return createGateDirectory('empty-path')
}

/**
 * The environment a gate hands to runHearthkitCli: the real environment with both CLI variables
 * removed, so every gate states the admin and database URL resolution it is exercising.
 */
export function gateEnvironment(
  overrides: Record<string, string> = {},
): Record<string, string | undefined> {
  const environment: Record<string, string | undefined> = { ...process.env }
  delete environment.HEARTHKIT_ADMIN_DATABASE_URL
  delete environment.DATABASE_URL
  return { ...environment, ...overrides }
}

/**
 * Runs the callback with process.env.PATH replaced as well as the env option, so the gate holds
 * whether the CLI resolves the docker executable from its env argument or from the process.
 */
export async function withPathReplaced<TResult>(
  replacementPath: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const originalPath = process.env.PATH
  process.env.PATH = replacementPath
  try {
    return await run()
  } finally {
    process.env.PATH = originalPath
  }
}
