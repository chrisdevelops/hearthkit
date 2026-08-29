import { describe, expect, it } from 'vitest'
import {
  expectNonEmptyStringList,
  importTemplateModule,
} from '../test-fixtures/app-template-gate-expectations.ts'
import { appTemplateRootPath } from '../test-fixtures/app-template-tree-files.ts'
import { runBareNodeImport } from '../test-fixtures/bare-node-module-import.ts'

/** Path this gate's own subject sits at; the contract names src/ as repo-only but pins no path for this file. */
const appTemplateContractModulePath = './src/app-template-contract.ts'

/** Contract list the child prints back; built from the two constants that arrive over @hearthkit/ui/ui-contract. */
const printedContractExportName = 'appTemplateGlobalsCssRequiredLines'

describe('src/app-template-contract.ts under bare node', () => {
  it('imports from a plain node process, which is what lets verify:container read its own contract instead of mirroring it', async () => {
    // verify:container runs under plain `node`, with no bundler and no JSX-capable loader. Every
    // specifier the contract imports must therefore stay Node-resolvable: @hearthkit/config,
    // @hearthkit/observability, @hearthkit/ui/ui-contract and zod, all through this template's own
    // node_modules. A Phase 5 package added to appTemplateRequiredPackageNames that reaches a .tsx
    // module takes the whole contract back out of Node's reach, and this is what says so.
    const imported = runBareNodeImport({
      moduleSpecifier: appTemplateContractModulePath,
      exportName: printedContractExportName,
      workingDirectoryPath: appTemplateRootPath,
    })

    expect(
      imported.exitCode,
      `bare node could not import ${appTemplateContractModulePath} from ${appTemplateRootPath}:\n${imported.stderr}`,
    ).toBe(0)

    // The contract is imported here rather than at the top of the file so an unresolvable specifier
    // fails this one gate with the child's diagnosis, instead of breaking collection for the file.
    const contractModule = await importTemplateModule(
      'src/app-template-contract.ts',
      () => import('./app-template-contract.ts'),
    )
    const expectedGlobalsCssLines = expectNonEmptyStringList(
      contractModule[printedContractExportName],
      printedContractExportName,
    )

    // The child prints a value rather than merely exiting 0, so a match proves the ui subpath both
    // resolved and carried the right literals across the process boundary. Both sides run the value
    // through String(), so the list compares as one line with no hand-written join.
    expect(imported.stdout.trim()).toBe(String(expectedGlobalsCssLines))
  })
})
