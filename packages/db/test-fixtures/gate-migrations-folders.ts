import { fileURLToPath } from 'node:url'

/**
 * Hand-written stand-ins for drizzle-kit output: a `meta/_journal.json` listing entries by tag and
 * `when`, plus one `<tag>.sql` file per entry, statements separated by `--> statement-breakpoint`.
 * They are checked in rather than generated so a gate never has to run drizzle-kit.
 */
export type GateMigrationsFolderName =
  'gate-baseline' | 'gate-altered-history' | 'gate-failing-statement' | 'gate-missing-journal'

/** Absolute path to a checked-in migrations folder, resolved from this file so the working directory does not matter. */
export function gateMigrationsFolderPath(folderName: GateMigrationsFolderName): string {
  return fileURLToPath(new URL(`./migrations/${folderName}`, import.meta.url))
}

/** Absolute path no folder occupies, for the missing-folder branch of migrations-folder-not-found. */
export function absentMigrationsFolderPath(): string {
  return fileURLToPath(new URL('./migrations/gate-folder-that-does-not-exist', import.meta.url))
}

/** How many migrations the gate-baseline folder contains, so a first run must report exactly this many. */
export const gateBaselineMigrationCount = 2
