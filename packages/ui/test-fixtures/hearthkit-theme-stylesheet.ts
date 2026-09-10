import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Readers for the shipped theme stylesheet and the package manifest that publishes it, plus the
 * machine-readable token vocabulary and subpath list they are compared against. Those constants live
 * here and not in src/ui-contract.ts because no app ever constructs a token name or a subpath: their
 * only reader is a gate. The CSS is parsed with the same jsdom CSSOM the DOM gates use, so a token
 * counts as declared only when a browser would see it in the rule, not when the file merely mentions
 * its name in a comment.
 *
 * Paths are built with node:path: Vite statically rewrites new URL('<literal>', import.meta.url)
 * into an http asset URL, which fileURLToPath then rejects.
 */

/** Class name on the document root element that switches every theme token to its dark value. */
export const darkModeClassName = 'dark'

/** File name of the base theme stylesheet at src/hearthkit-theme.css, exported at the package subpath @hearthkit/ui/hearthkit-theme.css. */
export const hearthkitThemeCssFileName = 'hearthkit-theme.css'

/** Every subpath the package manifest must publish in its exports map; ./ui-contract is the JSX-free one Node-executed callers import. */
export const hearthkitUiPackageExportSubpaths = [
  '.',
  './hearthkit-theme.css',
  './ui-contract',
] as const

/** Exact specifier a Node-executed caller imports the contract values from; the manifest must map it to src/ui-contract-entry.ts. */
export const hearthkitUiContractImportSpecifier = '@hearthkit/ui/ui-contract'

/** Path, relative to the package root, the ./ui-contract subpath must publish; a JSX-free named re-export module. */
export const uiContractEntryRelativePath = './src/ui-contract-entry.ts'

/** Every theme token hearthkit-theme.css must define in :root; the canonical shadcn CSS variable vocabulary. */
export const hearthkitThemeTokenNames = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--border',
  '--input',
  '--ring',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
  '--radius',
] as const

/** One of the canonical theme token names, for example '--primary'. */
export type HearthkitThemeTokenName = (typeof hearthkitThemeTokenNames)[number]

/** Every theme token the .dark block must redefine; all tokens except --radius, which is mode-independent. */
export const darkModeOverriddenTokenNames = hearthkitThemeTokenNames.filter(
  (tokenName): tokenName is Exclude<HearthkitThemeTokenName, '--radius'> =>
    tokenName !== '--radius',
)

/** Directory holding these fixtures, read from import.meta.url, which Vite leaves alone. */
const testFixturesDirectoryPath = dirname(fileURLToPath(import.meta.url))

/** Package root of @hearthkit/ui; test-fixtures and src both sit one directory below it, and a bare-node gate runs its child process here. */
export const uiPackageRootPath = resolve(testFixturesDirectoryPath, '..')

/** Subpath an app imports the stylesheet from, as published in the package.json exports map. */
export const themeStylesheetExportSubpath = `./${hearthkitThemeCssFileName}`

/** Only the manifest fields the gates read; everything else in package.json is free to change. */
export type UiPackageManifest = {
  name?: string
  exports?: Record<string, unknown>
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

/** Reads packages/ui/package.json, failing the gate with a plain message when it is not there yet. */
export function readUiPackageManifest(): UiPackageManifest {
  const manifestPath = resolve(uiPackageRootPath, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`gate expected a package manifest at ${manifestPath}`)
  }
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as UiPackageManifest
}

/**
 * The absolute file one exports-map subpath publishes, or undefined when the manifest does not map
 * it. A subpath may be a bare string or a conditions object ("types", "default", …); the first
 * string condition wins, because every condition of one subpath points into the same source file.
 */
export function exportedFilePathForUiSubpath(
  manifest: UiPackageManifest,
  exportSubpath: string,
): string | undefined {
  const mapped = manifest.exports?.[exportSubpath]
  if (typeof mapped === 'string') {
    return resolve(uiPackageRootPath, mapped)
  }
  if (typeof mapped === 'object' && mapped !== null) {
    for (const condition of Object.values(mapped as Record<string, unknown>)) {
      if (typeof condition === 'string') {
        return resolve(uiPackageRootPath, condition)
      }
    }
  }
  return undefined
}

/** The file the exports map publishes for the stylesheet subpath, or undefined when it is unmapped. */
export function themeStylesheetPathFromExports(manifest: UiPackageManifest): string | undefined {
  return exportedFilePathForUiSubpath(manifest, themeStylesheetExportSubpath)
}

