import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent, { PointerEventsCheckLevel } from '@testing-library/user-event'
import type { UserEvent } from '@testing-library/user-event'
import { vi } from 'vitest'
import type { ThemeMode } from '../src/ui-contract.ts'
import { themeModeToggleOptionLabels } from '../src/ui-contract.ts'

/**
 * Interaction helpers shared by the render gates. Radix marks the page inert while a modal menu or
 * dialog is open, which jsdom reports as pointer-events: none, so the gate user skips that check
 * instead of failing on an environment quirk.
 */
export function createUiGateUserEvent(): UserEvent {
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
}

/**
 * Opens ThemeModeToggle from its button trigger and returns its menu items, asserting the contract
 * structure on the way: exactly three items, with the accessible names in themeModeToggleOptionLabels.
 */
export async function openThemeModeToggleMenu(user: UserEvent): Promise<HTMLElement[]> {
  await user.click(screen.getByRole('button'))

  const menuItems = await screen.findAllByRole('menuitem')
  if (menuItems.length !== themeModeToggleOptionLabels.length) {
    throw new Error(
      `gate expected ThemeModeToggle to show exactly ${themeModeToggleOptionLabels.length} menu items, found ${menuItems.length}`,
    )
  }
  // Exact accessible-name lookups; getByRole reports the menu it did find when a name is missing.
  for (const optionLabel of themeModeToggleOptionLabels) {
    screen.getByRole('menuitem', { name: optionLabel })
  }
  return menuItems
}

/** Opens ThemeModeToggle and chooses the menu item whose label names one mode, such as Dark for dark. */
export async function selectThemeModeOption(user: UserEvent, themeMode: ThemeMode): Promise<void> {
  await openThemeModeToggleMenu(user)

  const optionLabel = themeModeToggleOptionLabels.find((label) => label.toLowerCase() === themeMode)
  if (optionLabel === undefined) {
    throw new Error(
      `gate expected themeModeToggleOptionLabels to carry a label for the ${themeMode} mode`,
    )
  }
  await user.click(screen.getByRole('menuitem', { name: optionLabel }))
}

/**
 * Renders an element that must throw, returning the thrown Error. React logs the render failure
 * before rethrowing it, so the gate silences console.error to keep the run output readable.
 */
export function captureUiRenderFailure(element: ReactElement): Error {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  let thrown: unknown
  try {
    render(element)
  } catch (error) {
    thrown = error
  } finally {
    consoleErrorSpy.mockRestore()
  }

  if (thrown === undefined) {
    throw new Error('gate expected rendering to throw, but it rendered without failing')
  }
  if (!(thrown instanceof Error)) {
    // thrown is unknown here, so it is serialised rather than coerced with String().
    throw new Error(`gate expected an Error to be thrown, received ${JSON.stringify(thrown)}`)
  }
  return thrown
}
