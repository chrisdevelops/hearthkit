// The literal that stands in for a secret wherever one would otherwise have reached a message. It is
// a fixed string rather than a length-preserving mask so nothing about the secret survives redaction.
const redactedSecretMarker = '[redacted]'

/**
 * Replaces every occurrence of the configured secrets in third-party error text, so the Stripe SDK's
 * own words can be quoted in a failure without carrying the API key or the signing secret out with
 * them; the rule is absolute but the words belong to somebody else.
 */
export function redactPaymentsSecrets(text: string, secrets: readonly string[]): string {
  let redactedText = text
  for (const secret of secrets) {
    if (secret.length > 0) {
      redactedText = redactedText.replaceAll(secret, redactedSecretMarker)
    }
  }
  return redactedText
}
