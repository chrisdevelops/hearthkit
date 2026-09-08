import { envVariableNameSchema, type EnvVariableName } from './config-contract.ts'

/** Brands a raw key as an env variable name by parsing it; throws on a key that is not SCREAMING_SNAKE_CASE, so pass only keys taken from a fragment shape. */
export function asEnvVariableName(variableName: string): EnvVariableName {
  return envVariableNameSchema.parse(variableName)
}
