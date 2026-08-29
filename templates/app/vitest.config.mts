import { defineConfig } from 'vitest/config'

// The fast tier of the template's two-tier gating, and a hearthkit-only file: it is pruned before a
// project is generated, so nothing here ships.
//
// These gates read the template tree and call the app's own modules. They start no service, no
// container and no browser, because the repo-root CI runs `pnpm --recursive --if-present run test`
// on every pull request. The batched tier (Docker build plus the Playwright smoke test in e2e/)
// runs from `verify:container`, which is why `include` is scoped to src/ and never matches
// e2e/*.spec.ts.
//
// The extension is .mts, not .ts: package.json deliberately has no "type": "module", because Next's
// standalone server.js is CommonJS, so Vite's config loader reads a .ts config as CommonJS and warns
// about the ESM syntax in it. That loader becomes the default in a future major, so the extension is
// the fix. appTemplateRepoOnlyPaths names this file.
//
// No alias maps @hearthkit/* here, unlike the package gates: the template depends on the three
// packages for real, so resolving them through its own node_modules is part of what is gated.
// css is off so importing a component never drags PostCSS and Tailwind into the fast tier.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    css: false,
    testTimeout: 15_000,
  },
})
