import {
  hearthkitBillingReferenceMetadataKey,
  hearthkitBillingScopeMetadataKey,
  hearthkitPriceNameMetadataKey,
  hearthkitQuantityMetadataKey,
  hearthkitStripePriceIdMetadataKey,
  stripeSignatureHeaderName,
  type BillingScope,
  type PaymentsClient,
} from '../src/payments-contract.ts'
import { gateStripeWebhookSecret, uniqueGatePaymentsToken } from './payments-gate-values.ts'

/**
 * Stripe event bodies synthesised locally and signed locally. CONTRACT.md's Decision 7 is what makes
 * this possible: `generateTestHeaderString` computes `t=<unix seconds>,v1=<hmac>` with no network, so
 * every handleStripeWebhook gate — both signature failures, all six ignored reasons, the purchase
 * path and the three-step subscription replay — runs with no Stripe key and no Stripe CLI.
 *
 * The signer is read off the Stripe client the package itself built and handed back on its client
 * handle, so these fixtures depend on no `stripe` import of their own and cannot sign with a
 * different SDK version than the one the implementation verifies with.
 */

/** A signed delivery, in the two pieces handleStripeWebhook takes plus the ids a gate asserts back. */
export type GateStripeWebhookDelivery = {
  stripeEventId: string
  createdSecondsSinceEpoch: number
  rawRequestBody: string
  requestHeaders: Headers
}

/** Seconds since the epoch, which is how every Stripe timestamp is spelled, including an event's `created`. */
export function gateNowSecondsSinceEpoch(): number {
  return Math.floor(Date.now() / 1000)
}

/** A Stripe-shaped opaque id unique to this call; the gates never parse one, they only carry it back out. */
export function uniqueGateStripeId(prefix: string): string {
  return `${prefix}_gate_${uniqueGatePaymentsToken()}`
}

/** The two metadata keys createCheckoutSession writes on every session and on subscription_data. */
export function gateBillingReferenceMetadata(
  billingReferenceId: string,
  billingScope: BillingScope = 'user',
): Record<string, string> {
  return {
    [hearthkitBillingReferenceMetadataKey]: billingReferenceId,
    [hearthkitBillingScopeMetadataKey]: billingScope,
  }
}

/**
 * The three metadata keys createCheckoutSession writes on the session and never on
 * subscription_data.metadata. They exist because a webhook delivery carries no `line_items` — the
 * field is optional and only a retrieve expands it — so the purchase path has no other source for
 * what it sold. `quantity` is a decimal string, because every Stripe metadata value is a string.
 */
export function gateCheckoutPriceMetadata(
  priceName: string,
  stripePriceId: string,
  quantity: number | string,
): Record<string, string> {
  return {
    [hearthkitPriceNameMetadataKey]: priceName,
    [hearthkitStripePriceIdMetadataKey]: stripePriceId,
    [hearthkitQuantityMetadataKey]: String(quantity),
  }
}

/** Everything a synthesised Checkout Session carries; every field here is a plain, non-expandable one except the three ids. */
export type GateCheckoutSessionOptions = {
  stripeCheckoutSessionId: string
  stripeCustomerId: string
  checkoutMode: 'payment' | 'setup' | 'subscription'
  paymentStatus: 'no_payment_required' | 'paid' | 'unpaid'
  metadata: Record<string, string>
  billingContactEmail?: string
  stripePaymentIntentId?: string | null
  stripeSubscriptionId?: string | null
  currency?: string | null
  amountTotalMinorUnits?: number | null
}

/**
 * A `checkout.session.completed` payload's data object. `customer`, `payment_intent` and
 * `subscription` are strings here rather than expanded objects, which is what a delivery carries;
 * `currency` and `amount_total` are plain nullable fields needing no retrieve; and `line_items` is
 * deliberately absent, because Stripe never sends it.
 */
export function buildGateCheckoutSessionObject({
  stripeCheckoutSessionId,
  stripeCustomerId,
  checkoutMode,
  paymentStatus,
  metadata,
  billingContactEmail,
  stripePaymentIntentId = null,
  stripeSubscriptionId = null,
  currency = 'usd',
  amountTotalMinorUnits = 1900,
}: GateCheckoutSessionOptions): Record<string, unknown> {
  return {
    id: stripeCheckoutSessionId,
    object: 'checkout.session',
    amount_subtotal: amountTotalMinorUnits,
    amount_total: amountTotalMinorUnits,
    currency,
    customer: stripeCustomerId,
    // Both spellings carry the same address. CONTRACT.md states no source for the customer row's
    // billingContactEmail on the webhook path, so a gate that named only one of them would be
    // choosing the implementation's read for it; setting both leaves that choice open.
    customer_email: billingContactEmail ?? null,
    customer_details:
      billingContactEmail === undefined
        ? null
        : { email: billingContactEmail, name: null, phone: null },
    livemode: false,
    metadata,
    mode: checkoutMode,
    payment_intent: stripePaymentIntentId,
    payment_status: paymentStatus,
    status: 'complete',
    subscription: stripeSubscriptionId,
    success_url: 'https://gate.hearthkit.test/checkout/success',
  }
}

/** One subscription item; the period dates live here and not on the subscription, and `price` is always the full object. */
export type GateSubscriptionItemOptions = {
  stripePriceId: string
  priceLookupKey: string | null
  quantity: number
  currentPeriodStartSeconds: number
  currentPeriodEndSeconds: number
  currency?: string
  unitAmountMinorUnits?: number
}

