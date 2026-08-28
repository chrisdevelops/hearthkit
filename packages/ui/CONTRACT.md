# @hearthkit/ui — contract

## Purpose

shadcn components, base theme, layout primitives, and light/dark mode for every hearthkit app. Apps import React components from this package and one base stylesheet, `hearthkit-theme.css`, which defines every theme token as a CSS custom property in `:root` and overrides them under the `.dark` class. Apps customize by overriding those variables in their own `globals.css`; they never edit package component files. The package is the single place shadcn components live so fixes propagate with `pnpm up` (guiding rule 2).

## Inputs

None at runtime. No environment variables — this package exports **no** env schema fragment, and nothing here calls `@hearthkit/config`.

What an app must do to consume the package (enforced by gates and documented in `docs/theming.md`, written by the implementor):

1. Import the base stylesheet in `globals.css`, after Tailwind: `@import '@hearthkit/ui/hearthkit-theme.css';`
2. Add the `@source` line so Tailwind v4 scans the package's class strings (`node_modules` is ignored by default): the exact literal is exported as `tailwindSourceDirectiveForUi` — `@source "../node_modules/@hearthkit/ui";` (path relative to the app's `globals.css`).
3. Wrap the app in `ThemeModeProvider` if it uses dark mode or `ThemeModeToggle`.

### Component props

React component props are compile-time contracts (TypeScript), not runtime Zod schemas. Each shadcn component keeps its upstream prop surface (standard HTML props plus shadcn variants such as `variant` and `size` on `Button`). Layout primitives:

- `PageContainer` — `children`, optional `className`. Centered max-width container with responsive padding.
- `PageHeader` — `pageTitle: string` (renders as a heading element, ARIA role `heading`), optional `pageDescription: string`, optional `children` (right-aligned actions), optional `className`.
- `ThemeModeProvider` — `children`; wraps `next-themes` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`.
- `ThemeModeToggle` — no required props. It is a `DropdownMenu` whose trigger is a button, with exactly three menu items whose accessible names are exactly `Light`, `Dark`, and `System` (exported as `themeModeToggleOptionLabels`); choosing one sets the matching mode.
- `useThemeMode()` — no parameters; must be called under `ThemeModeProvider`; returns `{ themeMode, setThemeMode, resolvedThemeMode }` (see Outputs).
- `mergeTailwindClasses(...classInputs)` — clsx-style inputs; the shared class-merge helper (shadcn's `cn`) so an app that copies a single component can import it instead of re-creating it.

## Outputs

### Components (minimum export surface)

The initial set is the smallest one the app template and its later flows (sign-in in Phase 5, checkout button, confirmations, user/theme menus) actually need. Anything else is added later via the shadcn CLI (theming rule 4), which is additive.

| Family          | Guaranteed exports                                                                                                             | Why it ships now                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `button`        | `Button`                                                                                                                       | every page                                 |
| `card`          | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`                                              | template home/dashboard                    |
| `input`         | `Input`                                                                                                                        | forms (sign-in, Phase 5)                   |
| `label`         | `Label`                                                                                                                        | forms                                      |
| `dialog`        | `Dialog`, `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`                 | confirmations                              |
| `dropdown-menu` | `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuLabel`, `DropdownMenuSeparator` | theme toggle, user menu                    |
| layout          | `PageContainer`, `PageHeader`                                                                                                  | consistent page chrome without an app fork |
| theme mode      | `ThemeModeProvider`, `ThemeModeToggle`, `useThemeMode`                                                                         | light/dark mode is in the package purpose  |
| utility         | `mergeTailwindClasses`                                                                                                         | copied components need the class merger    |

This is a **minimum** surface: shadcn generates extra sub-parts (for example `CardAction`, `DialogOverlay`, `DropdownMenuGroup`); the implementor exports those too, by name. The guaranteed names above are machine-checkable via `hearthkitUiMinimumExportNames` in `ui-contract.ts`.

Component families are enumerated in `uiComponentFamilyNames` so gates can assert each family renders.

### Theme mode API

`useThemeMode()` returns `{ themeMode, setThemeMode, resolvedThemeMode }`:

