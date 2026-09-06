import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { paymentsSubscriptionTable } from './hearthkit-payments-drizzle-schema.ts'
import { generatePaymentsRowId } from './payments-row-identifier.ts'

/**
 * The one write of payments_subscription. It upserts on stripeSubscriptionId, so created, updated and
 * deleted deliveries for one subscription all land on the same row and a replay moves no count.
 *
 * createdAt is this package's own clock rather than the event's, because "most recent subscription"
 * has to order two rows written seconds apart and Stripe's `created` is only second-resolution.
 */

/** Everything one subscription delivery puts in a row; the period dates come from the item, not the subscription. */
export type PaymentsSubscriptionRowValues = {
  billingReferenceId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  priceName: string
  stripePriceId: string
  status: string
  quantity: number
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
  canceledAt: Date | null
  endedAt: Date | null
  trialStart: Date | null
  trialEnd: Date | null
  writtenAt: Date
}

/** Records what Stripe last said about a subscription, or rewrites the same row when it says it again. */
export async function upsertPaymentsSubscriptionRow(
  drizzleClient: NodePgDatabase<Record<string, unknown>>,
  values: PaymentsSubscriptionRowValues,
): Promise<void> {
  await drizzleClient
    .insert(paymentsSubscriptionTable)
    .values({
      id: generatePaymentsRowId('paysub'),
      billingReferenceId: values.billingReferenceId,
      stripeCustomerId: values.stripeCustomerId,
      stripeSubscriptionId: values.stripeSubscriptionId,
      priceName: values.priceName,
      stripePriceId: values.stripePriceId,
      status: values.status,
      quantity: values.quantity,
      currentPeriodStart: values.currentPeriodStart,
      currentPeriodEnd: values.currentPeriodEnd,
      cancelAtPeriodEnd: values.cancelAtPeriodEnd,
      canceledAt: values.canceledAt,
      endedAt: values.endedAt,
      trialStart: values.trialStart,
      trialEnd: values.trialEnd,
      createdAt: values.writtenAt,
      updatedAt: values.writtenAt,
    })
    .onConflictDoUpdate({
      target: paymentsSubscriptionTable.stripeSubscriptionId,
      set: {
        billingReferenceId: values.billingReferenceId,
        stripeCustomerId: values.stripeCustomerId,
        priceName: values.priceName,
        stripePriceId: values.stripePriceId,
        status: values.status,
        quantity: values.quantity,
        currentPeriodStart: values.currentPeriodStart,
        currentPeriodEnd: values.currentPeriodEnd,
        cancelAtPeriodEnd: values.cancelAtPeriodEnd,
        canceledAt: values.canceledAt,
        endedAt: values.endedAt,
        trialStart: values.trialStart,
        trialEnd: values.trialEnd,
        updatedAt: values.writtenAt,
      },
    })
}
