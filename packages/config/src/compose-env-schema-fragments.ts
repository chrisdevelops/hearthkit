import { z } from 'zod'
import type { ConfigFailure, EnvSchemaFragment } from './config-contract.ts'
import { formatConfigFragmentConflictMessage } from './config-failure-messages.ts'
import { asEnvVariableName } from './env-variable-names.ts'

/** Result of composing fragments: one merged object schema, or the conflict failure that stops loading before any parsing happens. */
export type ComposeEnvSchemaFragmentsResult =
  | { kind: 'env-schema-composed'; schema: EnvSchemaFragment }
  | Extract<ConfigFailure, { kind: 'config-fragment-conflict' }>

/** Merges fragments into one object schema, failing on the first variable declared twice even when both declarations are identical. */
export function composeEnvSchemaFragments(
  fragments: readonly EnvSchemaFragment[],
): ComposeEnvSchemaFragmentsResult {
  const composedShape: Record<string, z.ZodType> = {}

  for (const fragment of fragments) {
    for (const [variableName, variableSchema] of Object.entries(fragment.shape)) {
      if (Object.hasOwn(composedShape, variableName)) {
        const conflictingName = asEnvVariableName(variableName)
        return {
          kind: 'config-fragment-conflict',
          variableName: conflictingName,
          message: formatConfigFragmentConflictMessage(conflictingName),
        }
      }
      composedShape[variableName] = variableSchema
    }
  }

  return { kind: 'env-schema-composed', schema: z.object(composedShape) }
}
