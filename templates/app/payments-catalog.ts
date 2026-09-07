import { paymentsCatalogSchema } from '@hearthkit/payments'
import type { PaymentsCatalog } from '@hearthkit/payments'

/**
 * What this app sells, declared in code rather than clicked into the Stripe dashboard.
 *
 * `syncPaymentsCatalog` pushes it to Stripe and is idempotent, so running it again over an unchanged
 * catalog reports every price unchanged. Two rules matter when you edit this:
 *
 * - `productName` and `priceName` are stable identities. `productName` becomes the Stripe product id
 *   and `priceName` its price `lookup_key`, so renaming one creates a second product or price rather
 *   than editing the first.
 * - Stripe prices are immutable in amount and currency. Changing either of those makes the next sync
 *   create a replacement price and archive the old one, which is why nothing stores a Stripe price id
 *   as an identity.
 *
 * Parsed here rather than merely typed, so a malformed catalog fails at import with a message naming
 * the entry instead of at a buyer's checkout.
 */
export const appPaymentsCatalog: PaymentsCatalog = paymentsCatalogSchema.parse({
  products: [
    {
      productName: 'hearthkit-app',
      displayName: 'Hearthkit app',
      description:
        'The example product this template ships so the billing section has something to sell.',
      prices: [
        {
          priceName: 'hearthkit-app-lifetime',
          currency: 'usd',
          unitAmountMinorUnits: 1900,
          priceKind: 'one-time',
        },
        {
          priceName: 'hearthkit-app-monthly',
          currency: 'usd',
          unitAmountMinorUnits: 900,
          priceKind: 'subscription',
          recurringInterval: 'month',
        },
      ],
    },
  ],
})