/** On-disk path the contract pins for the stylesheet, used when the manifest does not publish it yet. */
export const pinnedThemeStylesheetPath = resolve(
  uiPackageRootPath,
  'src',
  hearthkitThemeCssFileName,
)

/** Absolute path of hearthkit-theme.css: the published subpath first, then the pinned src location. */
export function locateHearthkitThemeCssFile(): string {
  const candidatePaths: string[] = []
  if (existsSync(resolve(uiPackageRootPath, 'package.json'))) {
    const publishedPath = themeStylesheetPathFromExports(readUiPackageManifest())
    if (publishedPath !== undefined) {
      candidatePaths.push(publishedPath)
    }
  }
  candidatePaths.push(pinnedThemeStylesheetPath)

  const foundPath = candidatePaths.find((candidatePath) => existsSync(candidatePath))
  if (foundPath === undefined) {
    const searchedPaths = [...new Set(candidatePaths)]
    throw new Error(
      `gate expected @hearthkit/ui to ship ${hearthkitThemeCssFileName}; looked in ${searchedPaths.join(', ')}`,
    )
  }
  return foundPath
}

/** The shipped theme stylesheet as text, failing the gate when the package ships no stylesheet. */
export function readHearthkitThemeCssText(): string {
  return readFileSync(locateHearthkitThemeCssFile(), 'utf8')
}

/** The gate's stand-in for an app globals.css that overrides theme tokens after importing the theme. */
export function readAppThemeOverrideCssText(): string {
  return readFileSync(resolve(testFixturesDirectoryPath, 'app-theme-override.css'), 'utf8')
}

/** Adds a stylesheet to the document in cascade order; the setup file removes it after each gate. */
export function applyStylesheetTextToDocument(cssText: string): void {
  const styleElement = document.createElement('style')
  styleElement.setAttribute('data-hearthkit-gate', 'stylesheet')
  styleElement.textContent = cssText
  document.head.append(styleElement)
}

/** Every style rule in a sheet, including rules nested inside @layer and @media blocks. */
function collectStyleRules(rules: CSSRuleList, collected: CSSStyleRule[] = []): CSSStyleRule[] {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules.item(index)
    if (rule === null) {
      continue
    }
    if (rule instanceof CSSStyleRule) {
      collected.push(rule)
    }
    const nestedRules = (rule as Partial<CSSGroupingRule>).cssRules
    if (nestedRules !== undefined) {
      collectStyleRules(nestedRules, collected)
    }
  }
  return collected
}

/** The comma-separated parts of a selector, trimmed, so ':root, :host' matches either part. */
function selectorParts(selectorText: string): string[] {
  return selectorText.split(',').map((part) => part.trim())
}

/** True for the selector that carries the light-mode token values on the root element. */
export function isRootSelector(selectorText: string): boolean {
  return selectorParts(selectorText).some(
    (part) => part === ':root' || part === 'html' || part === ':host',
  )
}

/** True for the selector that carries the dark-mode token values, keyed off the dark class. */
export function isDarkModeSelector(selectorText: string): boolean {
  const darkClassSelector = `.${darkModeClassName}`
  return selectorParts(selectorText).some(
    (part) =>
      part === darkClassSelector ||
      part === `:root${darkClassSelector}` ||
      part === `html${darkClassSelector}`,
  )
}

/** Custom properties a stylesheet declares for one selector, as a token name to value map. */
export function tokenDeclarationsForSelector(
  cssText: string,
  matchesSelector: (selectorText: string) => boolean,
): Map<string, string> {
  const styleElement = document.createElement('style')
  styleElement.textContent = cssText
  document.head.append(styleElement)
  try {
    const parsedSheet = styleElement.sheet
    if (parsedSheet === null) {
      throw new Error('gate could not parse the stylesheet text as CSS')
    }
    const declarations = new Map<string, string>()
    for (const rule of collectStyleRules(parsedSheet.cssRules)) {
      if (!matchesSelector(rule.selectorText)) {
        continue
      }
      for (let index = 0; index < rule.style.length; index += 1) {
        const propertyName = rule.style.item(index)
        if (!propertyName.startsWith('--')) {
          continue
        }
        declarations.set(propertyName, rule.style.getPropertyValue(propertyName).trim())
      }
    }
    return declarations
  } finally {
    styleElement.remove()
  }
}

/** The value the cascade resolves a theme token to on the document root element right now. */
export function computedThemeTokenValue(tokenName: string): string {
  return window.getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim()
}
