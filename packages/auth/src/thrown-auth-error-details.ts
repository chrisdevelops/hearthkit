/**
 * Reads a thrown Better Auth or Drizzle value without asserting anything about its shape. Every
 * access path here is measured at better-auth@1.7.2, and the obvious spelling beside each one
 * returns `undefined` rather than throwing, which is why they are read in one place instead of at
 * each call site:
 *
 * - the error code is at `error.body?.code`; `error.code` is always undefined, and `error.body` is
 *   itself undefined on at least one measured APIError, so the optional read is required;
 * - the HTTP status number is at `error.statusCode`; `error.status` is the string name;
 * - a magic link rejection carries no code at all, only the `location` header of a 302, and
 *   `error.headers` is a real Headers instance so `error.headers.location` is undefined;
 * - a database failure carries no code on the thrown value; it sits one `.cause` hop down.
 */

// An allowlist, deliberately not "any cause carrying a code". 23505 is a unique violation, which is
// a caller error rather than an unavailable database, and the organization slug path can race into
// one; routing it here would tell an operator to fix their infrastructure over a duplicate row.
const databaseUnavailablePostgresCodes: readonly string[] = [
  'ECONNREFUSED',
  '42P01',
  '3D000',
  '28P01',
]

// Deep enough for a DrizzleQueryError wrapping a pg DatabaseError, or an AggregateError listing the
// attempts it made, and bounded so a self-referencing cause cannot spin.
const maximumErrorCauseHops = 6

/** What a thrown auth call yielded, with each value read from the spelling that actually carries it. */
export type ThrownAuthErrorDetails = {
  authErrorCode: string | undefined
  authErrorStatus: number | undefined
  redirectLocation: string | undefined
  databaseFailureDetail: string | undefined
  authFailureDetail: string
}

function readErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return typeof error.message === 'string' && error.message.length > 0 ? error.message : undefined
  }
  return undefined
}

function readErrorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return typeof error.name === 'string' && error.name.length > 0 ? error.name : undefined
  }
  return undefined
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' && error.code.length > 0 ? error.code : undefined
  }
  return undefined
}

function readErrorStatusCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    return typeof error.statusCode === 'number' && Number.isInteger(error.statusCode)
      ? error.statusCode
      : undefined
  }
  return undefined
}

function readErrorBodyCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('body' in error)) {
    return undefined
  }
  const { body } = error
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return undefined
  }
  return typeof body.code === 'string' && body.code.length > 0 ? body.code : undefined
}

function readErrorRedirectLocation(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('headers' in error)) {
    return undefined
  }
  const { headers } = error
  if (!(headers instanceof Headers)) {
    return undefined
  }
  const location = headers.get('location')
  return location !== null && location.length > 0 ? location : undefined
}

/** Every value reachable from a thrown error by `.cause` hops and by an AggregateError's own list. */
function relatedThrownValues(thrownValue: unknown): unknown[] {
  const related: unknown[] = []
  const pending: unknown[] = [thrownValue]
  while (pending.length > 0 && related.length < maximumErrorCauseHops) {
    const current = pending.shift()
    if (typeof current !== 'object' || current === null) {
      continue
    }
    related.push(current)
    if ('cause' in current && current.cause !== undefined) {
      pending.push(current.cause)
    }
    // One call can throw from two unrelated error families: a dead port arrives as an AggregateError
    // whose own `code` is ECONNREFUSED, while an absent table arrives as a pg DatabaseError.
    if ('errors' in current && Array.isArray(current.errors)) {
      for (const aggregated of current.errors) {
        pending.push(aggregated)
      }
    }
  }
  return related
}

function readDatabaseFailureDetail(thrownValue: unknown): string | undefined {
  for (const related of relatedThrownValues(thrownValue)) {
    const code = readErrorCode(related)
    if (code !== undefined && databaseUnavailablePostgresCodes.includes(code)) {
      // Built from the cause rather than from the DrizzleQueryError that wraps it: the wrapper's
      // message repeats the failing statement and its bound parameters, which is both noisier and a
      // place a caller-supplied value could turn up in a returned failure.
      return `Postgres reported ${code}: ${readErrorMessage(related) ?? readErrorName(related) ?? 'no message'}`
    }
  }
  return undefined
}

/** Reads a thrown value once, so no call site has to remember which of the plausible spellings is real. */
export function readThrownAuthErrorDetails(thrownValue: unknown): ThrownAuthErrorDetails {
  const authErrorStatus = readErrorStatusCode(thrownValue)
  const statusSuffix =
    authErrorStatus === undefined ? '' : ` with status ${String(authErrorStatus)}`

  return {
    authErrorCode: readErrorBodyCode(thrownValue),
    authErrorStatus,
    redirectLocation: readErrorRedirectLocation(thrownValue),
    databaseFailureDetail: readDatabaseFailureDetail(thrownValue),
    // Never empty: a rejected magic link throws an Error whose message is the empty string, and a
    // failure variant carrying an empty detail would fail its own schema.
    authFailureDetail:
      readErrorMessage(thrownValue) ??
      `${readErrorName(thrownValue) ?? 'an error with no message'}${statusSuffix}`,
  }
}
