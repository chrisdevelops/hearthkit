import { z } from 'zod'
import type {
  ConfigFailure,
  EnvSchemaFragment,
  HearthkitConfigOf,
  LoadHearthkitConfigOptions,
} from './config-contract.ts'
import { composeEnvSchemaFragments } from './compose-env-schema-fragments.ts'
import { collectConfigVariableIssues } from './config-variable-issues.ts'
import { formatConfigInvalidMessage } from './config-failure-messages.ts'
import { normalizeEnvSource } from './normalize-env-source.ts'

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

  // The composed schema is one z.object over every fragment's shape, so its output is, by
  // construction, the merge of every fragment's output: exactly what HearthkitConfigOf names. The
  // type system cannot follow that through a tuple of fragments, so the narrowing is stated as a
  // schema whose one runtime check, a non-null object, the composed parse has already guaranteed.
  const loadedConfigSchema = z.custom<HearthkitConfigOf<TFragments>>(
    (value) => typeof value === 'object' && value !== null,
  )

  return {
    kind: 'config-loaded',
    config: loadedConfigSchema.parse(Object.freeze(parsed.data)),
  }
}
