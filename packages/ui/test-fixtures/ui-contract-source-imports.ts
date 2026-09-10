import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Reads the two files behind the ./ui-contract subpath as text and lists what each imports, so a
 * gate can hold them to their allowlists rather than to whatever a bundler happens to tolerate.
 *
 * Paths are built with node:path: Vite statically rewrites new URL('<literal>', import.meta.url)
 * into an http asset URL, which fileURLToPath then rejects.
 */

/** Directory holding these fixtures; src sits beside it, one level below the package root. */
const testFixturesDirectoryPath = dirname(fileURLToPath(import.meta.url))

/** One file the JSX-free rule applies to: its absolute path, the specifiers it may import, and one it is known to have. */
export type UiContractSourceFileRule = {
  sourceFilePath: string
  allowedImportSpecifiers: readonly string[]
  knownImportSpecifier: string
}

/** Absolute path of a file inside packages/ui/src, named in gate failures so the reader knows what to open. */
function uiSourceFilePath(fileName: string): string {
  return resolve(testFixturesDirectoryPath, '..', 'src', fileName)
}

/**
 * Both files behind the ./ui-contract subpath and the only specifiers each may import. Deliberately
 * no carve-out for node: builtins or type-only imports: a contract file does no I/O and has no side
 * effects, so anything else is a contract change that updates this list in the same round. The entry
 * gets one extra allowance, the contract module it re-exports by name.
 */
export const uiContractSourceFileRules: readonly UiContractSourceFileRule[] = [
  {
    sourceFilePath: uiSourceFilePath('ui-contract.ts'),
    allowedImportSpecifiers: ['zod'],
    knownImportSpecifier: 'zod',
  },
  {
    sourceFilePath: uiSourceFilePath('ui-contract-entry.ts'),
    allowedImportSpecifiers: ['zod', './ui-contract.ts'],
    knownImportSpecifier: './ui-contract.ts',
  },
]

/** One source file as text, failing the gate with a plain message when the implementation has not written it yet. */
export function readUiContractSourceText(sourceFilePath: string): string {
  if (!existsSync(sourceFilePath)) {
    throw new Error(`gate expected @hearthkit/ui to ship ${sourceFilePath}`)
  }
  return readFileSync(sourceFilePath, 'utf8')
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
