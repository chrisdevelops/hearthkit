/**
 * Public entry point of @hearthkit/ui: a named re-export of exactly the forty-seven values
 * CONTRACT.md "Package entry point" allowlists, so no internal module is importable by consumers and
 * grepping a symbol lands on the module that defines it. There is no `export *`. The theme
 * stylesheet is not re-exported from here; apps import it as `@hearthkit/ui/hearthkit-theme.css`.
 */

/** The button every page uses, and the cva recipe a shadowed copy of it imports to keep the package's variant classes. */
export { Button, buttonVariants } from './components/ui/button.tsx'

/** The card family the template home and dashboard lay content out with. */
export {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './components/ui/card.tsx'

/** The two form controls the template's forms and sign-in are built from. */
export { Input } from './components/ui/input.tsx'
export { Label } from './components/ui/label.tsx'

/** The dialog family confirmations are built from; DialogContent renders through DialogPortal itself. */
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

/** The dropdown-menu family behind the theme toggle and the user menu. */
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

/** Layout primitives that give every page the same chrome without an app forking the package. */
export { PageContainer } from './page-container.tsx'
export { PageHeader } from './page-header.tsx'

/** Light/dark mode: the provider an app wraps itself in, the hook it reads the mode with, and the toggle. */
export { ThemeModeProvider, useThemeMode } from './theme-mode-provider.tsx'
export { ThemeModeToggle } from './theme-mode-toggle.tsx'

/** The shared class-merge helper, so a component copied into an app imports it instead of re-creating it. */
export { mergeTailwindClasses } from './merge-tailwind-classes.ts'

/** Contract values: the theme mode vocabulary and the failure union, none of which is parsed at runtime. */
export { resolvedThemeModeSchema, themeModeSchema, uiFailureSchema } from './ui-contract.ts'

/** Contract values: the two literals an app's globals.css needs, read by templates/app to build that file. */
export { hearthkitThemeCssImportSpecifier, tailwindSourceDirectiveForUi } from './ui-contract.ts'

/** Contract types: the selected and resolved theme modes, the useThemeMode return shape, and the failure union. */
export type { ResolvedThemeMode, ThemeMode, UiFailure, UseThemeModeResult } from './ui-contract.ts'
