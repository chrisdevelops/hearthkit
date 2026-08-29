# Theming this app

The look comes from `@hearthkit/ui`: shadcn components, a token set, layout primitives, and light
and dark mode. This document is the short version for a project. The full one, including how a
component gets into the package, lives in the hearthkit repository at `docs/theming.md`.

## The three rules

1. Customize by overriding CSS variables in `app/globals.css`. Never edit a file inside
   `node_modules/@hearthkit/ui`.
2. Keep the `@source` line in `app/globals.css`. Without it Tailwind never sees the package's class
   strings and generates none of its utilities.
3. When a component's markup itself has to change, copy that one component into this app and give
   it an app-specific name. That is the only case where component code belongs here.

## How the wiring works

Four files, all already written:

- `app/globals.css` imports Tailwind, then the hearthkit theme, then declares the package as a
  Tailwind source. Order matters, and the `@source` path assumes this file stays at
  `app/globals.css`, one level below the project root.
- `next.config.ts` lists every `@hearthkit/*` package in `transpilePackages`, because the packages
  ship TypeScript source rather than a build.
- `app/layout.tsx` wraps the app in `ThemeModeProvider` and sets `suppressHydrationWarning` on
  `<html>`, because the theme script writes the `dark` class onto that element before React
  hydrates.
- `postcss.config.mjs` registers `@tailwindcss/postcss`, the only plugin Tailwind v4 needs.

Tailwind v4 skips `node_modules` during automatic source detection. Dropping the `@source` line
still serves a 200 and the markup still carries the class names; the components simply render
unstyled. The Playwright smoke test asserts a real button background colour precisely to catch that.

## Changing colours, radius, and dark mode

Every colour and the corner radius is a plain CSS custom property. Override it in
`app/globals.css`, below the three imports:

```css
@import 'tailwindcss';
@import '@hearthkit/ui/hearthkit-theme.css';
@source "../node_modules/@hearthkit/ui";

:root {
  --primary: oklch(0.55 0.21 264);
  --primary-foreground: oklch(0.98 0.01 264);
  --radius: 0.25rem;
}

.dark {
  --primary: oklch(0.72 0.16 264);
  --primary-foreground: oklch(0.18 0.03 264);
}
```

Your block comes later in the cascade than the package's, at the same specificity, so it wins. The
generated utilities read the variable at paint time, so a token change reaches every component with
no rebuild of the package.

Notes that matter in practice:

- Override in both `:root` and `.dark`. A colour set only in `:root` keeps its light value in dark
  mode and usually breaks contrast there.
- `--radius` is the only mode-independent token. `rounded-sm`, `rounded-md`, `rounded-lg`, and
  `rounded-xl` all derive from it, so one line rescales the whole app.
- The theme defines no fonts. Typography belongs to this app.
- For a change no token can express, such as different padding on one button, pass `className` at
  the call site before reaching for rule 3.

## Dark mode

`ThemeModeProvider` fixes the settings: class-based dark mode, system default, no transition flash.
The class on `<html>` is `dark`, and `dark:` utilities in your own code follow that class rather
than the operating system media query.

`ThemeModeToggle` is a three-item dropdown, Light, Dark, and System. Drop it anywhere under the
provider; the home page puts it in the actions slot of `PageHeader`. `useThemeMode()` returns
`{ themeMode, setThemeMode, resolvedThemeMode }`, and `resolvedThemeMode` is `undefined` until
hydration finishes, so branch on it only after that.

Both throw an error starting with `hearthkit ui theme provider missing:` when rendered outside the
provider.

## Copying one component

Rule 3. Use it when the markup has to change: a required new slot, a different element structure, an
extra wrapper. Do not use it for colours, spacing, or radius.

- Put it in this app, in a file named after what it is, for example
  `app/components/icon-leading-button.tsx`.
- Give it an app-specific name. Two `Button` symbols in one codebase is a discoverability problem;
  `IconLeadingButton` greps to exactly one place.
- Import `mergeTailwindClasses` from `@hearthkit/ui` rather than re-creating shadcn's `cn`, and
  `buttonVariants` when you want the package's variant classes unchanged. Both are guaranteed
  exports.
- Type the props from the package component, for example
  `Omit<ComponentProps<typeof Button>, 'asChild'>`. A package change that removes a variant then
  becomes a type error here instead of a silent visual regression.
- Cover only the pages that need it. Everything else keeps importing the package component.

Keep a note of what you copied. When the same structural need turns up in a second project, the
component belongs in `@hearthkit/ui` instead.
