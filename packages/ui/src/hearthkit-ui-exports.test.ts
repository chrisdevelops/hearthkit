import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  darkModeClassName,
  darkModeOverriddenTokenNames,
  hearthkitThemeCssFileName,
  hearthkitThemeTokenNames,
  hearthkitUiMinimumExportNames,
  tailwindSourceDirectiveForUi,
  themeModeToggleOptionLabels,
  themeProviderMissingErrorPrefix,
  uiComponentFamilyNames,
} from './ui-contract.ts'
import { loadHearthkitUiEntry, uiFunctionFromEntry } from '../test-fixtures/hearthkit-ui-entry.ts'
import {
  readUiPackageManifest,
  themeStylesheetExportSubpath,
  themeStylesheetPathFromExports,
} from '../test-fixtures/hearthkit-theme-stylesheet.ts'

describe('@hearthkit/ui export surface', () => {
  it('exports every component, hook, and helper named in hearthkitUiMinimumExportNames', async () => {
    const entry = await loadHearthkitUiEntry()

    const missingExportNames = hearthkitUiMinimumExportNames.filter(
      (exportName) => entry[exportName] === undefined,
    )
    expect(missingExportNames).toEqual([])
  })

  it('re-exports the contract constants apps and gates read', async () => {
    const entry = await loadHearthkitUiEntry()

    expect(entry.darkModeClassName).toBe(darkModeClassName)
    expect(entry.hearthkitThemeCssFileName).toBe(hearthkitThemeCssFileName)
    expect(entry.themeProviderMissingErrorPrefix).toBe(themeProviderMissingErrorPrefix)
    expect(entry.tailwindSourceDirectiveForUi).toBe(tailwindSourceDirectiveForUi)
    expect(entry.hearthkitThemeTokenNames).toEqual(hearthkitThemeTokenNames)
    expect(entry.darkModeOverriddenTokenNames).toEqual(darkModeOverriddenTokenNames)
    expect(entry.uiComponentFamilyNames).toEqual(uiComponentFamilyNames)
    expect(entry.hearthkitUiMinimumExportNames).toEqual(hearthkitUiMinimumExportNames)
    expect(entry.themeModeToggleOptionLabels).toEqual(themeModeToggleOptionLabels)

    const missingSchemaNames = [
      'hearthkitThemeTokenNameSchema',
      'themeModeSchema',
      'resolvedThemeModeSchema',
      'uiComponentFamilyNameSchema',
      'uiFailureSchema',
    ].filter((exportName) => entry[exportName] === undefined)
    expect(missingSchemaNames).toEqual([])
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
