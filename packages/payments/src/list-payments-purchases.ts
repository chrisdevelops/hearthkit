import { desc, eq } from 'drizzle-orm'
import { paymentsPurchaseTable } from './hearthkit-payments-drizzle-schema.ts'
import {
  billingReferenceIdSchema,
  paymentsClientSchema,
  paymentsPurchaseSchema,
  type ListPaymentsPurchasesOptions,
  type ListPaymentsPurchasesResult,
  type PaymentsPurchase,
} from './payments-contract.ts'
import {
  paymentsInputInvalidFailure,
  paymentsRequestFailedFailure,
} from './payments-failure-results.ts'
import { thrownPaymentsErrorToFailure } from './thrown-payments-error-failure.ts'

/**
 * Every completed one-time purchase for a reference, newest first by purchasedAt with id descending
 * as the tiebreak. An empty array is a success rather than an -absent variant: "what has this
 * customer bought" has a correct empty answer, whereas "which subscription is current" has no
 * meaningful empty row.
 */
export async function listPaymentsPurchases(
  options: ListPaymentsPurchasesOptions,
): Promise<ListPaymentsPurchasesResult> {
  if (!paymentsClientSchema.safeParse(options.paymentsClient).success) {
    return paymentsInputInvalidFailure('drizzle-client')
  }
  const parsedReference = billingReferenceIdSchema.safeParse(options.billingReferenceId)
  if (!parsedReference.success) {
    return paymentsInputInvalidFailure('billing-reference-id')
  }

  let purchaseRows: (typeof paymentsPurchaseTable.$inferSelect)[]
  try {
    purchaseRows = await options.paymentsClient.drizzleClient
      .select()
      .from(paymentsPurchaseTable)
      .where(eq(paymentsPurchaseTable.billingReferenceId, String(parsedReference.data)))
      .orderBy(desc(paymentsPurchaseTable.purchasedAt), desc(paymentsPurchaseTable.id))
  } catch (thrownValue) {
    return thrownPaymentsErrorToFailure(thrownValue, options.paymentsClient)
  }

  const paymentsPurchases: PaymentsPurchase[] = []
  for (const purchaseRow of purchaseRows) {
    const parsedPurchase = paymentsPurchaseSchema.safeParse(purchaseRow)
    if (!parsedPurchase.success) {
      return paymentsRequestFailedFailure({
        paymentsFailureDetail:
          'a payments_purchase row does not match the shape this package writes, so the table was written by something else',
      })
    }
    paymentsPurchases.push(parsedPurchase.data)
  }
  return { kind: 'payments-purchases-listed', paymentsPurchases }
}
