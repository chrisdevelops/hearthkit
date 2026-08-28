import type { z } from 'zod'
import type { ConfigVariableIssue } from './config-contract.ts'
import { asEnvVariableName } from './env-variable-names.ts'

/** Human-readable phrase for what the variable should have been; every branch returns a non-empty phrase that reads after "must be". */
function describeExpectedEnvValue(zodIssue: z.core.$ZodIssue): string {
  switch (zodIssue.code) {
    case 'invalid_type':
      return `a ${zodIssue.expected}`
    case 'invalid_value':
      return `one of ${zodIssue.values
        .map((value) => (typeof value === 'string' ? `"${value}"` : String(value)))
        .join(', ')}`
    case 'invalid_format':
      return `a valid ${zodIssue.format} value`
    case 'too_small':
      return `a ${zodIssue.origin} of at least ${zodIssue.minimum}`
    case 'too_big':
      return `a ${zodIssue.origin} of at most ${zodIssue.maximum}`
    default:
      return `a valid value (${zodIssue.message})`
  }
}

/** Classifies one Zod issue; presence is decided by the normalized env, not the issue, so a value that coerced to NaN is wrong-type rather than missing. */
function toConfigVariableIssue(
  zodIssue: z.core.$ZodIssue,
  variableName: string,
  isPresentInEnv: boolean,
): ConfigVariableIssue {
  const brandedName = asEnvVariableName(variableName)

  if (!isPresentInEnv) {
    return { kind: 'env-variable-missing', variableName: brandedName }
  }

  if (zodIssue.code === 'invalid_format' && zodIssue.format === 'url') {
    return { kind: 'env-variable-invalid-url', variableName: brandedName }
  }

  return {
    kind: 'env-variable-wrong-type',
    variableName: brandedName,
    expected: describeExpectedEnvValue(zodIssue),
  }
}

/** Maps a whole Zod error into at most one issue per variable, sorted by name; issues with no variable in their path cannot occur for the plain object fragments the contract allows, so they are dropped. */
export function collectConfigVariableIssues(
  zodIssues: readonly z.core.$ZodIssue[],
  presentVariableNames: ReadonlySet<string>,
): ConfigVariableIssue[] {
  const issuesByVariableName = new Map<string, ConfigVariableIssue>()

  for (const zodIssue of zodIssues) {
    const [variableName] = zodIssue.path
    if (typeof variableName !== 'string' || issuesByVariableName.has(variableName)) {
      continue
    }
    issuesByVariableName.set(
      variableName,
      toConfigVariableIssue(zodIssue, variableName, presentVariableNames.has(variableName)),
    )
  }

  return [...issuesByVariableName.values()].toSorted((left, right) =>
    left.variableName.localeCompare(right.variableName),
  )
}
