import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const runCommand = promisify(execFile)

/** Throwaway directory for one gate file's archives; the caller removes it in afterAll. */
export async function createBackupGateDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'hearthkit-db-gate-'))
}

/** Removes a gate directory and everything in it; safe when the directory was never created. */
export async function removeBackupGateDirectory(directoryPath: string): Promise<void> {
  await rm(directoryPath, { recursive: true, force: true })
}

/** An archive path two directory levels deeper than anything that exists, so backup has to create the parents. */
export function unwrittenArchivePath(directoryPath: string): string {
  return join(directoryPath, `archives-${randomUUID().slice(0, 8)}`, 'nested', 'project.dump')
}

/** An archive path whose parent is a regular file, which no amount of mkdir can turn into a directory. */
export async function archivePathBlockedByAFile(directoryPath: string): Promise<string> {
  const blockingFilePath = join(directoryPath, `blocking-file-${randomUUID().slice(0, 8)}`)
  await writeFile(blockingFilePath, 'this file stands where a directory would have to go')
  return join(blockingFilePath, 'project.dump')
}

/** A readable file that is not a pg_dump custom-format archive. */
export async function invalidArchiveFilePath(directoryPath: string): Promise<string> {
  const filePath = join(directoryPath, `not-an-archive-${randomUUID().slice(0, 8)}.dump`)
  // Deliberately does not start with the PGDMP magic bytes of a custom-format archive.
  await writeFile(filePath, 'this file is a note to self, not a database archive\n')
  return filePath
}

/**
 * Writes a real custom-format archive with the host's own pg_dump, so a restore gate can start from
 * a file that is definitely valid without depending on backupProjectDatabase having been called.
 */
export async function writeGateArchiveWithPgDump(
  connectionString: string,
  directoryPath: string,
): Promise<string> {
  const filePath = join(directoryPath, `valid-archive-${randomUUID().slice(0, 8)}.dump`)
  await mkdir(dirname(filePath), { recursive: true })
  await runCommand('pg_dump', ['--format=custom', `--file=${filePath}`, connectionString])
  return filePath
}

/** A path inside an existing directory where no file was ever written. */
export function absentArchiveFilePath(directoryPath: string): string {
  return join(directoryPath, `archive-that-was-never-written-${randomUUID().slice(0, 8)}.dump`)
}

/**
 * An empty directory used as the whole PATH, so a spawned pg_dump or pg_restore cannot be found.
 * The contract resolves both tools from PATH, so this is the only honest way to force the failure.
 */
export async function emptyPathDirectory(directoryPath: string): Promise<string> {
  const emptyDirectoryPath = join(directoryPath, `no-postgres-tools-${randomUUID().slice(0, 8)}`)
  await mkdir(emptyDirectoryPath, { recursive: true })
  return emptyDirectoryPath
}

/** Runs the callback with PATH pointing at a directory holding no Postgres client binaries, then puts PATH back. */
export async function withoutPostgresToolsOnPath<TResult>(
  emptyDirectoryPath: string,
  run: () => Promise<TResult>,
): Promise<TResult> {
  const originalPath = process.env.PATH
  process.env.PATH = emptyDirectoryPath
  try {
    return await run()
  } finally {
    if (originalPath === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = originalPath
    }
  }
}
