/**
 * The one sentence both shipped templates print about how long a link lasts, or nothing at all when
 * the caller omitted the expiry. Shared so the two templates cannot word the same fact differently,
 * and absent rather than vague so generic copy never states a duration nobody supplied.
 */
export function buildEmailExpirySentence(expiryMinutes: number | undefined): string | undefined {
  if (expiryMinutes === undefined) {
    return undefined
  }
  return `This link expires in ${expiryMinutes} ${expiryMinutes === 1 ? 'minute' : 'minutes'}.`
}
