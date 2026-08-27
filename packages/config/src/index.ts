/** Public entry point of @hearthkit/config: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Loads config without throwing; failures come back as values. */
export { loadHearthkitConfig } from './load-hearthkit-config.js'

/** Loads config for boot; throws on any failure. */
export { requireHearthkitConfig } from './require-hearthkit-config.js'

/** Contract values: this package's own fragment, the two error prefixes, and the runtime schemas gates parse results with. */
export {
  configEnvSchemaFragment,
  configFailureSchema,
  configFragmentConflictErrorPrefix,
  configInvalidErrorPrefix,
  configLoadResultSchema,
  configVariableIssueSchema,
  envSchemaFragmentSchema,
  envVariableNameSchema,
} from './config-contract.js'

/** Contract types: the failure union, the fragment and env source shapes, and the generic config type composed from the fragments an app passes. */
export type {
  ConfigFailure,
  ConfigVariableIssue,
  EnvSchemaFragment,
  EnvSource,
  EnvVariableName,
  HearthkitConfigOf,
  LoadHearthkitConfigOptions,
} from './config-contract.js'
