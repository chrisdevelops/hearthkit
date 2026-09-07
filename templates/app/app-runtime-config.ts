import { configEnvSchemaFragment, requireHearthkitConfig } from '@hearthkit/config'
import type { EnvSchemaFragment, EnvSource, HearthkitConfigOf } from '@hearthkit/config'
import { observabilityEnvSchemaFragment } from '@hearthkit/observability'

// hearthkit-section:begin @hearthkit/storage
import { storageEnvSchemaFragment } from '@hearthkit/storage'

// hearthkit-section:end @hearthkit/storage
// hearthkit-section:begin @hearthkit/email
import { emailEnvSchemaFragment } from '@hearthkit/email'

// hearthkit-section:end @hearthkit/email
// hearthkit-section:begin @hearthkit/auth
import { authEnvSchemaFragment } from '@hearthkit/auth'
import { dbEnvSchemaFragment } from '@hearthkit/db'

// hearthkit-section:end @hearthkit/auth
// hearthkit-section:begin @hearthkit/payments
import { paymentsEnvSchemaFragment } from '@hearthkit/payments'

// hearthkit-section:end @hearthkit/payments
/**
 * Boot-time configuration of this app.
 *
 * Every hearthkit package that reads the environment owns a schema fragment and exports it. This
 * file is where an app composes them: add a package's fragment to `appEnvSchemaFragments` and its
 * variables are validated at boot, typed on the returned config, and named in the error message
 * when they are wrong.
 *
 * The `hearthkit-section` comments delimit one optional package's lines each. They are the unit
 * `@hearthkit/create` deletes when a project did not select that package, which is why an import and
 * its array entry are two separate blocks: whole-file pruning cannot add or remove an import from a
 * file every project keeps. Deleting between the markers is all the scaffolder ever does to this
 * file, so keep each block complete and never nest one inside another.
 */

/**
 * Every env schema fragment this app validates at boot, in the order packages are wired up.
 * Adding a fragment here is the only step needed to make a new package's variables required.
 */
export const appEnvSchemaFragments = [
  configEnvSchemaFragment,
  observabilityEnvSchemaFragment,
  // hearthkit-section:begin @hearthkit/storage
  storageEnvSchemaFragment,
  // hearthkit-section:end @hearthkit/storage
  // hearthkit-section:begin @hearthkit/email
  emailEnvSchemaFragment,
  // hearthkit-section:end @hearthkit/email
  // hearthkit-section:begin @hearthkit/auth
  dbEnvSchemaFragment,
  authEnvSchemaFragment,
  // hearthkit-section:end @hearthkit/auth
  // hearthkit-section:begin @hearthkit/payments
  paymentsEnvSchemaFragment,
  // hearthkit-section:end @hearthkit/payments
] as const satisfies readonly EnvSchemaFragment[]

/** Frozen config this app boots with; the type follows appEnvSchemaFragments, so a new fragment widens it with no edit here. */
export type AppRuntimeConfig = HearthkitConfigOf<typeof appEnvSchemaFragments>

/**
 * Reads and validates the environment for boot, or throws an Error whose message names every
 * failing variable and starts with config's own `hearthkit config invalid:` prefix.
 *
 * `env` exists so a test can prove the failure path without a process environment; it defaults to
 * `process.env`.
 */
export function requireAppRuntimeConfig(options?: { env?: EnvSource }): AppRuntimeConfig {
  return requireHearthkitConfig({ fragments: appEnvSchemaFragments, env: options?.env })
}
