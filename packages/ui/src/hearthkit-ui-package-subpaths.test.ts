import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as uiContract from './ui-contract.ts'
import { runBareNodeImport } from '../test-fixtures/bare-node-module-import.ts'
import {
  exportedFilePathForUiSubpath,
  hearthkitUiContractImportSpecifier,
  hearthkitUiPackageExportSubpaths,
  readUiPackageManifest,
  uiContractEntryRelativePath,
  uiPackageRootPath,
} from '../test-fixtures/hearthkit-theme-stylesheet.ts'
import {
  hearthkitUiContractSubpathValueExportNames,
  importHearthkitUiContractSubpathNamespace,
} from '../test-fixtures/hearthkit-ui-entry.ts'
import {
  importSpecifiersInModuleText,
  readUiContractSourceText,
  uiContractSourceFileRules,
} from '../test-fixtures/ui-contract-source-imports.ts'

describe('the @hearthkit/ui exports map', () => {
  it('publishes every subpath the package promises, each mapped to a file that exists, with ./ui-contract on the JSX-free entry module', () => {
    const manifest = readUiPackageManifest()

    // Both lists are collected before asserting, so one run names every missing subpath rather than
    // stopping the reader at the first one.
    const unpublishedSubpaths: string[] = []
    const subpathsMappedToNothingOnDisk: string[] = []

    for (const exportSubpath of hearthkitUiPackageExportSubpaths) {
      const publishedPath = exportedFilePathForUiSubpath(manifest, exportSubpath)
      if (publishedPath === undefined) {
        unpublishedSubpaths.push(exportSubpath)
        continue
      }
      if (!existsSync(publishedPath)) {
        subpathsMappedToNothingOnDisk.push(`${exportSubpath} -> ${publishedPath}`)
      }
    }

    expect(unpublishedSubpaths).toEqual([])
    expect(subpathsMappedToNothingOnDisk).toEqual([])

    // ./ui-contract must land on the narrow named re-export module, not on the wider internal
    // ui-contract.ts behind it: publishing the internal module would put the error prefix and the
    // toggle labels back on the public surface through a side door.
    expect(
      JSON.stringify(manifest.exports?.['./ui-contract']),
      `./ui-contract must publish ${uiContractEntryRelativePath}`,
    ).toContain(uiContractEntryRelativePath)
  })
})

describe('the @hearthkit/ui ui-contract subpath under bare node', () => {
  it('imports from a plain node process and carries exactly the five contract values, which only works while both contract modules stay JSX-free', async () => {
    const imported = runBareNodeImport({
      moduleSpecifier: hearthkitUiContractImportSpecifier,
      exportName: 'tailwindSourceDirectiveForUi',
      workingDirectoryPath: uiPackageRootPath,
    })

    expect(
      imported.exitCode,
      `bare node could not import ${hearthkitUiContractImportSpecifier} from ${uiPackageRootPath}:\n${imported.stderr}`,
    ).toBe(0)

    // The child prints a value rather than merely exiting 0, so the gate proves the module really
    // evaluated. tailwindSourceDirectiveForUi is a long literal that cannot match by accident.
    expect(imported.stdout.trim()).toBe(uiContract.tailwindSourceDirectiveForUi)

    // What the subpath carries is asked in process, where the same specifier resolves through the
    // manifest (the vitest alias is anchored to the bare name) and the values can be compared by
    // identity rather than by their printed form.
    const subpathNamespace = await importHearthkitUiContractSubpathNamespace()
    const contractModule = uiContract as unknown as Record<string, unknown>
    const subpathValueExportNames = Object.keys(subpathNamespace)
      .filter((exportName) => subpathNamespace[exportName] !== undefined)
      .toSorted()
    expect(
      subpathValueExportNames,
      'src/ui-contract-entry.ts must export exactly the five contract values on the entry allowlist',
    ).toEqual([...hearthkitUiContractSubpathValueExportNames].toSorted())

    const rebuiltInsteadOfReExported = hearthkitUiContractSubpathValueExportNames.filter(
      (exportName) => subpathNamespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical values ui-contract.ts exports, not a second copy of them',
    ).toEqual([])
  })

  it('imports nothing but zod, and ui-contract.ts, in the two files behind the subpath, which is the half of the rule bare node cannot see', () => {
    // The two gates split the obligation and neither subsumes the other. The bare-node gate above
    // catches JSX and a .tsx import, because Node refuses that extension. It cannot catch the rest:
    // node:fs, or another hearthkit package whose entry is a .ts file, would type-strip and load
    // cleanly from bare Node while breaking the rule outright. Only reading the source catches those.
    const forbiddenSpecifiersByFile: string[] = []

    for (const sourceFileRule of uiContractSourceFileRules) {
      const foundSpecifiers = importSpecifiersInModuleText(
        readUiContractSourceText(sourceFileRule.sourceFilePath),
      )

      // A scan that quietly matched nothing would make the check below pass while checking nothing,
      // so the gate first proves the scanner still finds an import each file is known to have.
      expect(
        foundSpecifiers,
        `no import specifier found in ${sourceFileRule.sourceFilePath}`,
      ).toContain(sourceFileRule.knownImportSpecifier)

      for (const specifier of foundSpecifiers) {
        if (!sourceFileRule.allowedImportSpecifiers.includes(specifier)) {
          forbiddenSpecifiersByFile.push(`${sourceFileRule.sourceFilePath} imports ${specifier}`)
        }
      }
    }

    expect(
      forbiddenSpecifiersByFile,
      'each file may import only its allowlist; every other specifier takes @hearthkit/ui/ui-contract out of the reach of a Node-executed caller',
    ).toEqual([])
  })

  it('is the only way in, because bare node still refuses the .tsx modules behind the package entry', () => {
    const imported = runBareNodeImport({
      moduleSpecifier: '@hearthkit/ui',
      exportName: 'tailwindSourceDirectiveForUi',
      workingDirectoryPath: uiPackageRootPath,
    })

    // A control, green before and after the subpath lands: it is what makes the gate above a result
    // rather than an accident, and it documents the wall the subpath exists to get around. Asserted
    // as a failure mode — nonzero exit, nothing printed, a .tsx file named in the diagnosis — and
    // never as an exact message, because Node's error text is not a stable contract.
    expect(imported.exitCode, `bare node unexpectedly imported @hearthkit/ui`).not.toBe(0)
    expect(imported.stdout.trim()).toBe('')
    expect(imported.stderr, 'expected node to name the .tsx module it refused').toContain('.tsx')
  })
})
