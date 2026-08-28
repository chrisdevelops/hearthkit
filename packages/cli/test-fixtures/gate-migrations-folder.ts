import { fileURLToPath } from 'node:url'

/**
 * Hand-written stand-in for drizzle-kit output: a meta/_journal.json listing two entries plus one
 * .sql file each. Checked in rather than generated so a db migrate gate never has to run drizzle-kit.
 */
export function gateCliMigrationsFolderPath(): string {
  return fileURLToPath(new URL('./migrations/gate-cli-baseline', import.meta.url))
}

/** How many migrations the folder holds, so a first run must report exactly this many and a second run zero. */
export const gateCliBaselineMigrationCount = 2
