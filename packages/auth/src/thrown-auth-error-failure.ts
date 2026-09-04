import {
  betterAuthEmailAlreadyRegisteredErrorCode,
  betterAuthInvalidCredentialsErrorCode,
  type AuthFailure,
} from './auth-contract.ts'
import {
  authDatabaseUnavailableFailure,
  authEmailAlreadyRegisteredFailure,
  authInvalidCredentialsFailure,
  authRequestFailedFailure,
} from './auth-failure-results.ts'
import { readThrownAuthErrorDetails } from './thrown-auth-error-details.ts'

/**
 * Turns anything a Better Auth server call threw into a named failure, so no public function of this
 * package ever throws. Every code comparison is exact equality and never a substring test:
 * `'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'.includes('USER_ALREADY_EXISTS')` is true, so a substring
 * match on the short form would appear to work and would hide the day the value changes.
 */
export function thrownAuthErrorToFailure(thrownValue: unknown): AuthFailure {
  const details = readThrownAuthErrorDetails(thrownValue)

  // Checked first because a database failure arrives as a raw Drizzle error rather than an APIError,
  // carries no code of its own, and would otherwise fall into the catch-all with the four codes an
  // operator can act on buried one .cause hop down.
  if (details.databaseFailureDetail !== undefined) {
    return authDatabaseUnavailableFailure(details.databaseFailureDetail)
  }
  if (details.authErrorCode === betterAuthInvalidCredentialsErrorCode) {
    return authInvalidCredentialsFailure()
  }
  if (details.authErrorCode === betterAuthEmailAlreadyRegisteredErrorCode) {
    return authEmailAlreadyRegisteredFailure()
  }
  return authRequestFailedFailure({
    authFailureDetail: details.authFailureDetail,
    ...(details.authErrorCode === undefined ? {} : { authErrorCode: details.authErrorCode }),
    ...(details.authErrorStatus === undefined ? {} : { authErrorStatus: details.authErrorStatus }),
  })
}
