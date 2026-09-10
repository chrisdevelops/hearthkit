import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import the package by its public name. The aliases resolve those names to the same source
// entries each package.json "exports" field points at, so resolution does not depend on a build step.
// Gates create and drop real databases, run pg_dump/pg_restore, and start docker compose services,
// so the default 5s timeout is far too short.
//
// The two @hearthkit/payments aliases exist because src/cli-contract.ts imports
// @hearthkit/payments/payments-contract and the payments sync command imports @hearthkit/payments,
// while the dependency itself belongs in package.json, which a gate-writer may not edit. They point
// at exactly the entries that package's "exports" field names, so they keep pointing at the same
// files once the implementor adds the workspace dependency.
//
// Every alias matches exactly. A bare string alias in Vite is a prefix replacement, so
// '@hearthkit/payments' would also rewrite '@hearthkit/payments/payments-contract' into
// '.../src/index.ts/payments-contract'; the anchored regexes keep the two subpaths apart.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@hearthkit\/cli$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/payments$/,
        replacement: fileURLToPath(new URL('../payments/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/payments\/payments-contract$/,
        replacement: fileURLToPath(
          new URL('../payments/src/payments-contract-entry.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
