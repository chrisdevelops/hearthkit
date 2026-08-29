import { z } from 'zod'

/** Unique literal prefix of the error thrown when useThemeMode or ThemeModeToggle runs outside ThemeModeProvider. */
export const themeProviderMissingErrorPrefix = 'hearthkit ui theme provider missing:'

/** Class name on the document root element that switches every theme token to its dark value. */
export const darkModeClassName = 'dark'

/** File name of the base theme stylesheet at src/hearthkit-theme.css, exported at the package subpath @hearthkit/ui/hearthkit-theme.css. */
export const hearthkitThemeCssFileName = 'hearthkit-theme.css'

/** Exact specifier an app's globals.css must @import for the theme stylesheet; kept in one place so the scaffolder, template, and docs never drift. */
export const hearthkitThemeCssImportSpecifier = '@hearthkit/ui/hearthkit-theme.css'

/** Every subpath the package manifest must publish in its exports map; ./ui-contract is the JSX-free one Node-executed callers import. */
export const hearthkitUiPackageExportSubpaths = [
  '.',
  './hearthkit-theme.css',
  './ui-contract',
] as const

/** Exact specifier a Node-executed caller imports these constants from; kept in one place so the template, the scaffolder, and the docs never drift. */
export const hearthkitUiContractImportSpecifier = '@hearthkit/ui/ui-contract'

/** Literal @source line an app adds to its globals.css so Tailwind v4 scans this package's class strings. */
export const tailwindSourceDirectiveForUi = '@source "../node_modules/@hearthkit/ui";'

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

/** Theme token name; gates use this enum to verify hearthkit-theme.css defines every token. */
export const hearthkitThemeTokenNameSchema = z.enum(hearthkitThemeTokenNames)

/** One of the canonical theme token names, for example '--primary'. */
export type HearthkitThemeTokenName = z.infer<typeof hearthkitThemeTokenNameSchema>

/** Every theme token the .dark block must redefine; all tokens except --radius, which is mode-independent. */
export const darkModeOverriddenTokenNames = hearthkitThemeTokenNames.filter(
  (tokenName): tokenName is Exclude<HearthkitThemeTokenName, '--radius'> =>
    tokenName !== '--radius',
)

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

/** Component families this package ships; gates render at least one component per family. */
export const uiComponentFamilyNames = [
  'button',
  'card',
  'input',
  'label',
  'dialog',
  'dropdown-menu',
  'layout',
  'theme-mode',
] as const

/** Component family name; the unit gates iterate over when checking rendering. */
export const uiComponentFamilyNameSchema = z.enum(uiComponentFamilyNames)

/** One of the shipped component family names, for example 'dropdown-menu'. */
export type UiComponentFamilyName = z.infer<typeof uiComponentFamilyNameSchema>

/** Minimum export surface of the package entry point; the implementor may export more shadcn sub-parts, never fewer. */
export const hearthkitUiMinimumExportNames = [
  'Button',
  'buttonVariants',
  'Card',
  'CardHeader',
  'CardTitle',
  'CardDescription',
  'CardContent',
  'CardFooter',
  'Input',
  'Label',
  'Dialog',
  'DialogTrigger',
  'DialogContent',
  'DialogHeader',
  'DialogTitle',
  'DialogDescription',
  'DialogFooter',
  'DropdownMenu',
  'DropdownMenuTrigger',
  'DropdownMenuContent',
  'DropdownMenuItem',
  'DropdownMenuLabel',
  'DropdownMenuSeparator',
  'PageContainer',
  'PageHeader',
  'ThemeModeProvider',
  'ThemeModeToggle',
  'useThemeMode',
  'mergeTailwindClasses',
  'hearthkitThemeCssImportSpecifier',
  'hearthkitUiContractImportSpecifier',
] as const

/** Every way this package can fail at runtime; component misuse is otherwise a build-time type error. */
export const uiFailureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('theme-provider-missing'),
    message: z.string().startsWith(themeProviderMissingErrorPrefix),
  }),
])

/** Discriminated runtime failure union; the single variant is thrown as an Error, not returned, because hooks cannot return failures. */
export type UiFailure = z.infer<typeof uiFailureSchema>
