/**
 * The ./ui-contract subpath of @hearthkit/ui: a JSX-free named re-export of the five contract values
 * and the four public types, and nothing that reaches a component. It exists because the `.` entry
 * transitively imports the `.tsx` component modules, which a bare `node` process refuses to load,
 * while this file and ui-contract.ts import only zod. That is the subpath templates/app's contract
 * imports and the @hearthkit/create bin loads from a plain node process.
 */

/** Contract values: the theme mode vocabulary and the failure union, none of which is parsed at runtime. */
export { resolvedThemeModeSchema, themeModeSchema, uiFailureSchema } from './ui-contract.ts'

/** Contract values: the two literals an app's globals.css needs, read by templates/app to build that file. */
export { hearthkitThemeCssImportSpecifier, tailwindSourceDirectiveForUi } from './ui-contract.ts'

/** Contract types: the selected and resolved theme modes, the useThemeMode return shape, and the failure union. */
export type { ResolvedThemeMode, ThemeMode, UiFailure, UseThemeModeResult } from './ui-contract.ts'
