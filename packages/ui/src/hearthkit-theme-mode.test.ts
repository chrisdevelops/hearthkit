import { createElement } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ThemeMode } from './ui-contract.ts'
import {
  darkModeClassName,
  resolvedThemeModeSchema,
  themeModeSchema,
  themeProviderMissingErrorPrefix,
  uiFailureSchema,
} from './ui-contract.ts'
import {
  loadHearthkitUiEntry,
  uiComponentsFromEntry,
  uiFunctionFromEntry,
} from '../test-fixtures/hearthkit-ui-entry.ts'
import {
  captureUiRenderFailure,
  createUiGateUserEvent,
  selectThemeModeOption,
} from '../test-fixtures/ui-gate-rendering.ts'

/** The three fields useThemeMode must return, left unknown so the gate does the asserting. */
type UseThemeModeResultFields = {
  themeMode: unknown
  setThemeMode: unknown
  resolvedThemeMode: unknown
}

/** Narrows what useThemeMode returned to the contract's UseThemeModeResult fields, or fails the gate. */
function readUseThemeModeResult(observedResult: unknown): UseThemeModeResultFields {
  if (typeof observedResult !== 'object' || observedResult === null) {
    throw new Error(
      `gate expected useThemeMode to return a UseThemeModeResult, received ${String(observedResult)}`,
    )
  }

  const missingFieldNames = ['themeMode', 'setThemeMode', 'resolvedThemeMode'].filter(
    (fieldName) => !(fieldName in observedResult),
  )
  if (missingFieldNames.length > 0) {
    throw new Error(
      `gate expected useThemeMode to return the fields ${missingFieldNames.join(', ')}`,
    )
  }
  return observedResult as UseThemeModeResultFields
}

describe('theme mode', () => {
  it('adds the dark class to the document root element when the toggle selects dark', async () => {
    const entry = await loadHearthkitUiEntry()
    const { ThemeModeProvider, ThemeModeToggle } = uiComponentsFromEntry(entry, [
      'ThemeModeProvider',
      'ThemeModeToggle',
    ])
    const user = createUiGateUserEvent()

    render(createElement(ThemeModeProvider, null, createElement(ThemeModeToggle, null)))
    expect(document.documentElement.classList.contains(darkModeClassName)).toBe(false)

    await selectThemeModeOption(user, 'dark')

    await waitFor(() => {
      expect(document.documentElement.classList.contains(darkModeClassName)).toBe(true)
    })
  })

  it('removes the dark class from the document root element when the toggle selects light', async () => {
    const entry = await loadHearthkitUiEntry()
    const { ThemeModeProvider, ThemeModeToggle } = uiComponentsFromEntry(entry, [
      'ThemeModeProvider',
      'ThemeModeToggle',
    ])
    const user = createUiGateUserEvent()

    render(createElement(ThemeModeProvider, null, createElement(ThemeModeToggle, null)))
    await selectThemeModeOption(user, 'dark')
    await waitFor(() => {
      expect(document.documentElement.classList.contains(darkModeClassName)).toBe(true)
    })

    await selectThemeModeOption(user, 'light')

    await waitFor(() => {
      expect(document.documentElement.classList.contains(darkModeClassName)).toBe(false)
    })
  })

  it('returns themeMode, setThemeMode, and resolvedThemeMode from useThemeMode under ThemeModeProvider', async () => {
    const entry = await loadHearthkitUiEntry()
    const { ThemeModeProvider } = uiComponentsFromEntry(entry, ['ThemeModeProvider'])
    const useThemeMode = uiFunctionFromEntry(entry, 'useThemeMode')

    let observedResult: unknown
    function ThemeModeProbe() {
      observedResult = useThemeMode()
      return createElement('span', null, 'theme mode probe')
    }

    render(createElement(ThemeModeProvider, null, createElement(ThemeModeProbe)))

    expect(screen.getByText('theme mode probe').textContent).toBe('theme mode probe')
    const result = readUseThemeModeResult(observedResult)

    themeModeSchema.parse(result.themeMode)
    expect(typeof result.setThemeMode).toBe('function')
    if (result.resolvedThemeMode !== undefined) {
      resolvedThemeModeSchema.parse(result.resolvedThemeMode)
    }

    // setThemeMode is the documented way to change the mode, so the gate drives it and reads back.
    const setThemeMode = result.setThemeMode as (mode: ThemeMode) => void
    await act(async () => {
      setThemeMode('dark')
    })

    await waitFor(() => {
      const updated = readUseThemeModeResult(observedResult)
      expect(updated.themeMode).toBe('dark')
      expect(updated.resolvedThemeMode).toBe('dark')
      expect(document.documentElement.classList.contains(darkModeClassName)).toBe(true)
    })
  })

  it('throws theme-provider-missing when useThemeMode runs outside ThemeModeProvider', async () => {
    const entry = await loadHearthkitUiEntry()
    const useThemeMode = uiFunctionFromEntry(entry, 'useThemeMode')

    function UnwrappedThemeModeProbe() {
      useThemeMode()
      return createElement('span', null, 'theme mode probe')
    }

    const failure = captureUiRenderFailure(createElement(UnwrappedThemeModeProbe))

    expect(failure.message.startsWith(themeProviderMissingErrorPrefix)).toBe(true)
    uiFailureSchema.parse({ kind: 'theme-provider-missing', message: failure.message })
  })

  it('throws theme-provider-missing when ThemeModeToggle renders outside ThemeModeProvider', async () => {
    const entry = await loadHearthkitUiEntry()
    const { ThemeModeToggle } = uiComponentsFromEntry(entry, ['ThemeModeToggle'])

    const failure = captureUiRenderFailure(createElement(ThemeModeToggle, null))

    expect(failure.message.startsWith(themeProviderMissingErrorPrefix)).toBe(true)
    uiFailureSchema.parse({ kind: 'theme-provider-missing', message: failure.message })
  })
})
