import { z } from 'zod'

/** Unique literal prefix of the error thrown when useThemeMode or ThemeModeToggle runs outside ThemeModeProvider. */
export const themeProviderMissingErrorPrefix = 'hearthkit ui theme provider missing:'

/** Exact specifier an app's globals.css must @import for the theme stylesheet; kept in one place so the scaffolder, template, and docs never drift. */
export const hearthkitThemeCssImportSpecifier = '@hearthkit/ui/hearthkit-theme.css'

/** Literal @source line an app adds to its globals.css so Tailwind v4 scans this package's class strings. */
export const tailwindSourceDirectiveForUi = '@source "../node_modules/@hearthkit/ui";'

/** Theme mode a user can select through ThemeModeToggle; system follows the OS preference. */
export const themeModeSchema = z.enum(['light', 'dark', 'system'])

/** Selected theme mode as stored by ThemeModeProvider. */
export type ThemeMode = z.infer<typeof themeModeSchema>

/** Effective theme after 'system' resolves to the OS preference; before hydration the hook reports undefined instead. */
export const resolvedThemeModeSchema = z.enum(['light', 'dark'])

/** Effective light-or-dark mode with 'system' resolved. */
export type ResolvedThemeMode = z.infer<typeof resolvedThemeModeSchema>

/** Return shape of useThemeMode; resolvedThemeMode is undefined until hydration completes. */
export type UseThemeModeResult = {
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void
  resolvedThemeMode: ResolvedThemeMode | undefined
}

/** Accessible names of the exactly three ThemeModeToggle menu items, in menu order. */
export const themeModeToggleOptionLabels = ['Light', 'Dark', 'System'] as const

/** Every way this package can fail at runtime; component misuse is otherwise a build-time type error. */
export const uiFailureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('theme-provider-missing'),
    message: z.string().startsWith(themeProviderMissingErrorPrefix),
  }),
])

/** Discriminated runtime failure union; the single variant is thrown as an Error, not returned, because hooks cannot return failures. */
export type UiFailure = z.infer<typeof uiFailureSchema>
