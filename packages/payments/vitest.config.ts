import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import every package by its public name. The aliases resolve those names to the same source
// entries each package.json "exports" field points at, so resolution does not depend on a build step
// and no gate can reach an internal module by accident.
//
// Every alias matches exactly. A bare string alias in Vite is a prefix replacement, so
// '@hearthkit/payments' would also rewrite '@hearthkit/payments/payments-contract' into
// '.../src/index.ts/payments-contract'; the anchored regexes keep the two subpaths apart.
//
// fileParallelism is off for two reasons. Every database-backed file creates and drops a scratch
// Postgres database through @hearthkit/db, which is cheap serially and a connection storm in
// parallel. And the live files create real objects in one shared Stripe test-mode account, where
// serial runs keep well clear of the API's rate limits.
//
// The timeouts are long because a live file makes a handful of round trips to Stripe, and because
// every database-backed file creates a database, builds three tables and drops it again.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@hearthkit\/payments$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/payments\/payments-contract$/,
        replacement: fileURLToPath(new URL('./src/payments-contract-entry.ts', import.meta.url)),
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
        find: /^@hearthkit\/auth\/auth-contract$/,
        replacement: fileURLToPath(new URL('../auth/src/auth-contract-entry.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 240_000,
  },
})
