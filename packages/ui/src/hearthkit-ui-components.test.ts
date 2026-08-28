import { createElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { UiComponentFamilyName } from './ui-contract.ts'
import { themeModeToggleOptionLabels, uiComponentFamilyNames } from './ui-contract.ts'
import type { HearthkitUiEntry } from '../test-fixtures/hearthkit-ui-entry.ts'
import { loadHearthkitUiEntry, uiComponentsFromEntry } from '../test-fixtures/hearthkit-ui-entry.ts'
import {
  createUiGateUserEvent,
  openThemeModeToggleMenu,
} from '../test-fixtures/ui-gate-rendering.ts'

/**
 * One representative render per component family. The record is keyed by the contract's family
 * enum, so a family added to the contract fails to compile until it has a render gate here.
 */
const renderGateByComponentFamily: Record<
  UiComponentFamilyName,
  (entry: HearthkitUiEntry) => Promise<void>
> = {
  button: async (entry) => {
    const { Button } = uiComponentsFromEntry(entry, ['Button'])

    render(createElement(Button, { variant: 'destructive', size: 'sm' }, 'Delete the project'))

    const button = screen.getByRole('button', { name: 'Delete the project' })
    expect(button.tagName).toBe('BUTTON')
  },

  card: async (entry) => {
    const { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } =
      uiComponentsFromEntry(entry, [
        'Card',
        'CardHeader',
        'CardTitle',
        'CardDescription',
        'CardContent',
        'CardFooter',
      ])

    render(
      createElement(
        Card,
        null,
        createElement(
          CardHeader,
          null,
          createElement(CardTitle, null, 'Project alpha'),
          createElement(CardDescription, null, 'Shipping this week'),
        ),
        createElement(CardContent, null, 'Three open pull requests'),
        createElement(CardFooter, null, 'Updated an hour ago'),
      ),
    )

    for (const cardText of [
      'Project alpha',
      'Shipping this week',
      'Three open pull requests',
      'Updated an hour ago',
    ]) {
      expect(screen.getByText(cardText).textContent).toBe(cardText)
    }
  },

  input: async (entry) => {
    const { Input } = uiComponentsFromEntry(entry, ['Input'])
    const user = createUiGateUserEvent()

    render(createElement(Input, { type: 'email', placeholder: 'Email address' }))

    const input = screen.getByPlaceholderText('Email address')
    expect(input.tagName).toBe('INPUT')
    await user.type(input, 'ada@example.test')
    expect((input as HTMLInputElement).value).toBe('ada@example.test')
  },

  label: async (entry) => {
    const { Label, Input } = uiComponentsFromEntry(entry, ['Label', 'Input'])

    render(
      createElement(
        'div',
        null,
        createElement(Label, { htmlFor: 'gate-email' }, 'Email address'),
        createElement(Input, { id: 'gate-email' }),
      ),
    )

    // The label is only useful if it names the control, so the gate looks the control up by label.
    expect(screen.getByLabelText('Email address').tagName).toBe('INPUT')
  },

  dialog: async (entry) => {
    const {
      Dialog,
      DialogTrigger,
      DialogContent,
      DialogHeader,
      DialogTitle,
      DialogDescription,
      DialogFooter,
    } = uiComponentsFromEntry(entry, [
      'Dialog',
      'DialogTrigger',
      'DialogContent',
      'DialogHeader',
      'DialogTitle',
      'DialogDescription',
      'DialogFooter',
    ])
    const user = createUiGateUserEvent()

    render(
      createElement(
        Dialog,
        null,
        createElement(DialogTrigger, null, 'Delete the project'),
        createElement(
          DialogContent,
          null,
          createElement(
            DialogHeader,
            null,
            createElement(DialogTitle, null, 'Delete the project?'),
            createElement(DialogDescription, null, 'This cannot be undone.'),
          ),
          createElement(DialogFooter, null, 'Confirm or cancel'),
        ),
      ),
    )

    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Delete the project' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete the project?').textContent).toBe('Delete the project?')
    expect(within(dialog).getByText('This cannot be undone.').textContent).toBe(
      'This cannot be undone.',
    )
    expect(within(dialog).getByText('Confirm or cancel').textContent).toBe('Confirm or cancel')
  },

  'dropdown-menu': async (entry) => {
    const {
      DropdownMenu,
      DropdownMenuTrigger,
      DropdownMenuContent,
      DropdownMenuItem,
      DropdownMenuLabel,
      DropdownMenuSeparator,
    } = uiComponentsFromEntry(entry, [
      'DropdownMenu',
      'DropdownMenuTrigger',
      'DropdownMenuContent',
      'DropdownMenuItem',
      'DropdownMenuLabel',
      'DropdownMenuSeparator',
    ])
    const user = createUiGateUserEvent()

    render(
      createElement(
        DropdownMenu,
        null,
        createElement(DropdownMenuTrigger, null, 'Open the account menu'),
        createElement(
          DropdownMenuContent,
          null,
          createElement(DropdownMenuLabel, null, 'My account'),
          createElement(DropdownMenuSeparator, null),
          createElement(DropdownMenuItem, null, 'Sign out'),
        ),
      ),
    )

    expect(screen.queryByRole('menuitem')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open the account menu' }))

    const menuItem = await screen.findByRole('menuitem', { name: 'Sign out' })
    expect(menuItem.textContent).toBe('Sign out')
    expect(screen.getByText('My account').textContent).toBe('My account')
  },

  layout: async (entry) => {
    const { PageContainer, PageHeader, Button } = uiComponentsFromEntry(entry, [
      'PageContainer',
      'PageHeader',
      'Button',
    ])

    render(
      createElement(
        PageContainer,
        null,
        createElement(
          PageHeader,
          { pageTitle: 'Projects', pageDescription: 'Everything you are shipping' },
          createElement(Button, null, 'New project'),
        ),
      ),
    )

    // pageTitle is contract-bound to a heading element, so the gate looks it up by heading role.
    expect(screen.getByRole('heading', { name: 'Projects' }).textContent).toBe('Projects')
    expect(screen.getByText('Everything you are shipping').textContent).toBe(
      'Everything you are shipping',
    )
    expect(screen.getByRole('button', { name: 'New project' }).tagName).toBe('BUTTON')
  },

  'theme-mode': async (entry) => {
    const { ThemeModeProvider, ThemeModeToggle } = uiComponentsFromEntry(entry, [
      'ThemeModeProvider',
      'ThemeModeToggle',
    ])

    const user = createUiGateUserEvent()

    render(createElement(ThemeModeProvider, null, createElement(ThemeModeToggle, null)))

    // The toggle is a DropdownMenu with a button trigger and exactly the three labelled items.
    expect(screen.getByRole('button').tagName).toBe('BUTTON')
    const menuItems = await openThemeModeToggleMenu(user)
    expect(menuItems.map((menuItem) => (menuItem.textContent ?? '').trim())).toEqual([
      ...themeModeToggleOptionLabels,
    ])
  },
}

describe('@hearthkit/ui component families', () => {
  it.each([...uiComponentFamilyNames])(
    'renders the %s family from the package entry',
    async (familyName) => {
      const entry = await loadHearthkitUiEntry()
      await renderGateByComponentFamily[familyName](entry)
    },
  )
})
