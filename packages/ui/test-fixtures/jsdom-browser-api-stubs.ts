import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'

/**
 * Vitest setup file for every ui gate. jsdom ships no matchMedia, no ResizeObserver and no pointer
 * capture, which next-themes and the Radix primitives behind Dialog and DropdownMenu all call, so
 * the gates would fail on the environment instead of on the package without these stubs.
 */

/** Media query result the stub always reports; false pins the system theme mode to light so gates are deterministic. */
const gateMediaQueryMatches = false

/** Installs the browser APIs jsdom omits; matchMedia never matches, so 'system' always resolves to light. */
export function installJsdomBrowserApiStubs(): void {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: gateMediaQueryMatches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList

  window.ResizeObserver = class GateResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver

  Element.prototype.hasPointerCapture = (): boolean => false
  Element.prototype.setPointerCapture = (): void => undefined
  Element.prototype.releasePointerCapture = (): void => undefined
  Element.prototype.scrollIntoView = (): void => undefined
}

/** Clears the theme class, the stored mode and any stylesheet a gate injected, so gates never inherit state. */
export function resetThemeModeDocumentState(): void {
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
  window.localStorage.clear()
  for (const injected of Array.from(document.head.querySelectorAll('style[data-hearthkit-gate]'))) {
    injected.remove()
  }
}

installJsdomBrowserApiStubs()

beforeEach(() => {
  resetThemeModeDocumentState()
})

afterEach(() => {
  cleanup()
  resetThemeModeDocumentState()
})
