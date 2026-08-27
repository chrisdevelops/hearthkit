import type { EnvVariableName } from './config-contract.js'

/** Brands a raw key as an env variable name; the caller must pass a key taken from a fragment shape, because no SCREAMING_SNAKE_CASE check runs here. */
export function asEnvVariableName(variableName: string): EnvVariableName {
  return variableName as EnvVariableName
}
