import type {
  HandleStripeWebhookResult,
  PaymentsWebhookIgnoredReason,
  PaymentsWebhookOutcome,
  StripeEventId,
} from './payments-contract.ts'

/**
 * The two answers a verified delivery can end in, built in one place so both carry the event id and
 * the event type. An ignored delivery is a RESULT and not a failure: Stripe sends every event type an
 * endpoint is subscribed to and most of them are none of this package's business, so modelling that
 * as an error would make a webhook route log a stack trace on an ordinary Tuesday.
 */

/** What a verified delivery is, before this package decides what to do with it; the event's own clock, not ours. */
export type StripeWebhookDeliveryIdentity = {
  stripeEventId: StripeEventId
  stripeEventType: string
  eventCreatedAt: Date
}

/** Result when the delivery was acted on; a replay writes the same row and moves no count. */
export function paymentsWebhookProcessedResult(
  delivery: StripeWebhookDeliveryIdentity,
  webhookOutcome: PaymentsWebhookOutcome,
): HandleStripeWebhookResult {
  return {
    kind: 'payments-webhook-processed',
    stripeEventId: delivery.stripeEventId,
    stripeEventType: delivery.stripeEventType,
    webhookOutcome,
  }
}

/** Result when the delivery was verified but not acted on; every reason here is a normal state, not a mistake by anyone. */
export function paymentsWebhookIgnoredResult(
  delivery: StripeWebhookDeliveryIdentity,
  ignoredReason: PaymentsWebhookIgnoredReason,
): HandleStripeWebhookResult {
  return {
    kind: 'payments-webhook-ignored',
    stripeEventId: delivery.stripeEventId,
    stripeEventType: delivery.stripeEventType,
    ignoredReason,
  }
}
