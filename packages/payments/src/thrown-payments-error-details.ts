import { paymentsDatabaseUnavailableCauseCodes } from './payments-contract.ts'

/**
 * Reads a thrown Stripe or Drizzle value without asserting anything about its shape. Every access
 * path here is measured at stripe@22.6.1 and drizzle-orm@0.45.2, and the obvious spelling beside each
 * one returns a plausible wrong answer rather than throwing, which is why they are read in one place
 * instead of at each call site:
 *
 * - `error.type` is the SDK CLASS NAME, because StripeError's constructor sets
 *   `this.type = type || this.constructor.name`. Stripe's own type string — `invalid_request_error`
 *   and friends — is at `error.rawType`, so switching on `error.type` expecting the API's vocabulary
 *   matches nothing and routes every case to the catch-all, silently;
 * - the HTTP status is at `error.statusCode`, the API error code at `error.code`, and the offending
 *   parameter name at `error.param`, all straight off the raw error body;
 * - a database failure carries no code on the thrown value at all; it sits one `.cause` hop down, and
 *   one call can throw from two unrelated families — an AggregateError and pg's DatabaseError.
 */

// The SDK class names, read off stripe@22.6.1's esm/Error.js where each subclass passes its own name
// to the base constructor: StripeConnectionError at :164 and StripeSignatureVerificationError at :176.
/** SDK class name of the error a request-level network failure or a timeout produces. */
export const stripeConnectionErrorTypeName = 'StripeConnectionError'

/** SDK class name of the error webhook signature verification throws; it also carries the raw body on `.payload`, which is never read. */
export const stripeSignatureVerificationErrorTypeName = 'StripeSignatureVerificationError'

// Deep enough for a DrizzleQueryError wrapping a pg DatabaseError, or an AggregateError listing the
// attempts it made, and bounded so a self-referencing cause cannot spin.
const maximumErrorCauseHops = 6

/** What a thrown payments call yielded, with each value read from the spelling that actually carries it. */
export type ThrownPaymentsErrorDetails = {
  stripeErrorTypeName: string | undefined
  stripeErrorCode: string | undefined
  stripeErrorStatus: number | undefined
  stripeErrorParam: string | undefined
  databaseFailureDetail: string | undefined
  paymentsFailureDetail: string
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

/** True when a thrown value is an object carrying the named property, which is all reading it by name needs. */
function hasErrorProperty(error: unknown, propertyName: string): error is Record<string, unknown> {
  return typeof error === 'object' && error !== null && propertyName in error
}

function readStringProperty(error: unknown, propertyName: string): string | undefined {
  if (!hasErrorProperty(error, propertyName)) {
    return undefined
  }
  const value = error[propertyName]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readIntegerProperty(error: unknown, propertyName: string): number | undefined {
  if (!hasErrorProperty(error, propertyName)) {
    return undefined
  }
  const value = error[propertyName]
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
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
    // A dead port arrives as an AggregateError whose own `code` is ECONNREFUSED, while an absent
    // table arrives as a pg DatabaseError; one handler has to read both families.
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
    const code = readStringProperty(related, 'code')
    if (
      code !== undefined &&
      (paymentsDatabaseUnavailableCauseCodes as readonly string[]).includes(code)
    ) {
      // Built from the cause and never from the DrizzleQueryError that wraps it: the wrapper's
      // message repeats the failing statement AND its bound parameters, which on these tables would
      // put a customer's address and Stripe ids into a failure a caller is likely to log.
      return `Postgres reported ${code}: ${readErrorMessage(related) ?? readErrorName(related) ?? 'no message'}`
    }
  }
  return undefined
}

/** Reads a thrown value once, so no call site has to remember which of the plausible spellings is real. */
export function readThrownPaymentsErrorDetails(thrownValue: unknown): ThrownPaymentsErrorDetails {
  const stripeErrorStatus = readIntegerProperty(thrownValue, 'statusCode')
  const statusSuffix =
    stripeErrorStatus === undefined ? '' : ` with status ${String(stripeErrorStatus)}`

  return {
    stripeErrorTypeName: readStringProperty(thrownValue, 'type'),
    stripeErrorCode: readStringProperty(thrownValue, 'code'),
    stripeErrorStatus,
    stripeErrorParam: readStringProperty(thrownValue, 'param'),
    databaseFailureDetail: readDatabaseFailureDetail(thrownValue),
    // Never empty: a failure variant carrying an empty detail would fail its own schema, and some
    // thrown values carry only a name.
    paymentsFailureDetail:
      readErrorMessage(thrownValue) ??
      `${readErrorName(thrownValue) ?? 'an error with no message'}${statusSuffix}`,
  }
}