/** Everything a synthesised Subscription carries; `customer` is a string, as a delivery has it. */
export type GateSubscriptionOptions = {
  stripeSubscriptionId: string
  stripeCustomerId: string
  subscriptionStatus: string
  metadata: Record<string, string>
  items: readonly GateSubscriptionItemOptions[]
  cancelAtPeriodEnd?: boolean
  canceledAtSeconds?: number | null
  endedAtSeconds?: number | null
  trialStartSeconds?: number | null
  trialEndSeconds?: number | null
}

/**
 * A `customer.subscription.*` payload's data object. It carries no `current_period_start` or
 * `current_period_end` of its own, because stripe@22.6.1's Subscription has neither: both live on the
 * item, and reaching for the subscription-level field finds nothing.
 */
export function buildGateSubscriptionObject({
  stripeSubscriptionId,
  stripeCustomerId,
  subscriptionStatus,
  metadata,
  items,
  cancelAtPeriodEnd = false,
  canceledAtSeconds = null,
  endedAtSeconds = null,
  trialStartSeconds = null,
  trialEndSeconds = null,
}: GateSubscriptionOptions): Record<string, unknown> {
  return {
    id: stripeSubscriptionId,
    object: 'subscription',
    cancel_at: null,
    cancel_at_period_end: cancelAtPeriodEnd,
    canceled_at: canceledAtSeconds,
    created: items[0]?.currentPeriodStartSeconds ?? gateNowSecondsSinceEpoch(),
    currency: items[0]?.currency ?? 'usd',
    customer: stripeCustomerId,
    ended_at: endedAtSeconds,
    livemode: false,
    metadata,
    status: subscriptionStatus,
    trial_end: trialEndSeconds,
    trial_start: trialStartSeconds,
    items: {
      object: 'list',
      has_more: false,
      url: `/v1/subscription_items?subscription=${stripeSubscriptionId}`,
      data: items.map((item) => ({
        id: uniqueGateStripeId('si'),
        object: 'subscription_item',
        current_period_end: item.currentPeriodEndSeconds,
        current_period_start: item.currentPeriodStartSeconds,
        quantity: item.quantity,
        subscription: stripeSubscriptionId,
        price: {
          id: item.stripePriceId,
          object: 'price',
          active: true,
          billing_scheme: 'per_unit',
          currency: item.currency ?? 'usd',
          livemode: false,
          lookup_key: item.priceLookupKey,
          recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
          type: 'recurring',
          unit_amount: item.unitAmountMinorUnits ?? 1900,
        },
      })),
    },
  }
}

/** The envelope Stripe wraps every payload in; `created` is what the purchase path stores as purchasedAt. */
export type GateStripeEventOptions = {
  stripeEventType: string
  eventDataObject: Record<string, unknown>
  stripeEventId?: string
  createdSecondsSinceEpoch?: number
}

type GateStripeWebhookSigner = {
  generateTestHeaderString: (options: { payload: string; secret: string }) => string
}

/**
 * The SDK's own local signer, taken off the Stripe client the package handed back. Reading it here
 * rather than importing `stripe` in a gate keeps these fixtures free of a direct SDK dependency and
 * guarantees the signature is computed by the same version that will verify it.
 */
function readGateStripeWebhookSigner(paymentsClient: PaymentsClient): GateStripeWebhookSigner {
  const webhooks = (
    paymentsClient as unknown as {
      stripeClient?: { webhooks?: Partial<GateStripeWebhookSigner> }
    }
  ).stripeClient?.webhooks
  if (typeof webhooks?.generateTestHeaderString !== 'function') {
    throw new Error(
      'gate expected paymentsClient.stripeClient to be a Stripe instance carrying webhooks.generateTestHeaderString, which is what signs every webhook gate offline',
    )
  }
  return webhooks as GateStripeWebhookSigner
}

/**
 * The exact bytes a delivery would carry. Indented on purpose: it makes the re-serialisation gate's
 * byte change certain, and it proves the handler treats the body as opaque bytes rather than
 * re-encoding it, which is the mistake that surfaces as a signature mismatch.
 */
export function buildGateStripeEventBody({
  stripeEventType,
  eventDataObject,
  stripeEventId = uniqueGateStripeId('evt'),
  createdSecondsSinceEpoch = gateNowSecondsSinceEpoch(),
}: GateStripeEventOptions): {
  stripeEventId: string
  createdSecondsSinceEpoch: number
  rawRequestBody: string
} {
  const rawRequestBody = JSON.stringify(
    {
      id: stripeEventId,
      object: 'event',
      api_version: '2026-08-26.dahlia',
      created: createdSecondsSinceEpoch,
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type: stripeEventType,
      data: { object: eventDataObject },
    },
    null,
    2,
  )
  return { stripeEventId, createdSecondsSinceEpoch, rawRequestBody }
}

/** The signature header for one body, computed locally, so the gates need neither a network nor the Stripe CLI. */
export function signGateStripeWebhookBody(
  paymentsClient: PaymentsClient,
  rawRequestBody: string,
  signingSecret: string = gateStripeWebhookSecret,
): Headers {
  const header = readGateStripeWebhookSigner(paymentsClient).generateTestHeaderString({
    payload: rawRequestBody,
    secret: signingSecret,
  })
  return new Headers({ [stripeSignatureHeaderName]: header })
}

/** One synthesised event, signed and ready to hand to handleStripeWebhook. */
export function buildGateStripeWebhookDelivery(
  paymentsClient: PaymentsClient,
  eventOptions: GateStripeEventOptions,
  signingSecret: string = gateStripeWebhookSecret,
): GateStripeWebhookDelivery {
  const { stripeEventId, createdSecondsSinceEpoch, rawRequestBody } =
    buildGateStripeEventBody(eventOptions)
  return {
    stripeEventId,
    createdSecondsSinceEpoch,
    rawRequestBody,
    requestHeaders: signGateStripeWebhookBody(paymentsClient, rawRequestBody, signingSecret),
  }
}
