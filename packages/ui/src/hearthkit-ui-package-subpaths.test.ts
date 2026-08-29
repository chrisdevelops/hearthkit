import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  hearthkitUiContractImportSpecifier,
  hearthkitUiPackageExportSubpaths,
  tailwindSourceDirectiveForUi,
} from './ui-contract.ts'
import { runBareNodeImport } from '../test-fixtures/bare-node-module-import.ts'
import {
  exportedFilePathForUiSubpath,
  readUiPackageManifest,
  uiPackageRootPath,
} from '../test-fixtures/hearthkit-theme-stylesheet.ts'
import {
  importSpecifiersInModuleText,
  readUiContractSourceText,
  uiContractAllowedImportSpecifiers,
  uiContractSourceFilePath,
} from '../test-fixtures/ui-contract-source-imports.ts'

describe('the @hearthkit/ui exports map', () => {
  it('publishes every subpath in hearthkitUiPackageExportSubpaths, each mapped to a file that exists', () => {
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
  })
})

describe('the @hearthkit/ui ui-contract subpath under bare node', () => {
  it('imports from a plain node process, which only works while ui-contract.ts stays JSX-free and imports nothing but zod', () => {
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
    expect(imported.stdout.trim()).toBe(tailwindSourceDirectiveForUi)
  })

  it('imports nothing but zod in src/ui-contract.ts, which is the half of the rule bare node cannot see', () => {
    // The two gates split the obligation and neither subsumes the other. The bare-node gate above
    // catches JSX and a .tsx import, because Node refuses that extension. It cannot catch the rest:
    // node:fs, or another hearthkit package whose entry is a .ts file, would type-strip and load
    // cleanly from bare Node while breaking the rule outright. Only reading the source catches those.
    const foundSpecifiers = importSpecifiersInModuleText(readUiContractSourceText())

    // A scan that quietly matched nothing would make the check below pass while checking nothing,
    // so the gate first proves the scanner still finds the one import the file is known to have.
    expect(foundSpecifiers, `no import specifier found in ${uiContractSourceFilePath}`).toContain(
      'zod',
    )

    const forbiddenSpecifiers = foundSpecifiers.filter(
      (specifier) => !uiContractAllowedImportSpecifiers.includes(specifier),
    )
    expect(
      forbiddenSpecifiers,
      `${uiContractSourceFilePath} may import only ${uiContractAllowedImportSpecifiers.join(', ')}; every other specifier takes @hearthkit/ui/ui-contract out of a Node-executed caller's reach`,
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
