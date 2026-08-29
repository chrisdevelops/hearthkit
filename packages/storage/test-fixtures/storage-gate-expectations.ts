import { storageFailureSchema, type StorageFailure } from '../src/storage-contract.ts'
import { gateSecretsThatMustNeverLeak } from './storage-gate-connections.ts'

/** Narrows any contract result to one variant, failing the gate with the whole result when it took another branch. */
export function expectResultKind<TResult extends { kind: string }, TKind extends TResult['kind']>(
  result: TResult,
  expectedKind: TKind,
): Extract<TResult, { kind: TKind }> {
  if (result.kind !== expectedKind) {
    throw new Error(`gate expected ${expectedKind}, received ${JSON.stringify(result)}`)
  }
  return result as unknown as Extract<TResult, { kind: TKind }>
}

/** Fails the gate when a secret the gates handed the package appears anywhere in a value it returned. */
export function expectValueCarriesNoSecret(result: unknown): void {
  const serialized = JSON.stringify(result) ?? String(result)
  for (const secret of gateSecretsThatMustNeverLeak) {
    if (serialized.includes(secret)) {
      throw new Error(
        `gate found a secret access key in a value returned by @hearthkit/storage: ${serialized}`,
      )
    }
  }
}

/**
 * Validates a returned failure against the contract union, which also checks its message prefix,
 * proves it carries no secret, then narrows it. Failures are returned as values, never thrown.
 */
export function expectStorageFailure<TKind extends StorageFailure['kind']>(
  result: unknown,
  expectedKind: TKind,
): Extract<StorageFailure, { kind: TKind }> {
  expectValueCarriesNoSecret(result)

  const parsed = storageFailureSchema.safeParse(result)
  if (!parsed.success) {
    throw new Error(
      `gate expected a ${expectedKind} failure matching storageFailureSchema, received ${JSON.stringify(result)}`,
    )
  }
  return expectResultKind(parsed.data, expectedKind)
}

/**
 * A message prefix or constant read straight off the contract module. A contract rename leaves the
 * import undefined instead of throwing in this repo's Vitest setup, so every comparison against a
 * contract value goes through one of these three guards.
 */
export function expectContractStringExport(value: unknown, exportName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `gate expected ${exportName} to be a non-empty string exported by storage-contract.ts, received ${String(value)}`,
    )
  }
  return value
}

/** A numeric constant read straight off the contract module; see expectContractStringExport for why. */
export function expectContractNumberExport(value: unknown, exportName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `gate expected ${exportName} to be a number exported by storage-contract.ts, received ${String(value)}`,
    )
  }
  return value
}

/** A Zod schema read off the package entry point; see expectContractStringExport for why this is checked by name. */
export function expectContractSchemaExport(
  value: unknown,
  exportName: string,
): { parse: (input: unknown) => unknown } {
  const candidate = value as { parse?: unknown } | undefined
  if (typeof candidate?.parse !== 'function') {
    throw new Error(`gate expected ${exportName} to be re-exported from src/index.ts`)
  }
  return candidate as { parse: (input: unknown) => unknown }
}
