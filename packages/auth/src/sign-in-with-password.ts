import {
  authPasswordSchema,
  authUserEmailSchema,
  type SignInWithPasswordOptions,
  type SignInWithPasswordResult,
} from './auth-contract.ts'
import { authInputInvalidFailure, authRequestFailedFailure } from './auth-failure-results.ts'
import { readAuthServerApiEndpoint } from './auth-server-api-endpoint.ts'
import { readAuthSignedInPayload } from './auth-signed-in-payload.ts'
import { thrownAuthErrorToFailure } from './thrown-auth-error-failure.ts'

/**
 * Signs an existing user in with email and password. A wrong password and an address with no account
 * both come back as auth-invalid-credentials and are not told apart, because saying which half was
 * wrong would make this endpoint a user-enumeration oracle.
 */
export async function signInWithPassword(
  options: SignInWithPasswordOptions,
): Promise<SignInWithPasswordResult> {
  const parsedEmail = authUserEmailSchema.safeParse(options.email)
  if (!parsedEmail.success) {
    return authInputInvalidFailure('email')
  }
  const parsedPassword = authPasswordSchema.safeParse(options.password)
  if (!parsedPassword.success) {
    return authInputInvalidFailure('password')
  }

  const signInEmail = readAuthServerApiEndpoint(options.authServerInstance, 'signInEmail')
  if (signInEmail === undefined) {
    return authRequestFailedFailure({
      authFailureDetail: 'this auth server instance carries no signInEmail endpoint',
    })
  }

  let returnedWithHeaders: unknown
  try {
    returnedWithHeaders = await signInEmail({
      body: { email: String(parsedEmail.data), password: String(parsedPassword.data) },
      returnHeaders: true,
    })
  } catch (thrownValue) {
    return thrownAuthErrorToFailure(thrownValue)
  }

  const payload = readAuthSignedInPayload(returnedWithHeaders, 'signInEmail')
  if (!payload.read) {
    return payload.failure
  }
  return {
    kind: 'auth-signed-in',
    authUser: payload.authUser,
    authSessionCookie: payload.authSessionCookie,
  }
}
