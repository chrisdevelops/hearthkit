import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import the package by its public name. The alias resolves that name to the same source entry
// the package.json "exports" field points at, so resolution does not depend on a build step. The env
// fragment gate composes the fragment through @hearthkit/config, which is aliased the same way.
//
// fileParallelism is off because Mailpit is a single shared server for the whole run and its Chaos
// triggers are global process state: one file switching recipient rejection on at 100% would make
// every other file's send fail. Serial files also mean "clear the inbox, send one message, read the
// only message back" stays a deterministic assertion instead of a race.
//
// The timeouts are long because one gate deliberately waits out the SMTP greeting timeout
// (smtpConnectionTimeoutMs, 10s) and must still be able to report an implementation that left
// nodemailer's 30s default in place, rather than being cut off by Vitest first.
export default defineConfig({
  resolve: {
    alias: {
      '@hearthkit/email': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      '@hearthkit/config': fileURLToPath(new URL('../config/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
