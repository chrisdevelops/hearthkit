import type Stripe from 'stripe'
import {
  billingContactEmailSchema,
  billingScopeSchema,
  hearthkitBillingReferenceMetadataKey,
  hearthkitBillingScopeMetadataKey,
  hearthkitPriceNameMetadataKey,
  hearthkitQuantityMetadataKey,
  hearthkitStripePriceIdMetadataKey,
  paymentsCurrencyCodeSchema,
  paymentsPriceNameSchema,
  paymentsQuantitySchema,
  stripeOneTimeCheckoutMode,
  stripePriceIdSchema,
  stripeSubscriptionCheckoutMode,
  type HandleStripeWebhookResult,
  type PaymentsClient,
} from './payments-contract.ts'
import {
  readPaymentsCustomerRow,
  upsertPaymentsCustomerFromWebhook,
} from './payments-customer-record.ts'
import { paymentsRequestFailedFailure } from './payments-failure-results.ts'
import { upsertPaymentsPurchaseRow } from './payments-purchase-record.ts'
import { readStripeMetadataValue, readStripeReferenceId } from './stripe-event-payload-fields.ts'
import {
  paymentsWebhookIgnoredResult,
  paymentsWebhookProcessedResult,
  type StripeWebhookDeliveryIdentity,
} from './stripe-webhook-delivery-results.ts'

/**
 * What this package does with a `checkout.session.completed` delivery. A subscription-mode session
 * links the customer; a paid payment-mode session records a purchase; anything else is ignored, which
 * is a result and not a failure.
 *
 * The purchase path reads what was sold from the session's own metadata and never from line_items,
 * because a delivery does not carry them: Checkout.Session.line_items is declared optional and the SDK
 * calls it "includable" on a retrieve, and nothing expands it on a delivery. Doing it any other way
 * would need a retrieve call, which would put every webhook gate behind a live Stripe key.
 *
 * It also does not consult the catalog at all, deliberately: a purchase is a historical fact, so
 * deleting a price from payments-catalog.ts must not make a completed order unrecordable.
 */

// Stripe metadata values are strings, so the quantity written by createCheckoutSession is read back
// from a decimal string. A value that is not a positive integer counts as MISSING rather than
// defaulting to one, because silently billing one unit for an order of five is worse than declining
// to record it. That is not in tension with the subscription item default: absence has a defined
// meaning on Stripe's own object and none in a string this package wrote and read back.
const decimalDigitsPattern = /^\d+$/

function readCheckoutQuantityMetadata(metadata: Stripe.Metadata | null): number | undefined {
  const rawQuantity = readStripeMetadataValue(metadata, hearthkitQuantityMetadataKey)
  if (rawQuantity === undefined || !decimalDigitsPattern.test(rawQuantity)) {
    return undefined
  }
  const parsedQuantity = paymentsQuantitySchema.safeParse(Number(rawQuantity))
  return parsedQuantity.success ? parsedQuantity.data : undefined
}

// Both fields are read, in that order, and neither alone is enough. customer_email is a PREFILL field
// and is null on every session created with a customer id, which is every session this package
// creates after the first; customer_details.email is the one documented as populated after
// completion, but its own second sentence widens it to a promotional-consent address typed on the
// Checkout form, which is why it may only ever seed a row that did not exist.
function readCheckoutContactEmail(session: Stripe.Checkout.Session): string | undefined {
  const parsed = billingContactEmailSchema.safeParse(
    session.customer_details?.email ?? session.customer_email ?? undefined,
  )
  return parsed.success ? String(parsed.data) : undefined
}

