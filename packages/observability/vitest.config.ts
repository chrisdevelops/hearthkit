import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import the package by its public name. The alias resolves that name to the same source
// entry the package.json "exports" field points at, so resolution does not depend on a build step.
// The env-fragment gate composes the fragment through @hearthkit/config, which is aliased the same way.
// The reporting gates start local HTTP servers and the health gates talk to compose Postgres, so the
// default 5s timeout is tight; the file-level default is raised rather than tagging each gate.
export default defineConfig({
  resolve: {
    alias: {
      '@hearthkit/observability': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      '@hearthkit/config': fileURLToPath(new URL('../config/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
