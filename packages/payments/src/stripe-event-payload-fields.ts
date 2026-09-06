/**
 * The three readers every webhook path needs, written once because each one has an obvious spelling
 * beside it that answers wrongly rather than throwing.
 *
 * An expandable Stripe field is a string id in a delivery and an object only after a retrieve, and
 * the SDK types it as the union of both; reading `.id` off a string yields undefined and reading a
 * string off an object yields "[object Object]". Every Stripe timestamp is seconds since the epoch,
 * so `new Date(value)` without the multiplication lands in January 1970 and nothing complains.
 */

/** One metadata value, or nothing when the key is absent or empty; Stripe metadata values are always strings. */
export function readStripeMetadataValue(
  metadata: Record<string, string> | null | undefined,
  metadataKey: string,
): string | undefined {
  const value = metadata?.[metadataKey]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** The id of an expandable Stripe reference, whether the payload carried the string or the whole object. */
export function readStripeReferenceId(
  reference: string | { id?: string } | null | undefined,
): string | undefined {
  if (typeof reference === 'string') {
    return reference.length > 0 ? reference : undefined
  }
  if (typeof reference === 'object' && reference !== null && typeof reference.id === 'string') {
    return reference.id.length > 0 ? reference.id : undefined
  }
  return undefined
}

/** A Stripe timestamp as a Date; Stripe counts seconds since the epoch and JavaScript counts milliseconds. */
export function readStripeSecondsAsDate(secondsSinceEpoch: number | null | undefined): Date | null {
  if (typeof secondsSinceEpoch !== 'number' || !Number.isFinite(secondsSinceEpoch)) {
    return null
  }
  return new Date(secondsSinceEpoch * 1000)
}
