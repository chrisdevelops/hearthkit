# Theming a hearthkit app

How an app consumes `@hearthkit/ui`: the setup it needs, how it changes the look, how it forks one
component when it has to, and how a new component gets into the package.

The package contract is `packages/ui/CONTRACT.md`. Token names, the `@source` literal, and the dark
mode class name are exported from the package (`hearthkitThemeTokenNames`,
`tailwindSourceDirectiveForUi`, `darkModeClassName`), so a script or a gate can check them instead of
copying strings out of this document.

## The four rules

1. Apps customize by overriding CSS variables in their own `globals.css`. An app never edits a
   component file inside the package.
2. Apps must include the `@source` line pointing at the `ui` package, or Tailwind never sees the
   package's class strings and generates none of its utilities.
3. When an app needs a structural change to a component, it copies that one component into the app
   and imports it locally. This is the only case where component code lives in an app.
4. New components are added to the package with the shadcn CLI and published. Apps pick them up with
   `pnpm up`.

## App setup

Four files. Everything else about the app is unaffected.

### `app/globals.css`

```css
@import 'tailwindcss';
@import '@hearthkit/ui/hearthkit-theme.css';
@source "../node_modules/@hearthkit/ui";
```

Order matters. `tailwindcss` first, the hearthkit theme second, then the `@source` line, then any
overrides of your own (see [Customizing](#customizing-with-token-overrides)).

The `@source` literal assumes `globals.css` sits one level below the app root, next to `app/`. It is
exported as `tailwindSourceDirectiveForUi` so the scaffolder and the gates use the same string. If
your CSS entry point lives somewhere else, adjust the relative path to reach the app's
`node_modules/@hearthkit/ui`.

Tailwind v4 ignores `node_modules` during automatic source detection. Without the `@source` line the
theme tokens still land in the stylesheet, but no utility that only the package uses is generated:
in the scratch app, dropping that one line took the compiled stylesheet from 37 KB to 11 KB and
removed `bg-primary`, `rounded-md`, and `text-primary-foreground` entirely. The page still returns
200 and the markup still carries the class names, so this failure looks like "the components render
unstyled", not like an error.

### `next.config.ts`

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@hearthkit/ui'],
}

export default nextConfig
```

The package ships TypeScript source, not a build. `transpilePackages` is what makes Next compile it.
Add every other `@hearthkit/*` package the app uses to the same array.

The app's own `typescript` dev dependency must be 5.x. Next 16's `next.config.ts` loader calls the
installed TypeScript's JavaScript API, which the native `typescript@7` preview does not provide; it
fails with `Cannot read properties of undefined (reading 'fileExists')`. The workspace pins TS 7 for
package builds; apps pin `typescript@5.9.3`. An app that would rather stay on TS 7 has to use
`next.config.mjs` instead.

### `app/layout.tsx`

```tsx
import type { ReactNode } from 'react'
import { ThemeModeProvider } from '@hearthkit/ui'
import './globals.css'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground">
        <ThemeModeProvider>{children}</ThemeModeProvider>
      </body>
    </html>
  )
}
```

`ThemeModeProvider` is required if the app uses dark mode, `ThemeModeToggle`, or `useThemeMode`.
`useThemeMode` outside the provider throws an error starting with
`hearthkit ui theme provider missing:`. `suppressHydrationWarning` on `<html>` is needed because the
theme script sets the class on that element before React hydrates.

### `postcss.config.mjs`

```js
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
```

Standard Tailwind v4 wiring. The app owns `tailwindcss` and `@tailwindcss/postcss`; the package
deliberately depends on neither. The package ships tokens and class strings, the app generates the
utilities.

## Customizing with token overrides

Every colour and the corner radius are plain CSS custom properties. Override them in your own
`globals.css`, after the package import, and the change applies everywhere with no republished
package and no rebuild of the package.

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

This works because the theme's `@theme inline` block maps each token into Tailwind's utility layer by
reference, so the generated utilities read the variable at paint time:

```css
.bg-primary {
  background-color: var(--primary);
}
.rounded-md {
  border-radius: calc(var(--radius) - 2px);
}
```

Your `:root` block comes later in the cascade than the package's, at the same specificity, so it
wins. Verified in the compiled stylesheet: the package's `--primary` is declared first, the app's
override second, and `--radius` drops from `.625rem` to `.25rem`.

Notes that matter in practice:

- Override in both `:root` and `.dark`. A colour set only in `:root` keeps its value in dark mode and
  usually breaks contrast there.
- `--radius` is the only mode-independent token; the `.dark` block in the package redefines every
  other one. The size steps `rounded-sm`, `rounded-md`, `rounded-lg`, and `rounded-xl` are all
  derived from `--radius`, so one line rescales the whole app.
- The full token list is `hearthkitThemeTokenNames` in `packages/ui/src/ui-contract.ts`, with values
  in `packages/ui/src/hearthkit-theme.css`. Sidebar and chart tokens already ship even though no
  sidebar or chart component does, so adding those components later needs no theme change.
- There is no `--destructive-foreground`; that matches the current shadcn vocabulary.
- The theme defines no fonts. Typography belongs to the app.

For a change that no token can express, such as different padding on every button, prefer passing
`className` at the call site. Reach for a copied component (rule 3) only when the markup itself has
to change.

## Dark mode

`ThemeModeProvider` wraps `next-themes` with `attribute="class"`, `defaultTheme="system"`,
`enableSystem`, and `disableTransitionOnChange`. Those settings are fixed by the contract; the
provider takes no props but `children`.

- The class toggled on `<html>` is `dark`, exported as `darkModeClassName`.
- The theme stylesheet registers `@custom-variant dark (&:is(.dark *))`, so `dark:` utilities follow
  that class rather than the operating system media query. A `dark:` utility in app code behaves the
  same as one inside the package.
- `ThemeModeToggle` is a dropdown with exactly three items, named `Light`, `Dark`, and `System`
  (`themeModeToggleOptionLabels`). Drop it anywhere under the provider, for example in the actions
  slot of `PageHeader`.
- `useThemeMode()` returns `{ themeMode, setThemeMode, resolvedThemeMode }`. `resolvedThemeMode` is
  `undefined` until hydration finishes, which is the value to branch on if you render something that
  depends on the effective mode. Never assume it is `light` before hydration.

## Shadowing a single component

Rule 3. Use it when the component's markup has to change: a required new slot, a different element
structure, an extra wrapper. Do not use it to change colours, spacing, or radius; those are token
overrides or a `className`.

What a shadowed component is allowed to do:

- Live in the app, in a file named after what it is, for example `app/components/icon-leading-button.tsx`.
- Carry an app-specific name, not the package name. Two `Button` symbols in one codebase is a
  discoverability problem; `IconLeadingButton` greps to exactly one place.
- Import `mergeTailwindClasses` from `@hearthkit/ui` instead of re-creating shadcn's `cn`, and
  `buttonVariants` when it wants the package's variant classes unchanged.
- Cover only the pages that need it. Everything else keeps importing the package component.

### The component

```tsx
import type { ComponentProps, ReactNode } from 'react'
import { Button, buttonVariants, mergeTailwindClasses } from '@hearthkit/ui'

/** Props of IconLeadingButton; leadingIcon is required, which is the structural fork from the package Button. */
type IconLeadingButtonProps = Omit<ComponentProps<typeof Button>, 'asChild'> & {
  leadingIcon: ReactNode
}

/** App-local copy of the package Button with a required icon slot divided from the label; not a wrapper. */
export function IconLeadingButton({
  className,
  variant = 'default',
  size = 'default',
  leadingIcon,
  children,
  ...buttonProps
}: IconLeadingButtonProps) {
  return (
    <button
      data-slot="icon-leading-button"
      data-variant={variant}
      data-size={size}
      className={mergeTailwindClasses(buttonVariants({ variant, size }), 'gap-0 px-0', className)}
      {...buttonProps}
    >
      <span
        data-slot="icon-leading-button-icon"
        aria-hidden="true"
        className="flex h-full items-center border-e border-primary-foreground/25 px-3"
      >
        {leadingIcon}
      </span>
      <span data-slot="icon-leading-button-label" className="px-3">
        {children}
      </span>
    </button>
  )
}
```

The icon is a required prop rendered in its own bordered slot. No CSS variable can add that element,
which is what makes this a legitimate fork. The `data-slot` values are app-specific, so the copy is
distinguishable from the package component in the DOM, in tests, and in a class selector.

`ComponentProps<typeof Button>` keeps the fork honest about props: variants and sizes stay in step
with the package, and a package change that removes a variant becomes a type error in the app rather
than a silent visual regression. If the fork also needs different variant classes, copy the `cva`
block out of `packages/ui/src/components/ui/button.tsx` into the app file and add
`class-variance-authority` to the app's dependencies. At that point the app owns the recipe too, and
the fork no longer depends on `buttonVariants`, which the package entry point exports but the
contract's guaranteed export list does not name.

### Using it next to the package component

```tsx
import { Button, Card, CardContent, PageContainer } from '@hearthkit/ui'

import { IconLeadingButton } from './components/icon-leading-button'

export default function HomePage() {
  return (
    <PageContainer>
      <Card>
        <CardContent className="flex items-center gap-3">
          <Button>Themed button</Button>
          <IconLeadingButton leadingIcon={<CheckIcon />}>Shadowed button</IconLeadingButton>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
```

`CheckIcon` is whatever icon element the app has to hand: an inline `svg` component, or an icon from
`lucide-react` once the app depends on it. The package does not re-export icons.

Both render on the same page. The served HTML shows the package button unchanged and the shadowed one
beside it with its own slots and the extra elements:

```html
<button
  data-slot="button"
  data-variant="default"
  data-size="default"
  class="… bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 …"
>
  Themed button
</button>

<button
  data-slot="icon-leading-button"
  data-variant="default"
  data-size="default"
  class="… bg-primary text-primary-foreground h-9 py-2 gap-0 px-0"
>
  <span
    data-slot="icon-leading-button-icon"
    aria-hidden="true"
    class="flex h-full items-center border-e border-primary-foreground/25 px-3"
  >
    <svg class="size-4">…</svg>
  </span>
  <span data-slot="icon-leading-button-label" class="px-3">Shadowed button</span>
</button>
```

Both buttons still read `--primary` from the app's token overrides, because the copy reuses the
package's class recipe rather than hard-coding colours. A theme change still reaches the fork.

Keep a note of what you forked. When the same structural need turns up in a second project, the
component belongs in the package instead, added the way the next section describes.

## Adding a component to the package

Rule 4. New components are generated into `packages/ui` with the shadcn CLI and published from there.
No app ever installs shadcn for itself.

One-time setup for the package, needed before the CLI can write to the right place. Neither piece is
in `packages/ui` today, so whoever adds the next component adds these first:

1. `packages/ui/components.json`, which tells the CLI it is looking at a configured project:

   ```json
   {
     "$schema": "https://ui.shadcn.com/schema.json",
     "style": "new-york",
     "rsc": false,
     "tsx": true,
     "tailwind": {
       "config": "",
       "css": "src/hearthkit-theme.css",
       "baseColor": "neutral",
       "cssVariables": true,
       "prefix": ""
     },
     "aliases": {
       "components": "@/components",
       "ui": "@/components/ui",
       "utils": "@/merge-tailwind-classes",
       "lib": "@/lib",
       "hooks": "@/hooks"
     },
     "iconLibrary": "lucide"
   }
   ```

   `tailwind.config` is empty because the stack is Tailwind v4. Without this file the CLI stops and
   offers to run `init` interactively.

2. A `@/*` path alias in `packages/ui/tsconfig.json` pointing at `src`:

   ```json
   { "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } } }
   ```

   The CLI resolves its aliases through the TypeScript config. Without the alias it does not fail: it
   creates a literal directory named `@` and writes the component into it.

Then, per component:

1. `pnpm dlx shadcn@latest add <component> --yes`, run from `packages/ui`. It writes
   `src/components/ui/<component>.tsx`. If the component needs a runtime dependency the package does
   not already have, the CLI adds it, and you then pin it to an exact version like the rest of the
   package. Current registry output imports Radix primitives from the unified `radix-ui` package,
   which is already a dependency, so most additions need nothing new.
2. Fix the generated import of the class merger. The CLI writes `import { cn } from '@/…'`; the
   package uses a relative specifier with the file extension and the exported name:

   ```ts
   import { mergeTailwindClasses } from '../../merge-tailwind-classes.ts'
   ```

   Rename the `cn` call sites in the generated file to match.

3. Re-export the new symbols by name from `packages/ui/src/index.ts`. No `export *`.
4. Run the package loop for the change: contract entry, gate, implementation, then a changeset. A new
   component is an additive change, so it is a minor version.
5. Apps pick it up with `pnpm up`. Nothing in the app changes; the `@source` line already covers new
   files in the package.

Leave generated components as close to the registry output as possible. The only intended deviation
is the class-merge import. That keeps a later `shadcn add --overwrite` a small diff, at the cost of
losing any doc comments added to generated exports.

## Verified

Checked 2026-08-28 against a scratch Next 16.1.4 app on Node 24.20.0, `@hearthkit/ui` at commit
`108367b`, Tailwind v4, TypeScript 5.9.3 in the app, shadcn CLI 4.19.0.

- The setup in this document renders package components and the shadowed component together:
  `GET /` returned 200, and the HTML contained `data-slot="button"` alongside
  `data-slot="icon-leading-button"`, `data-slot="icon-leading-button-icon"`, and
  `data-slot="icon-leading-button-label"`. The app also typechecks with `tsc --noEmit`.
- The token overrides shown above reach the compiled stylesheet: the app's `:root` and `.dark`
  blocks appear after the package's, `--radius` resolves to `.25rem`, and `bg-primary` and
  `rounded-md` are generated as `var(--primary)` and `calc(var(--radius) - 2px)`.
- Removing the `@source` line removed `bg-primary`, `rounded-md`, and `text-primary-foreground`
  from the compiled stylesheet while the tokens stayed defined.
- The shadcn CLI workflow was run end to end on a copy of `packages/ui`: with `components.json` and
  the `@/*` alias present, `pnpm dlx shadcn@latest add switch --yes` created
  `src/components/ui/switch.tsx` and changed nothing else. With the alias missing it created a
  literal `@/components/ui/switch.tsx` directory. With `components.json` missing it prompted to run
  `init`. The generated file imported `cn` from the `utils` alias, which is the rename step above.
