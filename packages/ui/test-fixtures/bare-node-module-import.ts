import { spawnSync } from 'node:child_process'

/**
 * Runs a real `node` child process that imports one module specifier and prints one named export.
 *
 * Vitest cannot answer this question in process. Vite transforms `.tsx` happily, so the extension
 * rule that keeps the `@hearthkit/ui` entry out of bare Node is invisible here, and an in-process
 * import resolves through Vite rather than through Node's own loader. This package's
 * vitest.config.ts anchors the '@hearthkit/ui' alias, so '@hearthkit/ui/ui-contract' does reach the
 * exports map in process and a gate can compare the subpath's exports there; only a spawned `node`
 * shows whether plain Node can execute what it finds.
 *
 * Node resolves the specifier from the child's working directory. A package whose manifest carries
 * both "name" and "exports" can be imported by its own name from inside itself (Node's
 * self-referencing rule), so a gate can run the child at its own package root and still import the
 * package the way a consumer would, without depending on another package's node_modules.
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
 * ERR_UNKNOWN_FILE_EXTENSION, an ERR_PACKAGE_PATH_NOT_EXPORTED and a failed zod resolution are three
 * different diagnoses that a bare exit code tells the reader nothing about.
 */
export function runBareNodeImport(options: BareNodeImportOptions): BareNodeImportResult {
  const childScript = [
    `const moduleNamespace = await import(${JSON.stringify(options.moduleSpecifier)})`,
    `process.stdout.write(String(moduleNamespace[${JSON.stringify(options.exportName)}]))`,
  ].join('\n')

  // NODE_OPTIONS is dropped so a loader or flag set for the parent test run cannot decide the
  // answer. The question is what plain `node` does with no help.
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
