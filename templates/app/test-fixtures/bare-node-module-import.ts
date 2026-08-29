import { spawnSync } from 'node:child_process'

/**
 * Runs a real `node` child process that imports one module specifier and prints one named export.
 *
 * Like the other fixtures here, nothing in this file imports from src/, so the pruning invariant the
 * tree gate checks stays true; the gate passes every value in.
 *
 * Vitest cannot answer this question in process: Vite transforms `.tsx` happily, so the extension
 * rule that decides whether `verify:container` can read its own contract is invisible inside the
 * runner. Only a spawned `node`, resolving through the template's own node_modules, exercises it.
 */

/** Milliseconds the child gets before it is killed; a clean import of a contract file takes a fraction of a second. */
const bareNodeImportTimeoutMs = 20_000

/** What the child process produced; a spawn failure arrives as a nonzero exit code, never as a throw. */
export type BareNodeImportResult = {
  exitCode: number
  stdout: string
  stderr: string
}

/** Which specifier to import, which export to print, and the directory Node resolves the specifier from. */
export type BareNodeImportOptions = {
  moduleSpecifier: string
  exportName: string
  workingDirectoryPath: string
}

/**
 * Imports one specifier from bare `node` and returns what it printed. It never throws, so a gate can
 * assert on the exit code and put the child's stderr into its own failure message: an
 * ERR_UNKNOWN_FILE_EXTENSION, an ERR_PACKAGE_PATH_NOT_EXPORTED and a failed package resolution are
 * three different diagnoses that a bare exit code tells the reader nothing about.
 */
export function runBareNodeImport(options: BareNodeImportOptions): BareNodeImportResult {
  const childScript = [
    `const moduleNamespace = await import(${JSON.stringify(options.moduleSpecifier)})`,
    `process.stdout.write(String(moduleNamespace[${JSON.stringify(options.exportName)}]))`,
  ].join('\n')

  // NODE_OPTIONS is dropped so a loader or flag set for the parent test run cannot decide the
  // answer. The question is what plain `node` does with no help, which is how verify:container runs.
  const childEnvironment = { ...process.env }
  delete childEnvironment.NODE_OPTIONS

  const finished = spawnSync(process.execPath, ['--input-type=module', '--eval', childScript], {
    cwd: options.workingDirectoryPath,
    env: childEnvironment,
    encoding: 'utf8',
    timeout: bareNodeImportTimeoutMs,
  })

  const spawnErrorMessage = finished.error === undefined ? '' : `${finished.error.message}\n`
  return {
    exitCode: finished.status ?? 1,
    stdout: finished.stdout ?? '',
    stderr: `${finished.stderr ?? ''}${spawnErrorMessage}`,
  }
}
