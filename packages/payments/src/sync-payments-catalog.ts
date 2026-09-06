import {
  paymentsClientSchema,
  paymentsPriceNameSchema,
  stripePriceIdSchema,
  stripeProductIdSchema,
  type PaymentsSyncedPrice,
  type SyncPaymentsCatalogOptions,
  type SyncPaymentsCatalogResult,
} from './payments-contract.ts'
import { paymentsInputInvalidFailure } from './payments-failure-results.ts'
import { ensureStripeCatalogProduct } from './stripe-catalog-product-sync.ts'
import { syncStripeCatalogPrice } from './stripe-catalog-price-sync.ts'
import { thrownPaymentsErrorToFailure } from './thrown-payments-error-failure.ts'

/**
 * Pushes the catalog the client holds to Stripe and reports what it did to each price. It writes
 * nothing locally: sync changes a Stripe account and nothing else, so it needs no database at all.
 *
 * Idempotent, because both halves are keyed on names the app chose: the product name is the Stripe
 * product id and the price name is the Stripe price lookup key. A second run over an unchanged
 * catalog therefore reports every price unchanged and creates nothing.
 *
 * stripeLivemode is read off the first object Stripe answered with, whose own generated type says it
 * is true in live mode and false in test mode. That is the guard a caller checks before creating
 * anything else, and it is a measurement rather than a match on an API key prefix.
 */
export async function syncPaymentsCatalog(
  options: SyncPaymentsCatalogOptions,
): Promise<SyncPaymentsCatalogResult> {
  if (!paymentsClientSchema.safeParse(options.paymentsClient).success) {
    return paymentsInputInvalidFailure('drizzle-client')
  }

  const { stripeClient, paymentsCatalog } = options.paymentsClient
  const syncedPrices: PaymentsSyncedPrice[] = []
  let stripeLivemode: boolean | undefined

  try {
    for (const catalogProduct of paymentsCatalog.products) {
      const stripeProduct = await ensureStripeCatalogProduct(stripeClient, catalogProduct)
      stripeLivemode ??= stripeProduct.livemode

      for (const catalogPrice of catalogProduct.prices) {
        const priceSync = await syncStripeCatalogPrice(stripeClient, stripeProduct.id, catalogPrice)
        stripeLivemode ??= priceSync.stripePrice.livemode
        syncedPrices.push({
          priceName: paymentsPriceNameSchema.parse(String(catalogPrice.priceName)),
          stripeProductId: stripeProductIdSchema.parse(stripeProduct.id),
          stripePriceId: stripePriceIdSchema.parse(priceSync.stripePrice.id),
          syncAction: priceSync.syncAction,
        })
      }
    }
  } catch (thrownValue) {
    return thrownPaymentsErrorToFailure(thrownValue, options.paymentsClient)
  }

  return {
    kind: 'payments-catalog-synced',
    syncedPrices,
    // A validated catalog always has at least one product with at least one price, so an object came
    // back from Stripe and this is never the fallback in practice.
    stripeLivemode: stripeLivemode ?? false,
  }
}
