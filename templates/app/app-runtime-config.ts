import { configEnvSchemaFragment, requireHearthkitConfig } from '@hearthkit/config'
import type { EnvSchemaFragment, EnvSource, HearthkitConfigOf } from '@hearthkit/config'
import { observabilityEnvSchemaFragment } from '@hearthkit/observability'

/**
 * Boot-time configuration of this app.
 *
 * Every hearthkit package that reads the environment owns a schema fragment and exports it. This
 * file is where an app composes them: add a package's fragment to `appEnvSchemaFragments` and its
 * variables are validated at boot, typed on the returned config, and named in the error message
 * when they are wrong.
 */

/**
 * Every env schema fragment this app validates at boot, in the order packages are wired up.
 * Adding a fragment here is the only step needed to make a new package's variables required.
 */
export const appEnvSchemaFragments = [
  configEnvSchemaFragment,
  observabilityEnvSchemaFragment,
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
