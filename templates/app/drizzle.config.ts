import { hearthkitAuthTableNames } from '@hearthkit/auth/auth-contract'
import { defineConfig } from 'drizzle-kit'

// hearthkit-section:begin @hearthkit/payments
import { hearthkitPaymentsTableNames } from '@hearthkit/payments/payments-contract'

// hearthkit-section:end @hearthkit/payments
/**
 * How `pnpm db:generate` turns `app-drizzle-schema.ts` into SQL.
 *
 * The app owns its migration: this template ships no generated SQL, so a new project runs
 * `pnpm db:generate` once and then applies the result with `hearthkit db migrate`. That order is a
 * precondition of anything that reads or writes a table, including the auth Playwright flow.
 *
 * No `casing` option, deliberately. The hearthkit packages declare their columns with no explicit
 * names, so Drizzle uses the property keys as the column names, and generating snake_case columns
 * here would produce a database those packages cannot query.
 *
 * No `dbCredentials` either: `generate` compares the schema against the previous migration and never
 * connects, and the connection string belongs to `hearthkit db migrate`.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './app-drizzle-schema.ts',
  out: './drizzle',
  // Scoped to the tables the hearthkit packages own, so a project that manages other tables with
  // another tool does not have them dropped by an introspection or a push run from here.
  tablesFilter: [
    ...hearthkitAuthTableNames,
    // hearthkit-section:begin @hearthkit/payments
    ...hearthkitPaymentsTableNames,
    // hearthkit-section:end @hearthkit/payments
  ],
})
