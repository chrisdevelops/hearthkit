# @hearthkit/ui

## 0.3.0

### Minor Changes

- 5518613: Trim the public entry point of `@hearthkit/ui` to a fixed allowlist of 47 values: the 42 React components, hooks and helpers, plus `themeModeSchema`, `resolvedThemeModeSchema`, `uiFailureSchema`, `hearthkitThemeCssImportSpecifier` and `tailwindSourceDirectiveForUi`. The `./ui-contract` subpath stays for bare-node callers and now resolves to `src/ui-contract-entry.ts`, carrying only those five values and the four public types. Removed from both surfaces: `darkModeClassName`, `darkModeOverriddenTokenNames`, `hearthkitThemeCssFileName`, `hearthkitThemeTokenNameSchema`, `hearthkitThemeTokenNames`, `hearthkitUiContractImportSpecifier`, `hearthkitUiMinimumExportNames`, `hearthkitUiPackageExportSubpaths`, `themeModeToggleOptionLabels`, `themeProviderMissingErrorPrefix`, `uiComponentFamilyNameSchema`, `uiComponentFamilyNames`, and the types `HearthkitThemeTokenName` and `UiComponentFamilyName`. Gate-only constants moved to the package's test fixtures. Breaking within 0.x.

## 0.2.0

## 0.1.2

### Patch Changes

- 87ed532: Every package is licensed under MIT: a `LICENSE` file ships in each tarball and the manifest carries `"license": "MIT"`.

## 0.1.1

## 0.1.0

### Minor Changes

- 1047c7d: Guarantee `buttonVariants` as a public export, so the documented shadowed-component workflow can rely on it, and add `hearthkitThemeCssImportSpecifier` — the exact specifier an app's `globals.css` must import — so the scaffolder, template, and docs stop hardcoding the string. The package now also ships the shadcn CLI configuration (`components.json` and a `@/*` path alias) that `shadcn add` needs to write components into `src/components/ui/`.
- 108367b: New package: shadcn components (button, card, input, label, dialog, dropdown-menu), layout primitives (PageContainer, PageHeader), light/dark mode (ThemeModeProvider, ThemeModeToggle, useThemeMode), and hearthkit-theme.css defining every theme token as a CSS variable with a class-based dark variant.

### Patch Changes

- 8fa8810: `@hearthkit/config` is now a runtime `dependency` of `observability`, `storage`, `email`, `auth` and `payments`. Each imported it from `src/` but declared it only under `devDependencies`, which resolved through workspace hoisting and would fail on the first published install.

  Node is pinned to exactly `24.20.0` in `.nvmrc` and every `engines` field, matching the plan. CI reads the version from `.nvmrc`. The template ships its own `.nvmrc` and the same pin, and `appTemplateNodeVersion` carries the value in the template contract.

  Every `@hearthkit/*` package now versions as one fixed group, so a release bumps all of them together.

  Lint is now warning-free. Two small behaviour changes came with removing unsafe casts: `asEnvVariableName` in `config` throws on a key that is not SCREAMING_SNAKE_CASE, and `createHealthRouteHandler` in `observability` throws at boot when a caller bypasses the types with a health check whose name the contract rejects, instead of running it unvalidated.

- 1bc044f: Release tooling for the first publish (completion plan step 4.1). Every manifest gains `repository` and `homepage` pointing at the public repo, and a `prepublishOnly` guard that stops a publish when the package is private, still at 0.0.0, missing `src/index.ts`, or has an `exports` or `bin` target that does not exist or is outside `files`. The guard accepts the one JavaScript module `@hearthkit/config` ships. No runtime behaviour changes.
- cf0e84d: Publish a third package subpath, `@hearthkit/ui/ui-contract`, mapping to `src/ui-contract.ts`. Purely additive: the `.` entry still exports everything it did, and it now also re-exports the two new constants that name the subpath, `hearthkitUiPackageExportSubpaths` and `hearthkitUiContractImportSpecifier`.

  The `.` entry re-exports `.tsx` component modules, and bare Node refuses that extension outright, so until now no `node`-executed script could import anything that imported this package — however little of it that script actually wanted. `src/ui-contract.ts` imports only `zod` and contains no JSX, so the new subpath loads from plain `node`. That is what lets the app template's `verify:container` read its own contract instead of hand-mirroring its values.

  Two gates protect the property, because neither covers the whole of it: one spawns a real `node` process and imports the subpath, catching JSX and `.tsx` imports; the other reads the contract file's own import specifiers and holds them to `['zod']`, catching everything that would load fine under bare Node while still breaking the rule.
