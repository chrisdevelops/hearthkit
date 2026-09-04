import { z } from 'zod'
import {
  authUserSchema,
  type AuthFailure,
  type AuthSessionCookie,
  type AuthUser,
} from './auth-contract.ts'
import { authRequestFailedFailure } from './auth-failure-results.ts'
import { readAuthSessionCookieHeader } from './auth-session-cookie-header.ts'

/**
 * The user and the request Cookie header shared by every route into a session: sign up, password
 * sign in and magic link verification all answer with a user and a Set-Cookie, so they all read the
 * same way.
 *
 * Server calls are made with `returnHeaders: true`, which answers `{ headers, response }`. That is
 * how the session cookie is reached at all: the endpoint's JSON body carries the session token, and
 * this package does not return that token, so the cookie has to come off the headers.
 */

const signedInAnswerSchema = z.object({
  headers: z.instanceof(Headers),
  response: z.object({ user: authUserSchema }),
})

/** What one signed-in answer yielded: the user and the cookie, or the failure to report instead. */
export type AuthSignedInPayload =
  | { read: true; authUser: AuthUser; authSessionCookie: AuthSessionCookie }
  | { read: false; failure: AuthFailure }

/** Reads the user and the session cookie out of one `returnHeaders: true` answer. */
export function readAuthSignedInPayload(
  returnedWithHeaders: unknown,
  endpointName: string,
): AuthSignedInPayload {
  const parsedAnswer = signedInAnswerSchema.safeParse(returnedWithHeaders)
  if (!parsedAnswer.success) {
    return {
      read: false,
      failure: authRequestFailedFailure({
        authFailureDetail: `Better Auth answered ${endpointName} without a user this package can read as an AuthUser`,
      }),
    }
  }

  const authSessionCookie = readAuthSessionCookieHeader(parsedAnswer.data.headers)
  if (authSessionCookie === undefined) {
    return {
      read: false,
      failure: authRequestFailedFailure({
        authFailureDetail: `Better Auth answered ${endpointName} without a session cookie, so no session was created`,
      }),
    }
  }

  return {
    read: true,
    authUser: parsedAnswer.data.response.user,
    authSessionCookie,
  }
}
