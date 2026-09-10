import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Gates import the package by its public name. The alias resolves that name to the same source entry
// the package.json "exports" field points at, so resolution does not depend on a build step. The env
// fragment gate composes the fragment through @hearthkit/config, which is aliased the same way.
//
// Every alias matches exactly. A bare string alias in Vite is a prefix replacement, so
// '@hearthkit/email' would also rewrite '@hearthkit/email/email-contract' into
// '.../src/index.ts/email-contract'; the anchored regexes keep the two subpaths apart. With the bare
// name anchored there is no alias for the subpath at all, so it falls through to Node's
// self-reference resolution, which reads package.json and lands on the published
// src/email-contract-entry.ts rather than the wider internal module behind it.
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
    alias: [
      {
        find: /^@hearthkit\/email$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
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
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
