import type Stripe from 'stripe'

/**
 * Resolving a catalog price name against Stripe, through the lookup key syncPaymentsCatalog set it
 * to. An unknown lookup key comes back as an EMPTY LIST — a 200 response with no data rather than an
 * error — which is why the absent-from-stripe half of payments-price-not-found never depends on an
 * API-level error code. `resource_missing` sits one union entry away from `resource_already_exists`,
 * and neither is a string this repo can measure offline.
 */

// PriceListParams accepts up to ten lookup_keys, and a lookup key is unique among ACTIVE prices in an
// account, so one key with active: true can match at most one price.
const activePriceListLimit = 1

/** The active Stripe price carrying this lookup key, or nothing when sync has never run for it. */
export async function findActiveStripePriceByLookupKey(
  stripeClient: Stripe,
  priceLookupKey: string,
): Promise<Stripe.Price | undefined> {
  const listedPrices = await stripeClient.prices.list({
    lookup_keys: [priceLookupKey],
    active: true,
    limit: activePriceListLimit,
  })
  return listedPrices.data[0]
}
