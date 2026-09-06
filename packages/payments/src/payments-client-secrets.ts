import type { PaymentsClient } from './payments-contract.ts'
import { redactPaymentsSecrets } from './redact-payments-secrets.ts'

/**
 * The two secrets a client was built with, held beside the handle rather than on it. `PaymentsClient`
 * carries the webhook secret because handing it to `handleStripeWebhook` is its whole job, but it
 * deliberately does not carry the API key — the Stripe client already holds that internally — so the
 * key is kept in a WeakMap here, where nothing can serialise it and it dies with the handle.
 */

type PaymentsClientSecrets = {
  stripeSecretKey: string
  stripeWebhookSecret: string
}

const secretsByPaymentsClient = new WeakMap<PaymentsClient, PaymentsClientSecrets>()

/** Records the secrets a client was built with, so a failure can scrub them out of Stripe's own words. */
export function rememberPaymentsClientSecrets(
  paymentsClient: PaymentsClient,
  secrets: PaymentsClientSecrets,
): void {
  secretsByPaymentsClient.set(paymentsClient, secrets)
}

/** Every secret that must never appear in a message this client produces; empty for a handle this package did not build. */
export function readPaymentsClientSecrets(
  paymentsClient: PaymentsClient | undefined,
): readonly string[] {
  if (paymentsClient === undefined) {
    return []
  }
  const secrets = secretsByPaymentsClient.get(paymentsClient)
  const webhookSecret = String(paymentsClient.stripeWebhookSecret ?? '')
  if (secrets === undefined) {
    return webhookSecret.length > 0 ? [webhookSecret] : []
  }
  return [secrets.stripeSecretKey, secrets.stripeWebhookSecret, webhookSecret]
}

/** Third-party text with this client's secrets removed, ready to quote into a returned failure. */
export function redactPaymentsClientSecrets(
  text: string,
  paymentsClient: PaymentsClient | undefined,
): string {
  return redactPaymentsSecrets(text, readPaymentsClientSecrets(paymentsClient))
}
