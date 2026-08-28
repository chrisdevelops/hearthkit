import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import the package by its public name. The alias resolves that name to the same source
// entry the package.json "exports" field points at, so resolution does not depend on a build step.
// Gates create and drop real databases, run pg_dump/pg_restore, and start docker compose services,
// so the default 5s timeout is far too short.
export default defineConfig({
  resolve: {
    alias: {
      '@hearthkit/cli': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
