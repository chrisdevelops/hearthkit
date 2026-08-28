/**
 * Public entry point of @hearthkit/ui. Every export is named: there is no `export *`, so grepping a
 * symbol lands on the module that defines it. The theme stylesheet is not re-exported from here;
 * apps import it as `@hearthkit/ui/hearthkit-theme.css`.
 */

export { Button, buttonVariants } from './components/ui/button.tsx'
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/ui/card.tsx'
export { Input } from './components/ui/input.tsx'
export { Label } from './components/ui/label.tsx'
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog.tsx'
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu.tsx'

export { PageContainer } from './page-container.tsx'
export { PageHeader } from './page-header.tsx'
export { ThemeModeProvider, useThemeMode } from './theme-mode-provider.tsx'
export { ThemeModeToggle } from './theme-mode-toggle.tsx'
export { mergeTailwindClasses } from './merge-tailwind-classes.ts'

export {
  darkModeClassName,
  darkModeOverriddenTokenNames,
  hearthkitThemeCssFileName,
  hearthkitThemeCssImportSpecifier,
  hearthkitThemeTokenNameSchema,
  hearthkitThemeTokenNames,
  hearthkitUiMinimumExportNames,
  resolvedThemeModeSchema,
  tailwindSourceDirectiveForUi,
  themeModeSchema,
  themeModeToggleOptionLabels,
  themeProviderMissingErrorPrefix,
  uiComponentFamilyNameSchema,
  uiComponentFamilyNames,
  uiFailureSchema,
} from './ui-contract.ts'
export type {
  HearthkitThemeTokenName,
  ResolvedThemeMode,
  ThemeMode,
  UiComponentFamilyName,
  UiFailure,
  UseThemeModeResult,
} from './ui-contract.ts'
