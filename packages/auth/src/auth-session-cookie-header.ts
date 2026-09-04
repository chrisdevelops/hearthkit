import { authSessionCookieSchema, type AuthSessionCookie } from './auth-contract.ts'

/**
 * Turns the Set-Cookie lines a sign in produced into the request `Cookie` header value the next call
 * needs. A Set-Cookie line carries attributes — HttpOnly, Path, SameSite — that a request may not
 * send back, so only the `name=value` pair in front of the first semicolon survives, and several
 * cookies are joined with `; ` exactly as a browser would send them.
 *
 * The result is a bearer credential. It is returned because carrying it to the next call is its
 * whole job, and it must never be logged.
 */
export function readAuthSessionCookieHeader(
  responseHeaders: Headers | undefined,
): AuthSessionCookie | undefined {
  if (responseHeaders === undefined) {
    return undefined
  }
  const setCookieLines =
    typeof responseHeaders.getSetCookie === 'function'
      ? responseHeaders.getSetCookie()
      : [responseHeaders.get('set-cookie') ?? '']

  const cookiePairs = setCookieLines
    .map((setCookieLine) => setCookieLine.split(';')[0]?.trim() ?? '')
    .filter((cookiePair) => cookiePair.includes('='))

  if (cookiePairs.length === 0) {
    return undefined
  }
  const parsed = authSessionCookieSchema.safeParse(cookiePairs.join('; '))
  return parsed.success ? parsed.data : undefined
}
