import { z } from 'zod'
import type { ConfigFailure } from '@hearthkit/config'

/**
 * Sample env schema fragments standing in for the fragments other hearthkit packages will export.
 * Every variable is prefixed GATE_ so a gate can never read a value that leaked in from process.env.
 */

/** Stands in for the db fragment: one URL variable and one coerced number with a default. */
export const gateDatabaseEnvSchemaFragment = z.object({
  GATE_DATABASE_URL: z.url(),
  GATE_DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
})

/** Stands in for the storage fragment: one required string and one defaulted string. */
export const gateStorageEnvSchemaFragment = z.object({
  GATE_STORAGE_BUCKET: z.string().min(1),
  GATE_STORAGE_REGION: z.string().min(1).default('auto'),
})

/** Stands in for a package the app did not install; its variable is required only when passed. */
export const gateEmailEnvSchemaFragment = z.object({
  GATE_EMAIL_API_KEY: z.string().min(1),
})

/** Redeclares GATE_STORAGE_BUCKET so a gate can force the fragment-conflict failure. */
export const gateConflictingStorageEnvSchemaFragment = z.object({
  GATE_STORAGE_BUCKET: z.string().min(1),
})

/** Short random suffix so values differ between runs and no gate can pass on stale state. */
export function uniqueGateRunId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/**
 * A complete, valid env source for the database and storage fragments; overrides replace or add
 * keys, and an explicit undefined removes one. Gates never mutate or read process.env.
 */
export function buildGateEnvSource(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const runId = uniqueGateRunId()
  return {
    GATE_DATABASE_URL: `postgres://gate:gate@db.gate.test:5432/gate_${runId}`,
    GATE_DATABASE_POOL_SIZE: '5',
    GATE_STORAGE_BUCKET: `gate-bucket-${runId}`,
    GATE_STORAGE_REGION: 'auto',
    ...overrides,
  }
}

/** Any branch a load result can take, with the success payload left opaque. */
type ConfigLoadResultLike = { kind: 'config-loaded'; config: unknown } | ConfigFailure

/** Narrows a load result to its success branch, failing the gate with the whole failure otherwise. */
export function expectConfigLoaded<TConfig>(
  result: { kind: 'config-loaded'; config: TConfig } | ConfigFailure,
): TConfig {
  if (result.kind !== 'config-loaded') {
    throw new Error(`gate expected config-loaded, received ${JSON.stringify(result)}`)
  }
  return result.config
}

/** Narrows a load result to a validation failure, failing the gate with what came back otherwise. */
export function expectConfigValidationFailed(
  result: ConfigLoadResultLike,
): Extract<ConfigFailure, { kind: 'config-validation-failed' }> {
  if (result.kind !== 'config-validation-failed') {
    throw new Error(`gate expected config-validation-failed, received ${JSON.stringify(result)}`)
  }
  return result
}

/** Narrows a load result to a fragment conflict, failing the gate with what came back otherwise. */
export function expectConfigFragmentConflict(
  result: ConfigLoadResultLike,
): Extract<ConfigFailure, { kind: 'config-fragment-conflict' }> {
  if (result.kind !== 'config-fragment-conflict') {
    throw new Error(`gate expected config-fragment-conflict, received ${JSON.stringify(result)}`)
  }
  return result
}

/** The one issue reported for a variable, failing the gate when there is none or more than one. */
export function findGateIssueFor(
  failure: Extract<ConfigFailure, { kind: 'config-validation-failed' }>,
  variableName: string,
): Extract<ConfigFailure, { kind: 'config-validation-failed' }>['issues'][number] {
  const matches = failure.issues.filter((issue) => issue.variableName === variableName)
  const [issue] = matches
  if (matches.length !== 1 || issue === undefined) {
    throw new Error(
      `gate expected exactly one issue for ${variableName}, received ${JSON.stringify(failure.issues)}`,
    )
  }
  return issue
}
