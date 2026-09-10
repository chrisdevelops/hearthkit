import { authFailureSchema, type AuthFailure } from '../src/auth-contract.ts'
import { gateSecretsThatMustNeverLeak } from './auth-gate-values.ts'

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
 * CONTRACT.md marks AuthSecret, OauthClientSecret and AuthPassword secret with no exceptions, so this
 * runs over every failure a gate asserts on rather than only the ones that plausibly carry one.
 */
export function expectValueCarriesNoSecret(result: unknown): void {
  const serialized = JSON.stringify(result) ?? String(result)
  for (const secret of gateSecretsThatMustNeverLeak) {
    if (serialized.includes(secret)) {
      throw new Error(
        `gate found a secret in a value returned by @hearthkit/auth: ${serialized.slice(0, 400)}`,
      )
    }
  }
}

/**
 * Validates a returned failure against the contract union, which also checks its unique message prefix,
 * proves it carries no secret, then narrows it. Failures are returned as values here, never thrown, so
 * a gate that receives a thrown error has found a contract violation rather than a failing assertion.
 */
export function expectAuthFailure<TKind extends AuthFailure['kind']>(
  result: unknown,
  expectedKind: TKind,
): Extract<AuthFailure, { kind: TKind }> {
  expectValueCarriesNoSecret(result)

  const parsed = authFailureSchema.safeParse(result)
  if (!parsed.success) {
    throw new Error(
      `gate expected a ${expectedKind} failure matching authFailureSchema, received ${JSON.stringify(result)}`,
    )
  }
  return expectResultKind(parsed.data, expectedKind)
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
      `gate expected ${exportName} to be a non-empty string exported by auth-contract.ts, received ${String(value)}`,
    )
  }
  return value
}

/**
 * Better Auth's own literals and statuses, measured at better-auth@1.7.2 and kept here rather than on
 * @hearthkit/auth's surface: a gate is their only reader, so publishing them would make an upstream
 * spelling part of this package's public contract. Re-measure them on every dependency bump.
 */

/** The `error` query parameter value a rejected magic link redirect carries; the only place the rejection is spelled. */
export const betterAuthInvalidTokenErrorValue = 'INVALID_TOKEN'

/** `error.body?.code` when createOrganization is called with a slug that is already taken; adjacent to the near-miss ORGANIZATION_SLUG_ALREADY_TAKEN, which this endpoint never throws. */
export const betterAuthOrganizationAlreadyExistsErrorCode = 'ORGANIZATION_ALREADY_EXISTS'

/** The status a server built with organizations off answers an organization route with: the route is not mounted at all. */
export const organizationRouteAbsentHttpStatus = 404

/** The status a server built with organizations on answers the same route with when the request carries no session. */
export const organizationRouteUnauthorizedHttpStatus = 401
