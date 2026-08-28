'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from 'next-themes'

import type { ResolvedThemeMode, ThemeMode, UseThemeModeResult } from './ui-contract.ts'
import {
  resolvedThemeModeSchema,
  themeModeSchema,
  themeProviderMissingErrorPrefix,
} from './ui-contract.ts'

/**
 * next-themes returns a silent default when its own hook runs outside a provider, so this context
 * is the guard: only ThemeModeProvider sets it to true, and useThemeMode throws when it is false.
 */
const themeModeProviderPresence = createContext(false)

/** Props of ThemeModeProvider; every theme option is fixed by the contract, so there are none but children. */
type ThemeModeProviderProps = {
  children?: ReactNode
}

/** Wraps next-themes with the hearthkit settings; mount it once, above anything calling useThemeMode. */
export function ThemeModeProvider({ children }: ThemeModeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <themeModeProviderPresence.Provider value={true}>
        {children}
      </themeModeProviderPresence.Provider>
    </NextThemesProvider>
  )
}

/** Narrows what next-themes stored to a contract theme mode, falling back to the default, system. */
function themeModeFromStoredValue(storedValue: string | undefined): ThemeMode {
  return themeModeSchema.options.find((themeMode) => themeMode === storedValue) ?? 'system'
}

/** Narrows the effective theme to light or dark; undefined until next-themes resolves it after hydration. */
function resolvedThemeModeFromValue(
  resolvedValue: string | undefined,
): ResolvedThemeMode | undefined {
  return resolvedThemeModeSchema.options.find((themeMode) => themeMode === resolvedValue)
}

/** Reads and changes the theme mode; throws the theme-provider-missing error outside ThemeModeProvider. */
export function useThemeMode(): UseThemeModeResult {
  const isInsideThemeModeProvider = useContext(themeModeProviderPresence)
  const { theme, setTheme, resolvedTheme } = useNextTheme()

  if (!isInsideThemeModeProvider) {
    throw new Error(
      `${themeProviderMissingErrorPrefix} render ThemeModeProvider above the component calling useThemeMode or rendering ThemeModeToggle`,
    )
  }

  return {
    themeMode: themeModeFromStoredValue(theme),
    setThemeMode: setTheme,
    resolvedThemeMode: resolvedThemeModeFromValue(resolvedTheme),
  }
}
