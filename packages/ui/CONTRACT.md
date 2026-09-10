# @hearthkit/ui — contract

## Purpose

shadcn components, base theme, layout primitives, and light/dark mode for every hearthkit app. Apps import React components from this package and one base stylesheet, `hearthkit-theme.css`, which defines every theme token as a CSS custom property in `:root` and overrides them under the `.dark` class. Apps customize by overriding those variables in their own `globals.css`; they never edit package component files. The package is the single place shadcn components live so fixes propagate with `pnpm up` (guiding rule 2).

## Inputs

None at runtime. No environment variables — this package exports **no** env schema fragment, and nothing here calls `@hearthkit/config`.

What an app must do to consume the package (enforced by gates and documented in `docs/theming.md`, written by the implementor):

1. Import the base stylesheet in `globals.css`, after Tailwind: `@import '@hearthkit/ui/hearthkit-theme.css';` — the exact specifier is exported as `hearthkitThemeCssImportSpecifier`.
2. Add the `@source` line so Tailwind v4 scans the package's class strings (`node_modules` is ignored by default): the exact literal is exported as `tailwindSourceDirectiveForUi` — `@source "../node_modules/@hearthkit/ui";` (path relative to the app's `globals.css`).
3. Wrap the app in `ThemeModeProvider` if it uses dark mode or `ThemeModeToggle`.

### Component props

React component props are compile-time contracts (TypeScript), not runtime Zod schemas. Each shadcn component keeps its upstream prop surface (standard HTML props plus shadcn variants such as `variant` and `size` on `Button`). Layout primitives:

