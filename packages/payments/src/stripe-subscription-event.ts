import type Stripe from 'stripe'
import {
  hearthkitBillingReferenceMetadataKey,
  type HandleStripeWebhookResult,
  type PaymentsCatalog,
  type PaymentsClient,
} from './payments-contract.ts'
import { paymentsRequestFailedFailure } from './payments-failure-results.ts'
import { upsertPaymentsSubscriptionRow } from './payments-subscription-record.ts'
import {
  readStripeMetadataValue,
  readStripeReferenceId,
  readStripeSecondsAsDate,
} from './stripe-event-payload-fields.ts'
import {
  paymentsWebhookIgnoredResult,
  paymentsWebhookProcessedResult,
  type StripeWebhookDeliveryIdentity,
} from './stripe-webhook-delivery-results.ts'

/**
 * What this package does with a `customer.subscription.*` delivery: created, updated and deleted all
 * upsert the same row on the Stripe subscription id and all report subscription-upserted.
 *
 * Unlike the checkout path this one must consult the catalog, because priceName is resolved from the
 * price's lookup_key and there is no metadata to fall back on. That resolution is deliberate: a
 * portal upgrade changes a subscription's price without touching metadata stamped at creation, so a
 * stamped price name would go stale and then be reported as fact. The lookup_key cannot go stale.
 *
 * It needs no API call. SubscriptionItem.price is typed Price rather than `string | Price`, so it is
 * always the full object in a delivery and never an id, which is what makes this path offline rather
 * than merely usually offline.
 */

function catalogPriceNames(paymentsCatalog: PaymentsCatalog): Set<string> {
  const priceNames = new Set<string>()
  for (const catalogProduct of paymentsCatalog.products) {
    for (const catalogPrice of catalogProduct.prices) {
      priceNames.add(String(catalogPrice.priceName))
    }
  }
  return priceNames
}

// The first item whose price.lookup_key names a catalog price, not simply items.data[0]: a
// subscription can carry an item this catalog knows nothing about, and reading position zero would
// then store somebody else's price against our reference.
function findCatalogSubscriptionItem(
  subscription: Stripe.Subscription,
  paymentsCatalog: PaymentsCatalog,
): Stripe.SubscriptionItem | undefined {
  const knownPriceNames = catalogPriceNames(paymentsCatalog)
  return subscription.items.data.find((subscriptionItem) => {
    const lookupKey = subscriptionItem.price.lookup_key
    return typeof lookupKey === 'string' && knownPriceNames.has(lookupKey)
  })
}

/** Records what Stripe last said about a subscription; a delivery with no reference or no catalog price is ignored. */
export async function recordStripeSubscriptionDelivery(
  paymentsClient: PaymentsClient,
  subscription: Stripe.Subscription,
  delivery: StripeWebhookDeliveryIdentity,
): Promise<HandleStripeWebhookResult> {
  // A subscription created by hand in the Stripe dashboard carries no hearthkit metadata at all, and
  // inventing a reference for it would attach someone else's money to a hearthkit account.
  const billingReferenceId = readStripeMetadataValue(
    subscription.metadata,
    hearthkitBillingReferenceMetadataKey,
  )
  if (billingReferenceId === undefined) {
    return paymentsWebhookIgnoredResult(delivery, 'billing-reference-missing')
  }

  const catalogItem = findCatalogSubscriptionItem(subscription, paymentsClient.paymentsCatalog)
  if (catalogItem === undefined) {
    return paymentsWebhookIgnoredResult(delivery, 'subscription-price-not-in-catalog')
  }

  const stripeCustomerId = readStripeReferenceId(subscription.customer)
  if (stripeCustomerId === undefined) {
    return paymentsRequestFailedFailure({
      paymentsFailureDetail:
        'a subscription delivery carried no customer, so the row would name nobody Stripe bills',
    })
  }

  await upsertPaymentsSubscriptionRow(paymentsClient.drizzleClient, {
    billingReferenceId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    priceName: String(catalogItem.price.lookup_key),
    stripePriceId: catalogItem.price.id,
    status: subscription.status,
    // SubscriptionItem.quantity is typed optional and Stripe omits it for prices with no explicit
    // quantity, metered ones among them; absence there means one unit of the thing, which is a
    // defined meaning and therefore a default this package is allowed to apply.
    quantity: catalogItem.quantity ?? 1,
    // Both period dates come from the ITEM. stripe@22.6.1's Subscription object has no
    // current_period_start or current_period_end at all, so reaching for one finds nothing.
    currentPeriodStart: readStripeSecondsAsDate(catalogItem.current_period_start),
    currentPeriodEnd: readStripeSecondsAsDate(catalogItem.current_period_end),
    // These five are subscription-level fields that really do exist, unlike the period pair.
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: readStripeSecondsAsDate(subscription.canceled_at),
    endedAt: readStripeSecondsAsDate(subscription.ended_at),
    trialStart: readStripeSecondsAsDate(subscription.trial_start),
    trialEnd: readStripeSecondsAsDate(subscription.trial_end),
    writtenAt: new Date(),
  })
  return paymentsWebhookProcessedResult(delivery, 'subscription-upserted')
}
