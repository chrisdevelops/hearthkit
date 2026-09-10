import { describe, expect, it } from 'vitest'
import {
  applyStylesheetTextToDocument,
  computedThemeTokenValue,
  darkModeClassName,
  darkModeOverriddenTokenNames,
  hearthkitThemeTokenNames,
  isDarkModeSelector,
  isRootSelector,
  readAppThemeOverrideCssText,
  readHearthkitThemeCssText,
  tokenDeclarationsForSelector,
} from '../test-fixtures/hearthkit-theme-stylesheet.ts'

describe('hearthkit-theme.css', () => {
  it('declares every theme token in the :root block', () => {
    const rootTokens = tokenDeclarationsForSelector(readHearthkitThemeCssText(), isRootSelector)

    const missingTokenNames = hearthkitThemeTokenNames.filter(
      (tokenName) => !rootTokens.has(tokenName),
    )
    expect(missingTokenNames).toEqual([])

    const emptyTokenNames = hearthkitThemeTokenNames.filter(
      (tokenName) => (rootTokens.get(tokenName) ?? '') === '',
    )
    expect(emptyTokenNames).toEqual([])
  })

  it('redefines every dark-mode token in the .dark block', () => {
    const darkTokens = tokenDeclarationsForSelector(readHearthkitThemeCssText(), isDarkModeSelector)

    const missingTokenNames = darkModeOverriddenTokenNames.filter(
      (tokenName) => !darkTokens.has(tokenName),
    )
    expect(missingTokenNames).toEqual([])

    // --radius is mode independent, so the dark block must not restate it.
    expect(darkTokens.has('--radius')).toBe(false)
  })

  it('registers the class-based dark variant and the @theme inline bridge', () => {
    const themeCssText = readHearthkitThemeCssText()

    const darkVariantLine = themeCssText
      .split('\n')
      .find((line) => /@(custom-)?variant\s+dark\b/.test(line))
    if (darkVariantLine === undefined) {
      throw new Error(
        'gate expected hearthkit-theme.css to register the dark variant so dark: utilities follow the class',
      )
    }
    expect(darkVariantLine).toContain(`.${darkModeClassName}`)

    // The bridge is what turns the tokens into utilities such as bg-primary and text-muted-foreground.
    expect(themeCssText).toMatch(/@theme\s+inline\s*\{/)
    expect(themeCssText).toMatch(/--color-primary:\s*var\(--primary\)/)
    expect(themeCssText).toMatch(/--color-muted-foreground:\s*var\(--muted-foreground\)/)
  })
})

describe('theme tokens in the document', () => {
  it('resolves every theme token on the root element once the stylesheet is loaded', () => {
    const themeCssText = readHearthkitThemeCssText()
    const rootTokens = tokenDeclarationsForSelector(themeCssText, isRootSelector)
    applyStylesheetTextToDocument(themeCssText)

    const unresolvedTokenNames = hearthkitThemeTokenNames.filter(
      (tokenName) => computedThemeTokenValue(tokenName) !== rootTokens.get(tokenName),
    )
    expect(unresolvedTokenNames).toEqual([])
  })

  it('switches every dark-mode token to its dark value when the root element has the dark class', () => {
    const themeCssText = readHearthkitThemeCssText()
    const darkTokens = tokenDeclarationsForSelector(themeCssText, isDarkModeSelector)
    applyStylesheetTextToDocument(themeCssText)

    const lightValues = new Map(
      darkModeOverriddenTokenNames.map((tokenName) => [
        tokenName,
        computedThemeTokenValue(tokenName),
      ]),
    )
    document.documentElement.classList.add(darkModeClassName)

    const unswitchedTokenNames = darkModeOverriddenTokenNames.filter(
      (tokenName) => computedThemeTokenValue(tokenName) !== darkTokens.get(tokenName),
    )
    expect(unswitchedTokenNames).toEqual([])

    const changedTokenNames = darkModeOverriddenTokenNames.filter(
      (tokenName) => computedThemeTokenValue(tokenName) !== lightValues.get(tokenName),
    )
    expect(changedTokenNames.length).toBeGreaterThan(0)
  })

  it('lets an app stylesheet loaded after the theme override a token value', () => {
    const themeCssText = readHearthkitThemeCssText()
    const overrideCssText = readAppThemeOverrideCssText()
    const overriddenTokens = tokenDeclarationsForSelector(overrideCssText, isRootSelector)
    const [overriddenTokenName] = [...overriddenTokens.keys()]
    const untouchedTokenName = hearthkitThemeTokenNames.find(
      (tokenName) => !overriddenTokens.has(tokenName),
    )
    if (overriddenTokenName === undefined || untouchedTokenName === undefined) {
      throw new Error('gate fixture app-theme-override.css must override some but not all tokens')
    }

    applyStylesheetTextToDocument(themeCssText)
    const themeValue = computedThemeTokenValue(overriddenTokenName)
    const untouchedThemeValue = computedThemeTokenValue(untouchedTokenName)
    expect(themeValue).not.toBe('')

    applyStylesheetTextToDocument(overrideCssText)

    expect(computedThemeTokenValue(overriddenTokenName)).toBe(
      overriddenTokens.get(overriddenTokenName),
    )
    expect(computedThemeTokenValue(overriddenTokenName)).not.toBe(themeValue)
    expect(computedThemeTokenValue(untouchedTokenName)).toBe(untouchedThemeValue)
  })
})
