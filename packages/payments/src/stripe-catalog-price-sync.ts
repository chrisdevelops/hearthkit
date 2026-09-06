import type Stripe from 'stripe'
import {
  stripeOneTimePriceType,
  stripeRecurringPriceType,
  type PaymentsCatalogPrice,
  type PaymentsPriceSyncAction,
} from './payments-contract.ts'
import { readStripeReferenceId } from './stripe-event-payload-fields.ts'
import { findActiveStripePriceByLookupKey } from './stripe-price-lookup-key.ts'

/**
 * Pushing one catalog price to Stripe, keyed on the price name, which is also the Stripe lookup key.
 *
 * Stripe prices are immutable in amount and currency, so a catalog price whose terms changed cannot be
 * an update: a new price is created with transfer_lookup_key, which atomically moves the key off the
 * old one, and the superseded price is archived. Existing subscriptions stay on the old price. That is
 * Stripe's behaviour and this package does not migrate them.
 */

/** Interval count Stripe applies when a subscription price does not name one; the catalog default matches it. */
const defaultRecurringIntervalCount = 1

// Note the underscore in Stripe's one_time, and that Stripe's word for the same idea changes between
// the price object and the checkout session. Neither spelling is this package's priceKind.
function stripeRecurringParams(
  catalogPrice: PaymentsCatalogPrice,
): Pick<Stripe.PriceCreateParams, 'recurring'> {
  if (catalogPrice.priceKind !== 'subscription') {
    return {}
  }
  return {
    recurring: {
      interval: catalogPrice.recurringInterval,
      interval_count: catalogPrice.recurringIntervalCount ?? defaultRecurringIntervalCount,
    },
  }
}

function stripePriceMatchesCatalogPrice(
  stripePrice: Stripe.Price,
  stripeProductId: string,
  catalogPrice: PaymentsCatalogPrice,
): boolean {
  if (
    readStripeReferenceId(stripePrice.product) !== stripeProductId ||
    stripePrice.currency !== String(catalogPrice.currency) ||
    stripePrice.unit_amount !== catalogPrice.unitAmountMinorUnits
  ) {
    return false
  }
  if (catalogPrice.priceKind !== 'subscription') {
    return stripePrice.type === stripeOneTimePriceType && stripePrice.recurring === null
  }
  return (
    stripePrice.type === stripeRecurringPriceType &&
    stripePrice.recurring?.interval === catalogPrice.recurringInterval &&
    stripePrice.recurring.interval_count ===
      (catalogPrice.recurringIntervalCount ?? defaultRecurringIntervalCount)
  )
}

/** What sync did to one price, and the Stripe price it now maps to; the id changes whenever the action is replaced. */
export type StripeCatalogPriceSyncOutcome = {
  stripePrice: Stripe.Price
  syncAction: PaymentsPriceSyncAction
}

/** Creates, reuses or replaces the Stripe price carrying this catalog price's name as its lookup key. */
export async function syncStripeCatalogPrice(
  stripeClient: Stripe,
  stripeProductId: string,
  catalogPrice: PaymentsCatalogPrice,
): Promise<StripeCatalogPriceSyncOutcome> {
  const priceLookupKey = String(catalogPrice.priceName)
  const existingPrice = await findActiveStripePriceByLookupKey(stripeClient, priceLookupKey)

  if (existingPrice !== undefined) {
    if (stripePriceMatchesCatalogPrice(existingPrice, stripeProductId, catalogPrice)) {
      return { stripePrice: existingPrice, syncAction: 'unchanged' }
    }
    const replacementPrice = await stripeClient.prices.create({
      product: stripeProductId,
      currency: String(catalogPrice.currency),
      unit_amount: catalogPrice.unitAmountMinorUnits,
      lookup_key: priceLookupKey,
      transfer_lookup_key: true,
      ...stripeRecurringParams(catalogPrice),
    })
    await stripeClient.prices.update(existingPrice.id, { active: false })
    return { stripePrice: replacementPrice, syncAction: 'replaced' }
  }

  const createdPrice = await stripeClient.prices.create({
    product: stripeProductId,
    currency: String(catalogPrice.currency),
    unit_amount: catalogPrice.unitAmountMinorUnits,
    lookup_key: priceLookupKey,
    ...stripeRecurringParams(catalogPrice),
  })
  return { stripePrice: createdPrice, syncAction: 'created' }
}