- `themeMode: ThemeMode` — the selected mode: `light`, `dark`, or `system`.
- `setThemeMode(mode: ThemeMode): void` — changes the selected mode.
- `resolvedThemeMode: 'light' | 'dark' | undefined` — the effective mode with `system` resolved to the OS preference; `undefined` before hydration completes.

The shape is exported as the type `UseThemeModeResult`; the resolved enum is `resolvedThemeModeSchema` in `ui-contract.ts` (documentation for gates — nothing runtime-parses it).

### `hearthkit-theme.css`

On disk the stylesheet is `packages/ui/src/hearthkit-theme.css`; `package.json` `exports` maps it to the subpath `@hearthkit/ui/hearthkit-theme.css`, so apps never import a file path inside the package. It contains, in plain CSS that Tailwind v4 processes when the app imports it:

1. `:root { … }` defining **every** token in `hearthkitThemeTokenNames` (32 tokens — the current shadcn vocabulary: `--background`/`--foreground`, `--card`(+`-foreground`), `--popover`(+`-foreground`), `--primary`(+`-foreground`), `--secondary`(+`-foreground`), `--muted`(+`-foreground`), `--accent`(+`-foreground`), `--destructive`, `--border`, `--input`, `--ring`, `--chart-1`…`--chart-5`, `--sidebar` family, `--radius`).
2. `.dark { … }` redefining every token in `darkModeOverriddenTokenNames` (all of the above except `--radius`, which is mode-independent).
3. The `@theme inline` bridge mapping the tokens into Tailwind utilities (`bg-primary`, `text-muted-foreground`, and so on), and registration of the `dark` variant against the `.dark` class so `dark:` utilities follow the class, not the media query.

Sidebar and chart tokens ship even though no sidebar or chart component ships yet, so adding those components later via the shadcn CLI needs no theme change.

### Package entry point

The public entry is `src/index.ts`, a thin named re-export (no `export *`). It re-exports by name: every component listed above, and from `ui-contract.ts`: `hearthkitThemeTokenNames`, `hearthkitThemeTokenNameSchema`, `darkModeOverriddenTokenNames`, `darkModeClassName`, `hearthkitThemeCssFileName`, `tailwindSourceDirectiveForUi`, `themeModeSchema`, `resolvedThemeModeSchema`, `themeModeToggleOptionLabels`, `uiComponentFamilyNames`, `uiComponentFamilyNameSchema`, `hearthkitUiMinimumExportNames`, `themeProviderMissingErrorPrefix`, `uiFailureSchema`, and types `HearthkitThemeTokenName`, `ThemeMode`, `ResolvedThemeMode`, `UseThemeModeResult`, `UiComponentFamilyName`, `UiFailure`. `package.json` `exports` maps `.` to the entry and `./hearthkit-theme.css` to the stylesheet; no other subpaths in this phase.

Distribution must keep Tailwind class strings visible to `@source` scanning: whatever the implementor publishes (source or transpiled), the files under the package root that `@source "../node_modules/@hearthkit/ui"` scans must contain the literal class strings.

## Failure modes

Per the plan, runtime failure modes are essentially not applicable: invalid props are build-time type errors, and a missing token or class is a gate failure, not a runtime error. One real runtime failure exists and is contract:

| `kind`                   | When                                                                    | Behavior                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `theme-provider-missing` | `useThemeMode` or `ThemeModeToggle` is used outside `ThemeModeProvider` | Throws an `Error` whose message starts with `hearthkit ui theme provider missing:` (`themeProviderMissingErrorPrefix`) |

It is thrown, not returned, because a React hook cannot usefully return a failure union. `uiFailureSchema` (`UiFailure`) captures it for gates.

Everything else that can go wrong is a build-time or gate-time check:

- A token missing from `:root` or `.dark` in `hearthkit-theme.css` — gate compares the file against `hearthkitThemeTokenNames` / `darkModeOverriddenTokenNames`.
- A guaranteed export missing from the entry — gate compares against `hearthkitUiMinimumExportNames`.
- A component failing to render in Vitest browser/jsdom — gate per family in `uiComponentFamilyNames`.
- Theme token overrides in a test CSS file must change computed styles; toggling dark mode must switch the `darkModeClassName` (`dark`) class on the root element, and the three `ThemeModeToggle` items must carry the accessible names in `themeModeToggleOptionLabels`.

## Dependencies

