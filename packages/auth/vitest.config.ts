import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import every package by its public name. The aliases resolve those names to the same source
// entries each package.json "exports" field points at, so resolution does not depend on a build step
// and no gate can reach an internal module by accident.
//
// Every alias matches exactly. A bare string alias in Vite is a prefix replacement, so
// '@hearthkit/email' would also rewrite '@hearthkit/email/email-contract' into
// '.../src/index.ts/email-contract'; the anchored regexes keep the two subpaths apart.
//
// fileParallelism is off for two reasons. One gate file starts a Mailpit container of its own and the
// docker daemon is shared with whatever else the repo's compose stack is running, so serial files keep
// that to one container at a time. And every database-backed file creates and drops a scratch Postgres
// database through @hearthkit/db, which is cheap serially and a connection storm in parallel.
//
// The timeouts are long because the Mailpit file may pull an image on a first run, and because the
// expired magic link gate deliberately waits out a one-second link before verifying it.
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@hearthkit\/auth$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/auth\/auth-contract$/,
        replacement: fileURLToPath(new URL('./src/auth-contract.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/db$/,
        replacement: fileURLToPath(new URL('../db/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/email$/,
        replacement: fileURLToPath(new URL('../email/src/index.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/email\/email-contract$/,
        replacement: fileURLToPath(new URL('../email/src/email-contract.ts', import.meta.url)),
      },
      {
        find: /^@hearthkit\/config$/,
        replacement: fileURLToPath(new URL('../config/src/index.ts', import.meta.url)),
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
