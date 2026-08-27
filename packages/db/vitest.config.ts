import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import the package by its public name. The alias resolves that name to the same source
// entry the package.json "exports" field points at, so resolution does not depend on a build step.
// Lifecycle gates create and drop real databases, back them up with pg_dump and restore them with
// pg_restore, so the default 5s timeout is far too short.
export default defineConfig({
  resolve: {
    alias: {
      '@hearthkit/db': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      '@hearthkit/config': fileURLToPath(new URL('../config/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
