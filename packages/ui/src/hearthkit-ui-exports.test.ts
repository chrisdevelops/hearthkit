import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as uiContract from './ui-contract.ts'
import {
  hearthkitUiContractSubpathValueExportNames,
  hearthkitUiEntryValueExportNames,
  isRenderableUiComponent,
  loadHearthkitUiEntry,
  uiFunctionFromEntry,
} from '../test-fixtures/hearthkit-ui-entry.ts'
import {
  readUiPackageManifest,
  themeStylesheetExportSubpath,
  themeStylesheetPathFromExports,
} from '../test-fixtures/hearthkit-theme-stylesheet.ts'

describe('@hearthkit/ui export surface', () => {
  it('exports exactly the forty-seven allowlisted values and nothing else, each contract value the one ui-contract.ts already exports', async () => {
    const entry = await loadHearthkitUiEntry()
    const contractModule = uiContract as unknown as Record<string, unknown>

    // A module namespace carries value exports only, so every `export type` is already erased here
    // and the four types CONTRACT.md keeps on the entry point are covered by typecheck instead. Both
    // lists are compared whole rather than name by name, so a failure names every wrong export at
    // once instead of stopping at the first and hiding the rest behind a rerun.
    const actualValueExportNames = Object.keys(entry)
      .filter((exportName) => entry[exportName] !== undefined)
      .toSorted()
    expect(
      actualValueExportNames,
      'src/index.ts must export exactly the allowlist in CONTRACT.md "Package entry point"',
    ).toEqual([...hearthkitUiEntryValueExportNames].toSorted())

    // The five contract values must be the identical values ui-contract.ts exports, not a second
    // copy: an app comparing entry.tailwindSourceDirectiveForUi against the subpath's value is
    // comparing the same thing. themeProviderMissingErrorPrefix and themeModeToggleOptionLabels stay
    // internal, so they are absent from the list above and cannot be checked in.
    for (const exportName of hearthkitUiContractSubpathValueExportNames) {
      expect(entry[exportName], `${exportName} must be re-exported from ./ui-contract.ts`).toBe(
        contractModule[exportName],
      )
    }

    // Everything else on the allowlist is a component, a hook or a helper: a function, or the
    // forwardRef/memo object React also renders. A name exported as a string or a schema by mistake
    // is named here rather than failing later inside a render gate.
    const notRenderableOrCallable = hearthkitUiEntryValueExportNames.filter(
      (exportName) =>
        !hearthkitUiContractSubpathValueExportNames.includes(
          exportName as (typeof hearthkitUiContractSubpathValueExportNames)[number],
        ) && !isRenderableUiComponent(entry[exportName]),
    )
    expect(
      notRenderableOrCallable,
      'every allowlisted name outside the five contract values must be a component, hook, or helper',
    ).toEqual([])
  })

  it('merges conflicting tailwind classes and drops falsy inputs in mergeTailwindClasses', async () => {
    const entry = await loadHearthkitUiEntry()
    const mergeTailwindClasses = uiFunctionFromEntry(entry, 'mergeTailwindClasses')

    const merged = mergeTailwindClasses(
      'px-2 py-1',
      false,
      undefined,
      null,
      ['rounded', { hidden: false }],
      'px-4',
    )

    expect(typeof merged).toBe('string')
    expect(String(merged).split(' ').toSorted()).toEqual(['px-4', 'py-1', 'rounded'])
  })

  it('publishes the entry and the theme stylesheet subpath, and depends on no other hearthkit package', () => {
    const manifest = readUiPackageManifest()

    expect(manifest.name).toBe('@hearthkit/ui')
    expect(manifest.exports?.['.']).toBeDefined()

    const publishedStylesheetPath = themeStylesheetPathFromExports(manifest)
    if (publishedStylesheetPath === undefined) {
      throw new Error(
        `gate expected the package manifest to publish ${themeStylesheetExportSubpath} so apps can import the theme`,
      )
    }
    expect(existsSync(publishedStylesheetPath)).toBe(true)

    // ui is a root of the dependency graph: it must not reach for @hearthkit/config or any sibling.
    const hearthkitDependencyNames = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ].filter((dependencyName) => dependencyName.startsWith('@hearthkit/'))
    expect(hearthkitDependencyNames).toEqual([])
  })
})