async function linkCheckoutCustomer(
  paymentsClient: PaymentsClient,
  session: Stripe.Checkout.Session,
  delivery: StripeWebhookDeliveryIdentity,
): Promise<HandleStripeWebhookResult> {
  const billingReferenceId = readStripeMetadataValue(
    session.metadata,
    hearthkitBillingReferenceMetadataKey,
  )
  if (billingReferenceId === undefined) {
    return paymentsWebhookIgnoredResult(delivery, 'billing-reference-missing')
  }

  const stripeCustomerId = readStripeReferenceId(session.customer)
  if (stripeCustomerId === undefined) {
    return paymentsRequestFailedFailure({
      paymentsFailureDetail:
        'a completed subscription checkout carried no customer, so there is nothing to link the billing reference to',
    })
  }

  const existingCustomerRow = await readPaymentsCustomerRow(
    paymentsClient.drizzleClient,
    billingReferenceId,
  )
  // Only the insert branch needs an address, because billingContactEmail is text NOT NULL and nothing
  // else can supply one for a session this package did not create. On an existing row the address
  // stays exactly as createCheckoutSession wrote it, and this value never reaches the update clause.
  const billingContactEmail =
    readCheckoutContactEmail(session) ?? existingCustomerRow?.billingContactEmail
  if (billingContactEmail === undefined) {
    return paymentsRequestFailedFailure({
      paymentsFailureDetail:
        'a completed subscription checkout for an unknown billing reference carried no usable email on customer_details or customer_email, so no customer row could be inserted',
    })
  }

  const billingScope =
    billingScopeSchema.safeParse(
      readStripeMetadataValue(session.metadata, hearthkitBillingScopeMetadataKey),
    ).data ?? paymentsClient.billingScope

  await upsertPaymentsCustomerFromWebhook(paymentsClient.drizzleClient, {
    billingReferenceId,
    billingScope,
    stripeCustomerId,
    billingContactEmail,
    writtenAt: delivery.eventCreatedAt,
  })
  return paymentsWebhookProcessedResult(delivery, 'customer-linked')
}

async function recordCheckoutPurchase(
  paymentsClient: PaymentsClient,
  session: Stripe.Checkout.Session,
  delivery: StripeWebhookDeliveryIdentity,
): Promise<HandleStripeWebhookResult> {
  // A purchase is recorded for `paid` and for `no_payment_required`, which is what a fully discounted
  // order reports; `unpaid` is the third member of that union and the one that records nothing.
  if (session.payment_status === 'unpaid') {
    return paymentsWebhookIgnoredResult(delivery, 'checkout-session-unpaid')
  }

  const billingReferenceId = readStripeMetadataValue(
    session.metadata,
    hearthkitBillingReferenceMetadataKey,
  )
  if (billingReferenceId === undefined) {
    return paymentsWebhookIgnoredResult(delivery, 'billing-reference-missing')
  }

  const priceName = paymentsPriceNameSchema.safeParse(
    readStripeMetadataValue(session.metadata, hearthkitPriceNameMetadataKey),
  )
  const stripePriceId = stripePriceIdSchema.safeParse(
    readStripeMetadataValue(session.metadata, hearthkitStripePriceIdMetadataKey),
  )
  const quantity = readCheckoutQuantityMetadata(session.metadata)
  if (!priceName.success || !stripePriceId.success || quantity === undefined) {
    return paymentsWebhookIgnoredResult(delivery, 'checkout-price-metadata-missing')
  }

  const stripeCustomerId = readStripeReferenceId(session.customer)
  // currency and amount_total are plain nullable fields rather than expandable ones, so a paid
  // payment-mode session has both and a null here is not a contract state.
  const currency = paymentsCurrencyCodeSchema.safeParse(session.currency)
  const amountTotalMinorUnits = session.amount_total
  if (
    stripeCustomerId === undefined ||
    !currency.success ||
    typeof amountTotalMinorUnits !== 'number' ||
    !Number.isInteger(amountTotalMinorUnits) ||
    amountTotalMinorUnits < 0
  ) {
    return paymentsRequestFailedFailure({
      paymentsFailureDetail:
        'a completed one-time checkout carried no customer, no currency or no amount total, none of which is a state this package models',
    })
  }

  await upsertPaymentsPurchaseRow(paymentsClient.drizzleClient, {
    billingReferenceId,
    stripeCustomerId,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: readStripeReferenceId(session.payment_intent) ?? null,
    priceName: String(priceName.data),
    stripePriceId: String(stripePriceId.data),
    currency: String(currency.data),
    amountTotalMinorUnits,
    quantity,
    // The event's own `created`, seconds since the epoch, not the moment this row was written.
    purchasedAt: delivery.eventCreatedAt,
    writtenAt: new Date(),
  })
  return paymentsWebhookProcessedResult(delivery, 'purchase-recorded')
}

/** Routes one completed Checkout Session by its mode; a setup-mode session came from somewhere else and is ignored. */
export async function recordStripeCheckoutSessionDelivery(
  paymentsClient: PaymentsClient,
  session: Stripe.Checkout.Session,
  delivery: StripeWebhookDeliveryIdentity,
): Promise<HandleStripeWebhookResult> {
  if (session.mode === stripeSubscriptionCheckoutMode) {
    return linkCheckoutCustomer(paymentsClient, session, delivery)
  }
  if (session.mode === stripeOneTimeCheckoutMode) {
    return recordCheckoutPurchase(paymentsClient, session, delivery)
  }
  return paymentsWebhookIgnoredResult(delivery, 'checkout-mode-not-handled')
}
