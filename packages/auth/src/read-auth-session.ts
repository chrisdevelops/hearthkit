import {
  authRequestHeadersSchema,
  authSessionSchema,
  authUserSchema,
  type ReadAuthSessionOptions,
  type ReadAuthSessionResult,
} from './auth-contract.ts'
import { authRequestFailedFailure } from './auth-failure-results.ts'
import { readAuthServerApiEndpoint } from './auth-server-api-endpoint.ts'
import { thrownAuthErrorToFailure } from './thrown-auth-error-failure.ts'

/**
 * Who is signed in for this request. `requestHeaders` is whatever Next's `await headers()` returned;
 * it is duck-typed on `.get` and passed through unchanged, so Next's read-only headers object works
 * without being an `instanceof Headers`.
 *
 * An expired or missing cookie is auth-session-absent, not a failure. Nobody being signed in is a
 * normal answer to "who is signed in", and modelling it as an error would send every server
 * component's happy path through a catch.
 *
 * The returned session deliberately omits its token: a result value is exactly the sort of thing
 * that ends up in a log line, and the token authenticates a request.
 */
export async function readAuthSession(
  options: ReadAuthSessionOptions,
): Promise<ReadAuthSessionResult> {
  if (!authRequestHeadersSchema.safeParse(options.requestHeaders).success) {
    return authRequestFailedFailure({
      authFailureDetail: 'requestHeaders must be a Headers-like object carrying a get method',
    })
  }

  const getSession = readAuthServerApiEndpoint(options.authServerInstance, 'getSession')
  if (getSession === undefined) {
    return authRequestFailedFailure({
      authFailureDetail: 'this auth server instance carries no getSession endpoint',
    })
  }

  let sessionResponse: unknown
  try {
    sessionResponse = await getSession({ headers: options.requestHeaders })
  } catch (thrownValue) {
    return thrownAuthErrorToFailure(thrownValue)
  }

  if (typeof sessionResponse !== 'object' || sessionResponse === null) {
    return { kind: 'auth-session-absent' }
  }

  const { session, user } = sessionResponse as { session?: unknown; user?: unknown }
  if (session === undefined || session === null || user === undefined || user === null) {
    return { kind: 'auth-session-absent' }
  }

  const parsedSession = authSessionSchema.safeParse(session)
  const parsedUser = authUserSchema.safeParse(user)
  if (!parsedSession.success || !parsedUser.success) {
    return authRequestFailedFailure({
      authFailureDetail:
        'Better Auth reported a session this package cannot read as an AuthSession and AuthUser pair',
    })
  }

  return { kind: 'auth-session-active', authSession: parsedSession.data, authUser: parsedUser.data }
}
