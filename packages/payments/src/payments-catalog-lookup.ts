import type { PaymentsCatalog, PaymentsCatalogPrice } from './payments-contract.ts'

/**
 * Resolving a price name against the catalog the client was built with. It is a local map read that
 * touches no network at all, which is what makes the absent-from-catalog half of
 * payments-price-not-found deterministic offline: nothing here asks Stripe to tell us a price is
 * missing, because that answer would be an API error code this repo cannot measure without a key.
 */

/** The catalog price a name refers to, or nothing when the catalog has never carried that name. */
export function findPaymentsCatalogPrice(
  paymentsCatalog: PaymentsCatalog,
  priceName: string,
): PaymentsCatalogPrice | undefined {
  for (const catalogProduct of paymentsCatalog.products) {
    for (const catalogPrice of catalogProduct.prices) {
      if (String(catalogPrice.priceName) === priceName) {
        return catalogPrice
      }
    }
  }
  return undefined
}
