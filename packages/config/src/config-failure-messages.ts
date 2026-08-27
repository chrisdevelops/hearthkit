import {
  configFragmentConflictErrorPrefix,
  configInvalidErrorPrefix,
  type ConfigVariableIssue,
  type EnvVariableName,
} from './config-contract.js'

/** One line of an aggregate message, naming the variable once so a gate can count lines per variable. */
function describeConfigVariableIssue(issue: ConfigVariableIssue): string {
  if (issue.kind === 'env-variable-missing') {
    return `${issue.variableName}: required but not set (an empty value counts as not set)`
  }
  if (issue.kind === 'env-variable-invalid-url') {
    return `${issue.variableName}: must be a valid URL`
  }
  return `${issue.variableName}: must be ${issue.expected}`
}

/** Renders every issue under one prefix line, one variable per line, so boot reports all failures at once rather than the first. */
export function formatConfigInvalidMessage(issues: readonly ConfigVariableIssue[]): string {
  const lines = issues.map((issue) => `  ${describeConfigVariableIssue(issue)}`)
  return [configInvalidErrorPrefix, ...lines].join('\n')
}

/** Renders the conflict message; the variable name always appears after the prefix so callers can grep for it. */
export function formatConfigFragmentConflictMessage(variableName: EnvVariableName): string {
  return `${configFragmentConflictErrorPrefix} ${variableName} is declared by more than one env schema fragment; exactly one package may own a variable`
}
