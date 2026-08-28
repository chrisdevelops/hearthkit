/**
 * Reads one variable from the CLI's environment. An empty string counts as unset, matching the rule
 * @hearthkit/config applies at boot, so `HEARTHKIT_ADMIN_DATABASE_URL=` falls through to the default.
 */
export function readEnvironmentVariableValue(
  environmentVariables: Record<string, string | undefined>,
  variableName: string,
): string | undefined {
  const value = environmentVariables[variableName]
  if (value === undefined || value.trim() === '') {
    return undefined
  }
  return value
}
