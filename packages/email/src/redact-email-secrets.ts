// The literal that stands in for a secret wherever one would otherwise have reached a message. It is
// a fixed string rather than a length-preserving mask so nothing about the secret survives redaction.
const redactedSecretMarker = '[redacted]'

/**
 * Replaces every occurrence of the given secrets in third-party error text, so a transport library's
 * own words can be quoted in a failure without carrying a password or an API key out with them.
 */
export function redactEmailSecrets(text: string, secrets: readonly string[]): string {
  let redactedText = text
  for (const secret of secrets) {
    if (secret.length > 0) {
      redactedText = redactedText.replaceAll(secret, redactedSecretMarker)
    }
  }
  return redactedText
}
