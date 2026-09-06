import { paymentsFailureSchema, type PaymentsFailure } from '../src/payments-contract.ts'
import { gateSecretsThatMustNeverLeak } from './payments-gate-values.ts'

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

/**
 * Fails the gate when a secret the gates handed the package appears anywhere in a value it returned.
 * CONTRACT.md marks StripeSecretKey and StripeWebhookSecret secret with no exceptions and requires
 * the implementation to scrub both out of text a third-party library produced, so this runs over
 * every result a gate asserts on rather than only the ones that plausibly carry one.
 */
export function expectValueCarriesNoSecret(result: unknown): void {
  const serialized = JSON.stringify(result) ?? String(result)
  for (const secret of gateSecretsThatMustNeverLeak) {
    if (serialized.includes(secret)) {
      throw new Error(
        `gate found a secret in a value returned by @hearthkit/payments: ${serialized.slice(0, 400)}`,
      )
    }
  }
}

/**
 * Validates a returned failure against the contract union, which also checks its unique message
 * prefix, proves it carries no secret, then narrows it. Failures are returned as values here, never
 * thrown, so a gate that receives a thrown error has found a contract violation rather than a failing
 * assertion.
 */
export function expectPaymentsFailure<TKind extends PaymentsFailure['kind']>(
  result: unknown,
  expectedKind: TKind,
): Extract<PaymentsFailure, { kind: TKind }> {
  expectValueCarriesNoSecret(result)

  const parsed = paymentsFailureSchema.safeParse(result)
  if (!parsed.success) {
    throw new Error(
      `gate expected a ${expectedKind} failure matching paymentsFailureSchema, received ${JSON.stringify(result)}`,
    )
  }
  return expectResultKind(parsed.data, expectedKind)
}

/**
 * The one element an array must hold, narrowed for the type checker. A `toHaveLength(1)` expectation
 * proves the length at run time but narrows nothing, so `items[0]` is still `T | undefined` under the
 * repo's noUncheckedIndexedAccess; this reads the element through a check that throws instead, so a
 * list of the wrong length is still a loud gate failure rather than a silently skipped block.
 */
export function expectOnlyGateElement<TElement>(
  items: readonly TElement[],
  elementDescription: string,
): TElement {
  const [onlyItem, ...furtherItems] = items
  if (onlyItem === undefined || furtherItems.length > 0) {
    throw new Error(
      `gate expected exactly one ${elementDescription}, received ${items.length}: ${JSON.stringify(items)}`,
    )
  }
  return onlyItem
}

/**
 * The same names as plain sorted strings. Every name list the contract returns is branded or a
 * literal union, and comparing those lists whole is what makes a failure name every wrong entry at
 * once instead of stopping at the first.
 */
export function sortedGateNames(names: readonly unknown[]): string[] {
  return names.map(String).toSorted()
}

/**
 * A message prefix or constant read straight off the contract module. A contract rename leaves the
 * import undefined instead of throwing in this repo's Vitest setup, so a comparison against it could
 * pass while checking nothing; every such comparison goes through this guard.
 */
export function expectContractStringExport(value: unknown, exportName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `gate expected ${exportName} to be a non-empty string exported by payments-contract.ts, received ${String(value)}`,
    )
  }
  return value
}

/** Seconds since the epoch as Stripe reports every timestamp, turned into the Date a contract schema coerces to. */
export function gateDateFromStripeSeconds(secondsSinceEpoch: number): Date {
  return new Date(secondsSinceEpoch * 1000)
}
