import type Stripe from 'stripe'
import type { PaymentsCatalogProduct } from './payments-contract.ts'
import { readThrownPaymentsErrorDetails } from './thrown-payments-error-details.ts'

/**
 * Pushing one catalog product to Stripe. The catalog product name IS the Stripe product id, because
 * products.create accepts a caller-supplied id, and that is what makes sync idempotent without a
 * search call: a second run retrieves the same id rather than hunting for a product by name.
 *
 * The retrieve-then-create shape is used rather than create-then-catch on purpose. Catching would
 * mean depending on `resource_already_exists`, an API-level string this repo cannot measure offline
 * whose near miss `resource_missing` sits in the same generated union. The HTTP status is measurable:
 * stripe@22.6.1's generateV1Error maps 400 OR 404 to StripeInvalidRequestError, so a missing resource
 * is not a distinct error class and only `statusCode` says which happened.
 */

/** HTTP status Stripe answers a retrieve of an id no object carries; read off generateV1Error's own mapping. */
const stripeNotFoundHttpStatus = 404

function readThrownStripeStatus(thrownValue: unknown): number | undefined {
  return readThrownPaymentsErrorDetails(thrownValue).stripeErrorStatus
}

// Only the two fields a buyer sees are kept in step. The product's `active` flag is deliberately left
// alone: an operator who archived a product in the Stripe dashboard meant it, and a sync that quietly
// republished it would undo a decision nothing here can see the reason for.
function stripeProductNeedsUpdate(
  stripeProduct: Stripe.Product,
  catalogProduct: PaymentsCatalogProduct,
): boolean {
  if (stripeProduct.name !== catalogProduct.displayName) {
    return true
  }
  return (
    catalogProduct.description !== undefined &&
    stripeProduct.description !== catalogProduct.description
  )
}

/** The Stripe product for one catalog entry, created on a first run and reused on every run after it. */
export async function ensureStripeCatalogProduct(
  stripeClient: Stripe,
  catalogProduct: PaymentsCatalogProduct,
): Promise<Stripe.Product> {
  const stripeProductId = String(catalogProduct.productName)

  let existingProduct: Stripe.Product | undefined
  try {
    existingProduct = await stripeClient.products.retrieve(stripeProductId)
  } catch (thrownValue) {
    if (readThrownStripeStatus(thrownValue) !== stripeNotFoundHttpStatus) {
      throw thrownValue
    }
  }

  if (existingProduct === undefined) {
    return stripeClient.products.create({
      id: stripeProductId,
      name: catalogProduct.displayName,
      ...(catalogProduct.description === undefined
        ? {}
        : { description: catalogProduct.description }),
    })
  }

  if (!stripeProductNeedsUpdate(existingProduct, catalogProduct)) {
    return existingProduct
  }
  return stripeClient.products.update(stripeProductId, {
    name: catalogProduct.displayName,
    ...(catalogProduct.description === undefined
      ? {}
      : { description: catalogProduct.description }),
  })
}
