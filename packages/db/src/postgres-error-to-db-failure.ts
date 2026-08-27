import type { DbFailure } from './db-contract.js'
import {
  databasePrivilegeDeniedFailure,
  databaseServerUnreachableFailure,
} from './db-failure-results.js'
import {
  describeCaughtError,
  isPostgresConnectionFailure,
  isPostgresPrivilegeFailure,
} from './postgres-error-classification.js'

/**
 * Maps the two driver errors every lifecycle function shares onto their contract failures. Returns
 * undefined for anything else, so a caller can decide whether it has a better name for it.
 */
export function mapPostgresErrorToDbFailure(error: unknown): DbFailure | undefined {
  if (isPostgresConnectionFailure(error)) {
    return databaseServerUnreachableFailure(describeCaughtError(error))
  }
  if (isPostgresPrivilegeFailure(error)) {
    return databasePrivilegeDeniedFailure(describeCaughtError(error))
  }
  return undefined
}

/**
 * Same mapping, but rethrows anything the contract does not name. A failure mode that did not
 * happen is worse than a stack trace, so unmapped driver errors stay visible.
 */
export function postgresErrorToDbFailureOrThrow(error: unknown): DbFailure {
  const failure = mapPostgresErrorToDbFailure(error)
  if (failure === undefined) {
    throw error
  }
  return failure
}
