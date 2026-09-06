import { desc, eq } from 'drizzle-orm'
import { paymentsSubscriptionTable } from './hearthkit-payments-drizzle-schema.ts'
import {
  billingReferenceIdSchema,
  paymentsClientSchema,
  paymentsSubscriptionSchema,
  type ReadPaymentsSubscriptionOptions,
  type ReadPaymentsSubscriptionResult,
} from './payments-contract.ts'
import {
  paymentsInputInvalidFailure,
  paymentsRequestFailedFailure,
} from './payments-failure-results.ts'
import { thrownPaymentsErrorToFailure } from './thrown-payments-error-failure.ts'

/**
 * The most recent subscription row for a reference, whatever its status. Nobody having a subscription
 * is a normal answer and comes back as payments-subscription-absent rather than a failure, because
 * modelling it as an error would send every entitlement check's happy path through a catch.
 *
 * "Most recent" is the greatest createdAt, which this package writes from its own clock, with id
 * descending as the tiebreak so the answer is deterministic. The row is returned whatever its status:
 * the caller reads status and decides, comparing against paymentsActiveSubscriptionStatuses.
 */
export async function readPaymentsSubscription(
  options: ReadPaymentsSubscriptionOptions,
): Promise<ReadPaymentsSubscriptionResult> {
  if (!paymentsClientSchema.safeParse(options.paymentsClient).success) {
    return paymentsInputInvalidFailure('drizzle-client')
  }
  const parsedReference = billingReferenceIdSchema.safeParse(options.billingReferenceId)
  if (!parsedReference.success) {
    return paymentsInputInvalidFailure('billing-reference-id')
  }

  let subscriptionRows: (typeof paymentsSubscriptionTable.$inferSelect)[]
  try {
    subscriptionRows = await options.paymentsClient.drizzleClient
      .select()
      .from(paymentsSubscriptionTable)
      .where(eq(paymentsSubscriptionTable.billingReferenceId, String(parsedReference.data)))
      .orderBy(desc(paymentsSubscriptionTable.createdAt), desc(paymentsSubscriptionTable.id))
      .limit(1)
  } catch (thrownValue) {
    return thrownPaymentsErrorToFailure(thrownValue, options.paymentsClient)
  }

  const subscriptionRow = subscriptionRows[0]
  if (subscriptionRow === undefined) {
    return { kind: 'payments-subscription-absent' }
  }

  const parsedSubscription = paymentsSubscriptionSchema.safeParse(subscriptionRow)
  if (!parsedSubscription.success) {
    return paymentsRequestFailedFailure({
      paymentsFailureDetail:
        'a payments_subscription row does not match the shape this package writes, so the table was written by something else',
    })
  }
  return { kind: 'payments-subscription-found', paymentsSubscription: parsedSubscription.data }
}