- Packages: none. `ui` is a root of the dependency graph; it must not import `@hearthkit/config` or any other hearthkit package.
- Services: none. Gates need only Node and a Vitest browser/jsdom environment — no Postgres, MinIO, Mailpit, or Stripe.
- Third-party runtime libraries (implementor adds, exact pins): `react`/`react-dom` 19 as peer dependencies; the Radix primitives shadcn generates for dialog and dropdown-menu; `class-variance-authority`, `clsx`, `tailwind-merge`; `next-themes` (works in any React DOM app, not only Next.js); `lucide-react` for the toggle icons. `tailwindcss` v4 is a dependency of the consuming app, never of this package — the package ships tokens and class strings, the app generates the utilities.

## Out of scope

- **Form state.** No `react-hook-form` wiring and no `Form` components in this phase; `Label` + `Input` + `Button` cover the template's forms. Form machinery is added later via the shadcn CLI, which is additive.
- **Sidebar, chart, table, select, toast and every other shadcn component.** Deliberately not shipped yet; theming rule 4 (add via shadcn CLI, then publish) keeps them open, and the sidebar/chart tokens are already in the theme so no token migration is ever needed.
- **`docs/theming.md` and the shadowed-component example.** Written by the implementor in Phase 3 (docs) and demonstrated in the scratch app / template, not inside this package. The rules it must document are fixed by this contract: CSS-variable overrides from app `globals.css`; `@source` scanning of this package; copy a single component into the app only for structural changes; new components enter via the shadcn CLI and are published.
- **Fonts and app-level styles.** The theme defines no font-face and no `--font-*` tokens; apps own typography in their `globals.css`.
- **Next.js-specific code.** No imports from `next/*`; components must render in plain React DOM (that is what the gates use).
- **Deferred features (plan section 13).** No entry in the deferred table depends on `ui`, and nothing here blocks one: preview environments, billing, passkeys, secrets, per-project Postgres, multi-region, and org billing are all invisible to a component library. The design additionally keeps open: app theme overrides without republishing (tokens are plain CSS variables), structural forks without a package change (copy-single-component), and new components without breaking changes (additive exports).

## Verified

Checked 2026-08-27:

- Tailwind v4 `@source` directive registers extra scan paths and is the documented way to include a library under `node_modules` (ignored by default): `@source "../node_modules/@acmecorp/ui-lib";` — https://tailwindcss.com/docs/detecting-classes-in-source-files
- shadcn theming token vocabulary (`--background`/`--foreground` pairs, `--destructive`, `--border`, `--input`, `--ring`, `--chart-1..5`, `--sidebar` family, `--radius`), dark mode by overriding the same tokens inside a `.dark` selector, and `@theme inline` exposing the variables to Tailwind utility generation — https://ui.shadcn.com/docs/theming. Note: the current canonical list has **no** `--destructive-foreground`; this contract follows the docs.
- shadcn CLI fully supports Tailwind v4 init and the `@theme` / `@theme inline` directives — https://ui.shadcn.com/docs/tailwind-v4
- shadcn dark mode for React apps uses `next-themes` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`; the toggled class on the root element is `dark` — https://ui.shadcn.com/docs/dark-mode/next

Not yet verifiable: `packages/ui` has no `package.json`; the implementor adds `zod@4.4.3` (matching the workspace pin) so `ui-contract.ts` resolves. The contract file has no side effects on import.

## Decisions

Round-2 review outcomes (orchestrator, 2026-08-27). The four round-1 defaults were accepted:

1. shadcn-generated components keep their canonical single-word names (`Button`, `Card`, …); hearthkit-authored exports follow the 2-to-4-word rule.
2. The component set stands as listed in Outputs.
3. `tailwindSourceDirectiveForUi` is the literal `@source "../node_modules/@hearthkit/ui";`, matching the template's `app/globals.css` location.
4. `--destructive-foreground` stays omitted, matching the current shadcn vocabulary; if a generated component ever references it, the token list gains one entry (additive; gates and theme update together).

The same round pinned four gate-writer ambiguities, now in the body above: the `useThemeMode` return shape (Theme mode API), the on-disk stylesheet path (`packages/ui/src/hearthkit-theme.css`), the `ThemeModeToggle` structure and its accessible item names, and `PageHeader`'s `pageTitle` rendering as a heading element.