- `PageContainer` — `children`, optional `className`. Centered max-width container with responsive padding.
- `PageHeader` — `pageTitle: string` (renders as a heading element, ARIA role `heading`), optional `pageDescription: string`, optional `children` (right-aligned actions), optional `className`.
- `ThemeModeProvider` — `children`; wraps `next-themes` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`.
- `ThemeModeToggle` — no required props. It is a `DropdownMenu` whose trigger is a button, with exactly three menu items whose accessible names are exactly `Light`, `Dark`, and `System` (the internal constant `themeModeToggleOptionLabels`); choosing one sets the matching mode.
- `useThemeMode()` — no parameters; must be called under `ThemeModeProvider`; returns `{ themeMode, setThemeMode, resolvedThemeMode }` (see Outputs).
- `mergeTailwindClasses(...classInputs)` — clsx-style inputs; the shared class-merge helper (shadcn's `cn`) so an app that copies a single component can import it instead of re-creating it.

## Outputs

### Components

The set is the smallest one the app template and its later flows need. Nine families ship: `button` (every page), `card` (template home and dashboard), `input` and `label` (forms, sign-in), `dialog` (confirmations), `dropdown-menu` (theme toggle, user menu), layout (consistent page chrome without an app fork), theme mode (in the package purpose), and the utility class merger (copied components need it). Every exported name per family is listed under Package entry point. Anything else is added later via the shadcn CLI (theming rule 4).

**Variant recipes.** The shadowed-component workflow in `docs/theming.md` ("Shadowing a single component") imports a component's cva recipe so a structural fork keeps the package's variant classes. Any variant recipe that workflow makes public API is an exported name. Today that is exactly `buttonVariants`, the only `*Variants` recipe in the package; card, input, label, dialog, and dropdown-menu ship no cva recipe.

### Theme mode API

`useThemeMode()` returns `{ themeMode, setThemeMode, resolvedThemeMode }`:

- `themeMode: ThemeMode` — the selected mode: `light`, `dark`, or `system` (`themeModeSchema`).
- `setThemeMode(mode: ThemeMode): void` — changes the selected mode.
- `resolvedThemeMode: 'light' | 'dark' | undefined` — the effective mode with `system` resolved to the OS preference (`resolvedThemeModeSchema`); `undefined` before hydration completes.

The shape is exported as the type `UseThemeModeResult`. Nothing runtime-parses either schema; they document the values for gates and apps.

### `hearthkit-theme.css`

On disk the stylesheet is `packages/ui/src/hearthkit-theme.css`; `package.json` `exports` maps it to the subpath `@hearthkit/ui/hearthkit-theme.css`, so apps never import a file path inside the package. `hearthkitThemeCssImportSpecifier` (`'@hearthkit/ui/hearthkit-theme.css'`) is the exact specifier an app's `globals.css` must `@import`, kept in one place so the scaffolder, template, and docs never drift. The stylesheet contains, in plain CSS that Tailwind v4 processes when the app imports it:

1. `:root { … }` defining every one of the 32 theme tokens, the current shadcn vocabulary: `--background`/`--foreground`, `--card`(+`-foreground`), `--popover`(+`-foreground`), `--primary`(+`-foreground`), `--secondary`(+`-foreground`), `--muted`(+`-foreground`), `--accent`(+`-foreground`), `--destructive`, `--border`, `--input`, `--ring`, `--chart-1`…`--chart-5`, the `--sidebar` family (eight tokens), and `--radius`.
2. `.dark { … }` redefining every token except `--radius`, which is mode-independent. The class name is `dark`.
3. The `@theme inline` bridge mapping the tokens into Tailwind utilities (`bg-primary`, `text-muted-foreground`, and so on), and registration of the `dark` variant against the `.dark` class so `dark:` utilities follow the class, not the media query.

The machine-readable token list the theme gate compares the file against lives in `test-fixtures/`, not in the contract module: no app constructs a token name. Sidebar and chart tokens ship even though no sidebar or chart component ships yet, so adding those components later via the shadcn CLI needs no theme change.

### Package entry point

`src/index.ts` is the package entry, a thin named re-export (no `export *`). Its value exports are a fixed allowlist of exactly these forty-seven, and nothing else. Components, hooks and helpers (42), every one plan-named because plan 4.3's output is "React components":

1. `Button`
2. `buttonVariants`
3. `Card`
4. `CardAction`
5. `CardContent`
6. `CardDescription`
7. `CardFooter`
8. `CardHeader`
9. `CardTitle`
10. `Dialog`
11. `DialogClose`
12. `DialogContent`
13. `DialogDescription`
14. `DialogFooter`
15. `DialogHeader`
16. `DialogOverlay`
17. `DialogPortal`
18. `DialogTitle`
19. `DialogTrigger`
20. `DropdownMenu`
21. `DropdownMenuCheckboxItem`
22. `DropdownMenuContent`
23. `DropdownMenuGroup`
24. `DropdownMenuItem`
25. `DropdownMenuLabel`
26. `DropdownMenuPortal`
27. `DropdownMenuRadioGroup`
28. `DropdownMenuRadioItem`
29. `DropdownMenuSeparator`
30. `DropdownMenuShortcut`
31. `DropdownMenuSub`
32. `DropdownMenuSubContent`
33. `DropdownMenuSubTrigger`
34. `DropdownMenuTrigger`
35. `Input`
36. `Label`
37. `PageContainer`
38. `PageHeader`
39. `ThemeModeProvider`
40. `ThemeModeToggle`
41. `useThemeMode`
42. `mergeTailwindClasses`

Contract values (5), all defined in `ui-contract.ts`:

43. `themeModeSchema`: the input of `setThemeMode` and the selected mode
44. `resolvedThemeModeSchema`: the output of `useThemeMode`'s `resolvedThemeMode`
45. `uiFailureSchema`: the failure union
46. `hearthkitThemeCssImportSpecifier`: read by `templates/app`'s contract to build `globals.css`
47. `tailwindSourceDirectiveForUi`: same reader

Type exports are not counted and stay: `ThemeMode`, `ResolvedThemeMode`, `UseThemeModeResult`, `UiFailure`.

Every other value in `ui-contract.ts` is internal: `themeProviderMissingErrorPrefix` (the provider throws with it; `uiFailureSchema` embeds it) and `themeModeToggleOptionLabels` (the toggle renders them). The implementation and this package's own gates may import them from `./ui-contract.ts` directly, but they are not part of the public surface and may change without a changeset. Constants whose only reader was a gate live in `test-fixtures/` now, not in the contract module: the `dark` class name, the stylesheet file name, the token list and its dark-mode subset, the component family list, the manifest subpath list, the `@hearthkit/ui/ui-contract` specifier, and the entry allowlist above as an `as const` array.

`package.json` `exports` publishes exactly three subpaths:

- `.` → `src/index.ts`. Every app and every bundler-run consumer.
- `./hearthkit-theme.css` → `src/hearthkit-theme.css`. An app's `globals.css`, via `hearthkitThemeCssImportSpecifier`.
- `./ui-contract` → `src/ui-contract-entry.ts`. Node-executed scripts.

**The `./ui-contract` subpath.** It stays because `templates/app/src/app-template-contract.ts` imports the two theme constants from it, and that file is executed by bare `node`: the template's `verify:container` script and the `@hearthkit/create` bin's dynamic import of the section manifest. The `.` entry resolves through `.tsx` component modules, and bare Node refuses that extension outright (`ERR_UNKNOWN_FILE_EXTENSION`, measured, see Verified); no flag changes it. The subpath resolves to a JSX-free named re-export module, `src/ui-contract-entry.ts`, whose value exports are exactly the five contract values above (items 43 to 47) plus the four public types. It carries no component. **The obligation this places on the package: `src/ui-contract-entry.ts` and `src/ui-contract.ts` must stay JSX-free and must import nothing but `zod` at runtime** (the entry additionally imports `./ui-contract.ts`). A React or `.tsx` import breaks bare Node outright; any other non-`zod` import (a sibling hearthkit package, a `node:` builtin) loads perfectly well under bare Node while the rule is violated, and a sibling import also breaks the root-of-the-graph rule under Dependencies. That is why the runtime check and the static import check are separate gates and neither subsumes the other. One limit is Node's own: it refuses to strip types from a file whose resolved path sits under `node_modules`. Inside this workspace pnpm's symlink resolves to a real path outside `node_modules`, so it never bites; for a published install run by plain `node` it does, and handling that is a `create` packaging decision, not a change here.

Distribution must keep Tailwind class strings visible to `@source` scanning: whatever the implementor publishes (source or transpiled), the files under the package root that `@source "../node_modules/@hearthkit/ui"` scans must contain the literal class strings.

### shadcn CLI configuration

Theming rule 4 says new components are generated into this package with the shadcn CLI. For that command to work, two implementor-owned files are part of the package's contract surface (contents and procedure in `docs/theming.md`, "Adding a component to the package"):

1. `packages/ui/components.json` — the CLI's project configuration (Tailwind v4: empty `tailwind.config`, `css` pointing at `src/hearthkit-theme.css`, `utils` alias `@/merge-tailwind-classes`). Without it the CLI stops and offers interactive `init`.
2. A `@/*` → `./src/*` path alias in `packages/ui/tsconfig.json`. Without it the CLI silently writes the component into a literal directory named `@`.

With both in place, `pnpm dlx shadcn@latest add <component> --yes` run from `packages/ui` writes `src/components/ui/<component>.tsx`. Generated files never compile untouched: each needs its class-merge import fixed (`@/merge-tailwind-classes` → `../../merge-tailwind-classes.ts`) and `cn` call sites renamed to `mergeTailwindClasses`; regenerating with `--overwrite` strips doc comments. This is the standing trade-off and not a contract violation. A new component's exports join the allowlist above, which is a changeset.

## Failure modes

Per the plan, runtime failure modes are essentially not applicable: invalid props are build-time type errors, and a missing token or class is a gate failure, not a runtime error. One real runtime failure exists and is contract:

| `kind`                   | When                                                                    | Behavior                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `theme-provider-missing` | `useThemeMode` or `ThemeModeToggle` is used outside `ThemeModeProvider` | Throws an `Error` whose message starts with `hearthkit ui theme provider missing:` (`themeProviderMissingErrorPrefix`) |

It is thrown, not returned, because a React hook cannot usefully return a failure union. `uiFailureSchema` (`UiFailure`) captures it for gates.

Everything else that can go wrong is a build-time or gate-time check:

- A token missing from `:root` or `.dark` in `hearthkit-theme.css` — gate compares the file against the token list and its dark-mode subset in `test-fixtures/`.
- The entry exporting more or fewer values than the allowlist: gate compares the entry's value exports against the forty-seven-name `as const` array in `test-fixtures/`, exact match in both directions.
- A subpath missing from `package.json` `exports`, or `./ui-contract` pointing at the wrong file: gate compares the manifest against the subpath fixture and the `src/ui-contract-entry.ts` target.
- `./ui-contract` losing its bare-Node importability, or exporting anything beyond the five values and four types: gate imports the subpath specifier from a plain `node` process and compares its value exports; this fails the moment either module gains JSX or a `.tsx` import, and also catches resolution-level regressions (a wrong `exports` target, a broken symlink, a `zod` that no longer resolves).
- `src/ui-contract.ts` or `src/ui-contract-entry.ts` importing something other than `zod` (and, for the entry, `./ui-contract.ts`): gate reads each file's own import specifiers. Only the static check catches a sibling package or `node:` builtin.
- A component failing to render in Vitest browser/jsdom — gate per family in the family fixture.
- Theme token overrides in a test CSS file must change computed styles; toggling dark mode must switch the `dark` class on the root element, and the three `ThemeModeToggle` items must carry the accessible names in `themeModeToggleOptionLabels`.

## Dependencies

- Packages: none. `ui` is a root of the dependency graph; it must not import `@hearthkit/config` or any other hearthkit package.
- Services: none. Gates need only Node and a Vitest browser/jsdom environment — no Postgres, MinIO, Mailpit, or Stripe.
- Third-party runtime libraries (exact pins in `package.json`): `react`/`react-dom` 19 as peer dependencies; the Radix primitives shadcn generates for dialog and dropdown-menu; `class-variance-authority`, `clsx`, `tailwind-merge`; `next-themes` (works in any React DOM app, not only Next.js); `lucide-react` for the toggle icons; `zod` at the workspace pin so `ui-contract.ts` resolves. `tailwindcss` v4 is a dependency of the consuming app, never of this package — the package ships tokens and class strings, the app generates the utilities.

## Out of scope

- **Form state.** No `react-hook-form` wiring and no `Form` components; `Label` + `Input` + `Button` cover the template's forms. Form machinery is added later via the shadcn CLI.
- **Sidebar, chart, table, select, toast and every other shadcn component.** Deliberately not shipped yet; theming rule 4 keeps them open, and the sidebar/chart tokens are already in the theme so no token migration is ever needed.
- **`docs/theming.md` and the shadowed-component example.** Written by the implementor and demonstrated in the template, not inside this package. The rules it must document are fixed by this contract: CSS-variable overrides from app `globals.css`; `@source` scanning of this package; copy a single component into the app only for structural changes; new components enter via the shadcn CLI and are published.
- **Fonts and app-level styles.** The theme defines no font-face and no `--font-*` tokens; apps own typography in their `globals.css`.
- **Next.js-specific code.** No imports from `next/*`; components must render in plain React DOM (that is what the gates use).
- **Compiling `.tsx` for publication.** Vitest and Next transform, so gates and apps work; the JSX-free `./ui-contract` subpath serves anything Node-executed.
- **Deferred features (plan section 13).** No entry in the deferred table depends on `ui`, and nothing here blocks one. The design keeps open: app theme overrides without republishing (tokens are plain CSS variables), structural forks without a package change (copy-single-component), and new components as allowlist additions.

## Verified

Checked 2026-08-27:

- Tailwind v4 `@source` registers extra scan paths and is the documented way to include a library under `node_modules` (ignored by default) — https://tailwindcss.com/docs/detecting-classes-in-source-files
- shadcn theming token vocabulary, dark mode by overriding the same tokens inside `.dark`, and `@theme inline` exposing the variables to Tailwind utility generation — https://ui.shadcn.com/docs/theming. The current canonical list has **no** `--destructive-foreground`; this contract follows the docs.
- shadcn CLI fully supports Tailwind v4 init and the `@theme` / `@theme inline` directives — https://ui.shadcn.com/docs/tailwind-v4
- shadcn dark mode uses `next-themes` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`; the toggled root class is `dark` — https://ui.shadcn.com/docs/dark-mode/next

Checked 2026-08-29: Node's built-in type stripping runs `.ts`, `.mts`, and `.cts` and states that "`.tsx` files are unsupported"; the same page says Node "refuses to handle TypeScript files inside folders under a `node_modules` path" — https://nodejs.org/api/typescript.html

Measured by the orchestrator with bare `node` 24.20.0 on 2026-08-29, and not to be re-hedged: importing `@hearthkit/ui` fails with `ERR_UNKNOWN_FILE_EXTENSION` because the `.` entry re-exports `.tsx` modules and no flag makes Node accept that extension, while `packages/ui/src/ui-contract.ts` imports cleanly from bare Node, including through a consumer's symlinked `node_modules/@hearthkit/ui`. That measurement is the whole reason the `./ui-contract` subpath exists. Importing the contract module has no side effects, which is what makes the bare-Node subpath gate a pure resolution check.

## Decisions

1. shadcn-generated components keep their canonical single-word names (`Button`, `Card`, …); hearthkit-authored exports follow the 2-to-4-word rule (2026-08-27).
2. `tailwindSourceDirectiveForUi` is the literal `@source "../node_modules/@hearthkit/ui";`, matching the template's `app/globals.css` location (2026-08-27).
3. `--destructive-foreground` stays omitted, matching the current shadcn vocabulary; if a generated component ever references it, the token fixture and the theme gain one entry together (2026-08-27).
4. The `useThemeMode` return shape, the on-disk stylesheet path, the `ThemeModeToggle` structure and its accessible item names, and `PageHeader`'s `pageTitle` rendering as a heading element are fixed in the body above (2026-08-27). The shadcn CLI configuration became documented contract surface (2026-08-28). The `./ui-contract` subpath was added so Node-executed callers can import the theme constants without touching a `.tsx` module (2026-08-29).
5. **The entry point is a fixed allowlist, not "everything the contract module exports"** (completion plan step 5, 2026-09-09). The entry is trimmed to 47 values: 42 plan-named components, hooks and helpers, and 5 contract values. `./ui-contract` is kept and trimmed to the same 5 values because bare-node callers (`templates/app`'s contract, the `create` bin) need it. The error prefix and toggle labels stay internal in `ui-contract.ts`; the ten gate-only constants moved to `test-fixtures/`. Breaking within 0.x, minor changeset.
