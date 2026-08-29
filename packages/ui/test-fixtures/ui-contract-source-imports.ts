import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Reads src/ui-contract.ts as text and lists what it imports, so a gate can hold it to the
 * allowlist rather than to whatever a bundler happens to tolerate.
 *
 * Paths are built with node:path: Vite statically rewrites new URL('<literal>', import.meta.url)
 * into an http asset URL, which fileURLToPath then rejects.
 */

/** Directory holding these fixtures; src sits beside it, one level below the package root. */
const testFixturesDirectoryPath = dirname(fileURLToPath(import.meta.url))

/** Absolute path of the contract file the JSX-free rule applies to, named in gate failures so the reader knows what to open. */
export const uiContractSourceFilePath = resolve(
  testFixturesDirectoryPath,
  '..',
  'src',
  'ui-contract.ts',
)

/**
 * The only module specifier src/ui-contract.ts may import. Deliberately no carve-out for node:
 * builtins or type-only imports: a contract file does no I/O and has no side effects, so anything
 * else is a contract change that updates this list in the same round.
 */
export const uiContractAllowedImportSpecifiers: readonly string[] = ['zod']

/** The contract file as text; read fresh each call so a gate never asserts against a stale copy. */
export function readUiContractSourceText(): string {
  return readFileSync(uiContractSourceFilePath, 'utf8')
}

/**
 * Every module specifier a TypeScript file references. The `from` alternative covers
 * `import … from`, `import type … from`, `export … from` and `export * from`; the `import`
 * alternative covers a bare side-effect import and a dynamic `import(…)`; `require` covers the
 * CommonJS form. Quotes must match, and a backtick is accepted because `import(`…`)` is legal.
 */
export function importSpecifiersInModuleText(moduleText: string): string[] {
  const moduleSpecifierPattern = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*(['"`])([^'"`\n]+)\1/g
  const specifiers: string[] = []

  for (const match of moduleText.matchAll(moduleSpecifierPattern)) {
    const specifier = match[2]
    if (specifier !== undefined) {
      specifiers.push(specifier)
    }
  }

  return specifiers
}
