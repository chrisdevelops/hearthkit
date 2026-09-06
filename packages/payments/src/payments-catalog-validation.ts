import { z } from 'zod'
import {
  maximumPaymentsPriceNameLength,
  maximumPaymentsProductNameLength,
  paymentsCatalogPriceSchema,
  paymentsCatalogProductSchema,
  paymentsCatalogSchema,
  type PaymentsCatalog,
  type PaymentsCatalogIssue,
} from './payments-contract.ts'

/**
 * Validates the catalog an app wrote in payments-catalog.ts and names every problem in one pass, the
 * way config reports every bad variable at once, because fixing a catalog one error per boot is
 * miserable.
 *
 * Each reason states the rule that was broken and never the value that broke it, matching
 * payments-input-invalid's discipline. A catalog is app source rather than user input, but a boot log
 * is just as public and the rule is cheaper to keep than to reason about case by case.
 */

// The product schema with its "at least one price" rule lifted, so a product with an empty price list
// is reported once as product-has-no-prices rather than a second time as a schema rejection, while
// every other problem in that same entry is still found in this pass.
const paymentsCatalogProductEntrySchema = paymentsCatalogProductSchema.extend({
  prices: z.array(paymentsCatalogPriceSchema),
})

// A hand-written rule per field, for the same reason auth writes authInvalidFieldReasons out by hand:
// a library's own message is free to quote the input it rejected, and one that did would put a
// catalog value into a returned failure.
const paymentsCatalogFieldRules: Record<string, string> = {
  products: 'must be a list of catalog products',
  productName: `must be lowercase kebab-case of at most ${String(maximumPaymentsProductNameLength)} characters, because it is also the Stripe product id`,
  displayName: 'must be from 1 to 250 characters, because a buyer reads it on the checkout page',
  description: 'must be from 1 to 1000 characters when it is present at all',
  prices: 'must be a list of catalog prices',
  priceName: `must be lowercase kebab-case of at most ${String(maximumPaymentsPriceNameLength)} characters, because it is also the Stripe price lookup key`,
  currency: 'must be exactly three lowercase letters, which is how Stripe spells ISO 4217',
  unitAmountMinorUnits: 'must be a positive integer of minor currency units',
  priceKind: 'must be subscription or one-time',
  recurringInterval: 'must be day, week, month or year, and only on a subscription price',
  recurringIntervalCount: 'must be a positive integer when it is present at all',
}

const unknownCatalogFieldRule = 'must match the shape paymentsCatalogSchema describes'

function readCatalogEntryName(candidate: unknown, propertyName: string): string | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined
  }
  const value = (candidate as Record<string, unknown>)[propertyName]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readCatalogFieldRule(issuePath: readonly PropertyKey[]): string {
  for (let index = issuePath.length - 1; index >= 0; index -= 1) {
    const segment = issuePath[index]
    if (typeof segment === 'string' && segment in paymentsCatalogFieldRules) {
      return paymentsCatalogFieldRules[segment] ?? unknownCatalogFieldRule
    }
  }
  return unknownCatalogFieldRule
}

function readCatalogProductEntries(candidate: unknown): unknown[] | undefined {
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined
  }
  const { products } = candidate as { products?: unknown }
  return Array.isArray(products) ? products : undefined
}

function collectDuplicateNameIssues(
  names: readonly string[],
  catalogIssueKind: 'duplicate-product-name' | 'duplicate-price-name',
  catalogIssueReason: string,
): PaymentsCatalogIssue[] {
  const seenCounts = new Map<string, number>()
  for (const entryName of names) {
    seenCounts.set(entryName, (seenCounts.get(entryName) ?? 0) + 1)
  }
  return [...seenCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([entryName]) => ({ catalogIssueKind, catalogEntryName: entryName, catalogIssueReason }))
}

/** A catalog this package will hold, or every reason it will not; never a first failure and never the rejected value. */
export type PaymentsCatalogValidation =
  | { kind: 'catalog-valid'; paymentsCatalog: PaymentsCatalog }
  | { kind: 'catalog-invalid'; catalogIssues: PaymentsCatalogIssue[] }

/** Checks an app-supplied catalog once at boot, so a malformed one fails there rather than at a buyer's checkout. */
export function validatePaymentsCatalogEntries(candidate: unknown): PaymentsCatalogValidation {
  const productEntries = readCatalogProductEntries(candidate)
  if (productEntries === undefined || productEntries.length === 0) {
    return {
      kind: 'catalog-invalid',
      catalogIssues: [
        {
          catalogIssueKind: 'catalog-has-no-products',
          catalogEntryName: 'products',
          catalogIssueReason:
            'must carry at least one product, because an empty catalog sells nothing',
        },
      ],
    }
  }

  const catalogIssues: PaymentsCatalogIssue[] = []
  const productNames: string[] = []
  const priceNames: string[] = []

  for (const [entryIndex, productEntry] of productEntries.entries()) {
    const productName = readCatalogEntryName(productEntry, 'productName')
    const catalogEntryName = productName ?? `products[${String(entryIndex)}]`
    if (productName !== undefined) {
      productNames.push(productName)
    }

    const priceEntries = (productEntry as { prices?: unknown } | null)?.prices
    if (Array.isArray(priceEntries)) {
      if (priceEntries.length === 0) {
        catalogIssues.push({
          catalogIssueKind: 'product-has-no-prices',
          catalogEntryName,
          catalogIssueReason:
            'must carry at least one price, because a product with none is nothing anyone can buy',
        })
      }
      for (const priceEntry of priceEntries) {
        const priceName = readCatalogEntryName(priceEntry, 'priceName')
        if (priceName !== undefined) {
          priceNames.push(priceName)
        }
      }
    }

    const parsedEntry = paymentsCatalogProductEntrySchema.safeParse(productEntry)
    if (!parsedEntry.success) {
      for (const issue of parsedEntry.error.issues) {
        catalogIssues.push({
          catalogIssueKind: 'entry-invalid',
          catalogEntryName: `${catalogEntryName}.${issue.path.map(String).join('.') || 'products'}`,
          catalogIssueReason: readCatalogFieldRule(issue.path),
        })
      }
    }
  }

  catalogIssues.push(
    ...collectDuplicateNameIssues(
      productNames,
      'duplicate-product-name',
      'must name each product once, because the product name is also the Stripe product id',
    ),
  )
  // Across the whole catalog and not merely within one product: the price name is also the Stripe
  // price lookup key, which is unique among active prices in an account, so a per-product check
  // would pass a catalog Stripe will refuse.
  catalogIssues.push(
    ...collectDuplicateNameIssues(
      priceNames,
      'duplicate-price-name',
      'must name each price once across the whole catalog, because the price name is also the Stripe price lookup key',
    ),
  )

  if (catalogIssues.length > 0) {
    return { kind: 'catalog-invalid', catalogIssues }
  }

  const parsedCatalog = paymentsCatalogSchema.safeParse(candidate)
  if (!parsedCatalog.success) {
    return {
      kind: 'catalog-invalid',
      catalogIssues: parsedCatalog.error.issues.map((issue) => ({
        catalogIssueKind: 'entry-invalid' as const,
        catalogEntryName: issue.path.map(String).join('.') || 'products',
        catalogIssueReason: readCatalogFieldRule(issue.path),
      })),
    }
  }
  return { kind: 'catalog-valid', paymentsCatalog: parsedCatalog.data }
}
