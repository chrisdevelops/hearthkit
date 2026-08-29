import { describe, expect, it } from 'vitest'
import {
  importSpecifiersInText,
  meaningfulLines,
  readTemplateFileText,
} from '../test-fixtures/app-template-tree-files.ts'
import {
  appTemplateFailureSchema,
  appTemplateGlobalsCssRequiredLines,
  appThemeWiringMissingErrorPrefix,
} from './app-template-contract.ts'

/** Comment prefixes in a CSS file, so a licence header above the imports does not fail the order check. */
const cssCommentPrefixes = ['/*', '*', '//']

/** Components app/page.tsx renders; its only job is to prove the ui wiring end to end. */
const homePageComponentNames = ['PageContainer', 'PageHeader', 'ThemeModeToggle', 'Card', 'Button']

const openingTagOf = (markupText: string, tagName: string): string =>
  new RegExp(`<${tagName}\\b[\\s\\S]*?>`).exec(markupText)?.[0] ?? ''

describe('templates/app theme wiring', () => {
  it('imports tailwind, the hearthkit theme and the ui @source line in that order in app/globals.css', () => {
    const globalsCssLines = meaningfulLines(
      readTemplateFileText('app/globals.css'),
      cssCommentPrefixes,
    )

    // Exact literals, in order, taken from the contract: the second and third lines are owned by
    // @hearthkit/ui and are never retyped, because the @source path is what makes Tailwind scan the
    // package. Losing any of them still returns 200 and renders unstyled, so only this gate and the
    // smoke test's computed-style assertion catch it.
    expect(globalsCssLines.slice(0, appTemplateGlobalsCssRequiredLines.length)).toEqual([
      ...appTemplateGlobalsCssRequiredLines,
    ])

    const themeWiringFailure = appTemplateFailureSchema.parse({
      kind: 'app-theme-wiring-missing',
      missingLine: appTemplateGlobalsCssRequiredLines[2],
      message: `${appThemeWiringMissingErrorPrefix} ${appTemplateGlobalsCssRequiredLines[2]}`,
    })
    expect(themeWiringFailure.kind).toBe('app-theme-wiring-missing')
  })

  it('loads globals.css and wraps the app in ThemeModeProvider in app/layout.tsx', () => {
    const layoutText = readTemplateFileText('app/layout.tsx')

    expect(importSpecifiersInText(layoutText)).toContain('./globals.css')
    expect(importSpecifiersInText(layoutText)).toContain('@hearthkit/ui')
    expect(layoutText).toContain('ThemeModeProvider')
    expect(layoutText).toMatch(/<ThemeModeProvider[\s>]/)

    // next-themes writes the theme class onto <html> before React hydrates, so the root element has
    // to opt out of the hydration mismatch warning.
    expect(openingTagOf(layoutText, 'html')).toContain('suppressHydrationWarning')
  })

  it('renders the ui primitives that prove the wiring in app/page.tsx', () => {
    const pageText = readTemplateFileText('app/page.tsx')

    expect(importSpecifiersInText(pageText)).toContain('@hearthkit/ui')

    const missingComponentNames = homePageComponentNames.filter(
      (componentName) => !new RegExp(`<${componentName}[\\s/>]`).test(pageText),
    )
    expect(missingComponentNames).toEqual([])

    // The toggle sits in the header's actions slot, which is PageHeader's children.
    expect(openingTagOf(pageText, 'PageHeader')).not.toBe('')
    expect(pageText.indexOf('<ThemeModeToggle')).toBeGreaterThan(pageText.indexOf('<PageHeader'))
  })
})
