'use client'

import { MoonIcon, SunIcon } from 'lucide-react'

import { Button } from './components/ui/button.tsx'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu.tsx'
import { useThemeMode } from './theme-mode-provider.tsx'
import type { ThemeMode } from './ui-contract.ts'
import { themeModeToggleOptionLabels } from './ui-contract.ts'

/** Accessible name of one toggle menu item, as pinned by the contract: Light, Dark or System. */
type ThemeModeToggleOptionLabel = (typeof themeModeToggleOptionLabels)[number]

/** Mode each menu item selects; a label added to the contract fails to compile until it is listed here. */
const themeModeByOptionLabel: Record<ThemeModeToggleOptionLabel, ThemeMode> = {
  Light: 'light',
  Dark: 'dark',
  System: 'system',
}

/** Dropdown of Light, Dark and System; must render under ThemeModeProvider or it throws on render. */
export function ThemeModeToggle() {
  const { setThemeMode } = useThemeMode()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <SunIcon className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <MoonIcon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themeModeToggleOptionLabels.map((optionLabel) => (
          <DropdownMenuItem
            key={optionLabel}
            onSelect={() => {
              setThemeMode(themeModeByOptionLabel[optionLabel])
            }}
          >
            {optionLabel}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
