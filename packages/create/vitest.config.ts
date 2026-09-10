import { fileURLToPath } from 'node:url'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * Two tiers in one config, selected by HEARTHKIT_SCAFFOLD_GATES.
 *
 * `pnpm --filter @hearthkit/create test` runs the fast tier: the failure modes, the prompt fallback,
 * the pure scaffold trees and the two pruning functions. Nothing there needs Docker, a registry or a
 * Stripe key, so it belongs on every pull request.
 *
 * `HEARTHKIT_SCAFFOLD_GATES=1` adds `create-scaffold-variants.test.ts`, the three variants plan 4.10
 * names. Each of those packs tarballs, installs, typechecks, boots a Next server and drives
 * Playwright, so one run is minutes rather than seconds. The package script for it is
 * `"test:scaffold": "HEARTHKIT_SCAFFOLD_GATES=1 vitest run"`.
 *
 * An environment variable rather than a vitest project is deliberate. With `test.projects` a plain
 * `vitest run` still runs every project, so the slow tier would come back the moment anyone ran
 * vitest without the right `--project` flag; with an exclude, the default is fast whatever command
 * reaches vitest, and only an explicit variable widens it.
 *
 * The aliases resolve each package name to the same source entry its package.json "exports" points
 * at, so no gate depends on a build step and none can reach an internal module by accident. They are
 * anchored regexes because a bare string alias in Vite is a prefix replacement, which would rewrite
 * '@hearthkit/ui/ui-contract' into '.../ui/src/index.ts/ui-contract'.
 *
 * The timeouts are long because even a fast gate may run `pnpm install` to a deliberate failure, and
 * a scaffold variant spends minutes in install, build and Playwright.
 */

const runsScaffoldGates = process.env.HEARTHKIT_SCAFFOLD_GATES === '1'

/** The one gate file that needs Docker, packed tarballs and a Stripe key; excluded unless asked for by name. */
const scaffoldGateFile = 'src/create-scaffold-variants.test.ts'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@hearthkit\/create$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/cli$/,
        replacement: fileURLToPath(new URL('../cli/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/db$/,
        replacement: fileURLToPath(new URL('../db/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/config$/,
        replacement: fileURLToPath(new URL('../config/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/observability$/,
        replacement: fileURLToPath(new URL('../observability/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/ui\/ui-contract$/,
        replacement: fileURLToPath(new URL('../ui/src/ui-contract.ts', import.meta.url)),
      },
      // @hearthkit/cli's own contract imports @hearthkit/payments/payments-contract, and its
      // payments sync command imports @hearthkit/payments, so the whole chain has to resolve here
      // too or importing runHearthkitCli fails at module load.
      {
        find: /^@hearthkit\/payments\/payments-contract$/,
        replacement: fileURLToPath(
          new URL('../payments/src/payments-contract.ts', import.meta.url),
        ),
      },
      {
        find: /^@hearthkit\/payments$/,
        replacement: fileURLToPath(new URL('../payments/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/auth\/auth-contract$/,
        replacement: fileURLToPath(new URL('../auth/src/auth-contract.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/auth$/,
        replacement: fileURLToPath(new URL('../auth/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/email\/email-contract$/,
        replacement: fileURLToPath(
          new URL('../email/src/email-contract-entry.ts', import.meta.url),
        ),
      },
      {
        find: /^@hearthkit\/email$/,
        replacement: fileURLToPath(new URL('../email/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/storage$/,
        replacement: fileURLToPath(new URL('../storage/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: runsScaffoldGates
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, scaffoldGateFile],
    fileParallelism: false,
    testTimeout: runsScaffoldGates ? 1_800_000 : 180_000,
    hookTimeout: runsScaffoldGates ? 1_800_000 : 180_000,
  },
})
