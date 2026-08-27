import type { EnvSource } from './config-contract.js'

/** Keeps only declared variables that carry a real value; an unset variable and an empty string are both dropped so defaults apply and required variables report as missing. */
export function normalizeEnvSource(
  env: EnvSource,
  declaredVariableNames: readonly string[],
): Record<string, string> {
  const normalized: Record<string, string> = {}

  for (const variableName of declaredVariableNames) {
    const rawValue = env[variableName]
    if (rawValue === undefined || rawValue === '') {
      continue
    }
    normalized[variableName] = rawValue
  }

  return normalized
}
