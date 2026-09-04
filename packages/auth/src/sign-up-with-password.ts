import {
  authPasswordSchema,
  authUserEmailSchema,
  authUserNameSchema,
  type SignUpWithPasswordOptions,
  type SignUpWithPasswordResult,
} from './auth-contract.ts'
import { authInputInvalidFailure, authRequestFailedFailure } from './auth-failure-results.ts'
import { readAuthServerApiEndpoint } from './auth-server-api-endpoint.ts'
import { readAuthSignedInPayload } from './auth-signed-in-payload.ts'
import { thrownAuthErrorToFailure } from './thrown-auth-error-failure.ts'

/**
 * Creates the user and the first session in one call, because this package pins automatic sign in
 * on. Email, password and name are plain strings because they come from a form, and all three are
 * validated here before Postgres is touched: validating them late produces a diagnostic that points
 * at the wrong cause.
 *
 * The password length check runs here and the same two numbers are passed to `betterAuth()` as
 * minPasswordLength and maxPasswordLength, so a password this package accepts can never be rejected
 * downstream with a different message.
 *
 * An address that already has an account is auth-email-already-registered, matched on the long
 * error code by exact equality — see thrown-auth-error-failure.ts.
 */
export async function signUpWithPassword(
  options: SignUpWithPasswordOptions,
): Promise<SignUpWithPasswordResult> {
  const parsedEmail = authUserEmailSchema.safeParse(options.email)
  if (!parsedEmail.success) {
    return authInputInvalidFailure('email')
  }
  const parsedPassword = authPasswordSchema.safeParse(options.password)
  if (!parsedPassword.success) {
    return authInputInvalidFailure('password')
  }
  const parsedName = authUserNameSchema.safeParse(options.name)
  if (!parsedName.success) {
    return authInputInvalidFailure('name')
  }

  const signUpEmail = readAuthServerApiEndpoint(options.authServerInstance, 'signUpEmail')
  if (signUpEmail === undefined) {
    return authRequestFailedFailure({
      authFailureDetail: 'this auth server instance carries no signUpEmail endpoint',
    })
  }

  let returnedWithHeaders: unknown
  try {
    returnedWithHeaders = await signUpEmail({
      body: {
        email: String(parsedEmail.data),
        password: String(parsedPassword.data),
        name: String(parsedName.data),
      },
      returnHeaders: true,
    })
  } catch (thrownValue) {
    return thrownAuthErrorToFailure(thrownValue)
  }

  const payload = readAuthSignedInPayload(returnedWithHeaders, 'signUpEmail')
  if (!payload.read) {
    return payload.failure
  }
  return {
    kind: 'auth-signed-up',
    authUser: payload.authUser,
    authSessionCookie: payload.authSessionCookie,
  }
}
