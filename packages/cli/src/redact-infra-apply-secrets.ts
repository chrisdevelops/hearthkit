// The literal that stands in for a secret wherever one would otherwise have reached a message. Fixed
// rather than length-preserving, so nothing about the secret survives redaction.
const redactedSecretMarker = '[redacted]'

/**
 * Replaces every occurrence of the four infra apply secret values in text that came from tofu, so
 * tofu's own words can be quoted in a failure without carrying the Cloudflare token, either state
 * credential or the state passphrase out with them; the rule is absolute, the words are tofu's.
 */
export function redactInfraApplySecrets(text: string, secretValues: readonly string[]): string {
  let redactedText = text
  for (const secretValue of secretValues) {
    if (secretValue.length > 0) {
      redactedText = redactedText.replaceAll(secretValue, redactedSecretMarker)
    }
  }
  return redactedText
}
