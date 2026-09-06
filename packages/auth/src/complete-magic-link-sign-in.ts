import {
  magicLinkErrorQueryParameterName,
  magicLinkTokenQueryParameterName,
  type CompleteMagicLinkSignInOptions,
  type CompleteMagicLinkSignInResult,
} from './auth-contract.ts'
import {
  authInputInvalidFailure,
  authMagicLinkInvalidFailure,
  authRequestFailedFailure,
} from './auth-failure-results.ts'
import { readAuthServerApiEndpoint } from './auth-server-api-endpoint.ts'
import { readAuthSignedInPayload } from './auth-signed-in-payload.ts'
import { readThrownAuthErrorDetails } from './thrown-auth-error-details.ts'
import { thrownAuthErrorToFailure } from './thrown-auth-error-failure.ts'

/**
 * Consumes a magic link. It takes the whole URL — read from the plain text part of the message,
 * never the HTML part — and sends only its `token`, dropping the link's own `callbackURL`. That is
 * what makes a good token answer 200 with JSON and a Set-Cookie rather than a 302 this function
 * would then have to follow, and it makes the failure arm unambiguous: with no callbackURL on the
 * request, any 302 from this call is a rejected token.
 *
 * A rejection carries no code anywhere. Measured at better-auth@1.7.2, it throws a plain Error with
 * `statusCode: 302`, an empty message and `instanceof APIError === false`; the only place the reason
 * exists is the `error` query parameter of the redirect `location`, read from the thrown value's own
 * Headers instance. An implementation that inspects thrown error codes lets a rejected link look
 * like a success.
 *
 * The token is consumed atomically on the first verification, so a second call with the same link
 * always fails, and Better Auth cannot tell an expired token from a consumed or unknown one.
 */
export async function completeMagicLinkSignIn(
  options: CompleteMagicLinkSignInOptions,
): Promise<CompleteMagicLinkSignInResult> {
  let magicLinkToken: string | null = null
  try {
    magicLinkToken = new URL(options.magicLinkUrl).searchParams.get(
      magicLinkTokenQueryParameterName,
    )
  } catch {
    return authInputInvalidFailure('magic-link-url')
  }
  if (magicLinkToken === null || magicLinkToken.length === 0) {
    return authInputInvalidFailure('magic-link-url')
  }

  const magicLinkVerify = readAuthServerApiEndpoint(options.authServerInstance, 'magicLinkVerify')
  if (magicLinkVerify === undefined) {
    return authRequestFailedFailure({
      authFailureDetail: 'this auth server instance carries no magicLinkVerify endpoint',
    })
  }

  let returnedWithHeaders: unknown
  try {
    returnedWithHeaders = await magicLinkVerify({
      query: { [magicLinkTokenQueryParameterName]: magicLinkToken },
      headers: new Headers(),
      returnHeaders: true,
    })
  } catch (thrownValue) {
    const details = readThrownAuthErrorDetails(thrownValue)
    if (details.redirectLocation !== undefined) {
      const betterAuthErrorValue = readRedirectErrorValue(details.redirectLocation)
      if (betterAuthErrorValue !== undefined) {
        return authMagicLinkInvalidFailure(betterAuthErrorValue)
      }
    }
    return thrownAuthErrorToFailure(thrownValue)
  }

  const payload = readAuthSignedInPayload(returnedWithHeaders, 'magicLinkVerify')
  if (!payload.read) {
    return payload.failure
  }
  return {
    kind: 'auth-signed-in',
    authUser: payload.authUser,
    authSessionCookie: payload.authSessionCookie,
  }
}

/** The `error` query parameter of a failure redirect, which is the only place the rejection reason exists. */
function readRedirectErrorValue(redirectLocation: string): string | undefined {
  let errorValue: string | null = null
  try {
    errorValue = new URL(redirectLocation).searchParams.get(magicLinkErrorQueryParameterName)
  } catch {
    return undefined
  }
  return errorValue === null || errorValue.length === 0 ? undefined : errorValue
}
