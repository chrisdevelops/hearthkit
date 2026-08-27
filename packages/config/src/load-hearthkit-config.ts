import type {
  ConfigFailure,
  EnvSchemaFragment,
  HearthkitConfigOf,
  LoadHearthkitConfigOptions,
} from './config-contract.js'
import { composeEnvSchemaFragments } from './compose-env-schema-fragments.js'
import { collectConfigVariableIssues } from './config-variable-issues.js'
import { formatConfigInvalidMessage } from './config-failure-messages.js'
import { normalizeEnvSource } from './normalize-env-source.js'

/** Validates the environment against the composed fragments in one pass and never throws; every failure comes back as a value, and success carries a frozen config with defaults applied. */
export function loadHearthkitConfig<const TFragments extends readonly EnvSchemaFragment[]>(
  options: LoadHearthkitConfigOptions<TFragments>,
): { kind: 'config-loaded'; config: HearthkitConfigOf<TFragments> } | ConfigFailure {
  const composed = composeEnvSchemaFragments(options.fragments)
  if (composed.kind === 'config-fragment-conflict') {
    return composed
  }

  const normalizedEnv = normalizeEnvSource(
    options.env ?? process.env,
    Object.keys(composed.schema.shape),
  )
  const parsed = composed.schema.safeParse(normalizedEnv)

  if (!parsed.success) {
    const issues = collectConfigVariableIssues(
      parsed.error.issues,
      new Set(Object.keys(normalizedEnv)),
    )
    return {
      kind: 'config-validation-failed',
      issues,
      message: formatConfigInvalidMessage(issues),
    }
  }

  return {
    kind: 'config-loaded',
    config: Object.freeze(parsed.data) as HearthkitConfigOf<TFragments>,
  }
}
