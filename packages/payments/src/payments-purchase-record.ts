import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { paymentsPurchaseTable } from './hearthkit-payments-drizzle-schema.ts'
import { generatePaymentsRowId } from './payments-row-identifier.ts'

/**
 * The one write of payments_purchase. It upserts on stripeCheckoutSessionId, which is what makes a
 * replayed delivery write the same values to the same row rather than a second one: idempotency here
 * is structural rather than a bookkeeping table of processed event ids.
 */

/** Everything one completed one-time checkout puts in a row; every value comes from the delivery, none from the catalog. */
export type PaymentsPurchaseRowValues = {
  billingReferenceId: string
  stripeCustomerId: string
  stripeCheckoutSessionId: string
  stripePaymentIntentId: string | null
  priceName: string
  stripePriceId: string
  currency: string
  amountTotalMinorUnits: number
  quantity: number
  purchasedAt: Date
  writtenAt: Date
}

/** Records a completed purchase, or rewrites the same row when Stripe delivers the same session again. */
export async function upsertPaymentsPurchaseRow(
  drizzleClient: NodePgDatabase<Record<string, unknown>>,
  values: PaymentsPurchaseRowValues,
): Promise<void> {
  await drizzleClient
    .insert(paymentsPurchaseTable)
    .values({
      id: generatePaymentsRowId('paybuy'),
      billingReferenceId: values.billingReferenceId,
      stripeCustomerId: values.stripeCustomerId,
      stripeCheckoutSessionId: values.stripeCheckoutSessionId,
      stripePaymentIntentId: values.stripePaymentIntentId,
      priceName: values.priceName,
      stripePriceId: values.stripePriceId,
      currency: values.currency,
      amountTotalMinorUnits: values.amountTotalMinorUnits,
      quantity: values.quantity,
      purchasedAt: values.purchasedAt,
      createdAt: values.writtenAt,
      updatedAt: values.writtenAt,
    })
    .onConflictDoUpdate({
      target: paymentsPurchaseTable.stripeCheckoutSessionId,
      set: {
        billingReferenceId: values.billingReferenceId,
        stripeCustomerId: values.stripeCustomerId,
        stripePaymentIntentId: values.stripePaymentIntentId,
        priceName: values.priceName,
        stripePriceId: values.stripePriceId,
        currency: values.currency,
        amountTotalMinorUnits: values.amountTotalMinorUnits,
        quantity: values.quantity,
        purchasedAt: values.purchasedAt,
        updatedAt: values.writtenAt,
      },
    })
}
