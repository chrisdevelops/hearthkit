import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import the package by its public name. The alias resolves that name to the same source
// entry the package.json "exports" field points at, so resolution does not depend on a build step.
// The env-fragment gate composes the fragment through @hearthkit/config, which is aliased the same way.
// Gates talk to compose MinIO, wait out a one-second presigned URL expiry, and let the AWS SDK's
// standard retry strategy run its three attempts, so the default 5s timeout is far too short.
export default defineConfig({
  resolve: {
    alias: {
      '@hearthkit/storage': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
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
