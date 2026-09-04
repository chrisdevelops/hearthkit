import { emailFailureSchema, type EmailFailure } from '../src/email-contract.ts'
import { gateSecretsThatMustNeverLeak } from './email-gate-transports.ts'

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
        `gate found a secret in a value returned by @hearthkit/email: ${serialized.slice(0, 400)}`,
      )
    }
  }
}

/**
 * Validates a returned failure against the contract union, which also checks its message prefix and
 * the 320-character cap on a recipient value, proves it carries no secret, then narrows it. Failures
 * are returned as values, never thrown.
 */
export function expectEmailFailure<TKind extends EmailFailure['kind']>(
  result: unknown,
  expectedKind: TKind,
): Extract<EmailFailure, { kind: TKind }> {
  expectValueCarriesNoSecret(result)

  const parsed = emailFailureSchema.safeParse(result)
  if (!parsed.success) {
    throw new Error(
      `gate expected a ${expectedKind} failure matching emailFailureSchema, received ${JSON.stringify(result)}`,
    )
  }
  return expectResultKind(parsed.data, expectedKind)
}

/**
 * A message prefix or constant read straight off the contract module. A contract rename leaves the
 * import undefined instead of throwing in this repo's Vitest setup, so a comparison against it could
 * pass while checking nothing; every such comparison goes through one of these two guards.
 */
export function expectContractStringExport(value: unknown, exportName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `gate expected ${exportName} to be a non-empty string exported by email-contract.ts, received ${String(value)}`,
    )
  }
  return value
}

/** A numeric constant read straight off the contract module; see expectContractStringExport for why. */
export function expectContractNumberExport(value: unknown, exportName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `gate expected ${exportName} to be a number exported by email-contract.ts, received ${String(value)}`,
    )
  }
  return value
}

/** How many times one string occurs in another, so a gate can prove a URL is both an href and visible text. */
export function countStringOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    throw new Error('gate cannot count occurrences of an empty string')
  }
  let occurrences = 0
  let searchFrom = 0
  for (;;) {
    const foundAt = haystack.indexOf(needle, searchFrom)
    if (foundAt === -1) {
      return occurrences
    }
    occurrences += 1
    searchFrom = foundAt + needle.length
  }
}
