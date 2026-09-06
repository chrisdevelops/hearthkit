import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { paymentsCustomerTable } from './hearthkit-payments-drizzle-schema.ts'
import { generatePaymentsRowId } from './payments-row-identifier.ts'
import type { BillingScope } from './payments-contract.ts'

/**
 * Every read and write of payments_customer, in one place because the column billingContactEmail has
 * two writers with different rules and keeping them apart is the whole point.
 *
 * createCheckoutSession sets the address from the value the app supplied, on insert and on update.
 * The webhook path sets it only when it inserts a row: both Stripe fields it could read are
 * influenced by the buyer on a page the app does not control, so letting a delivery overwrite the row
 * would let a buyer silently redirect where receipts and dunning go.
 */

/** The values either writer supplies for one customer row; the row id and timestamps are decided here. */
export type PaymentsCustomerRowValues = {
  billingReferenceId: string
  billingScope: BillingScope
  stripeCustomerId: string
  billingContactEmail: string
  writtenAt: Date
}

/** One customer row as Postgres holds it, keyed by the Drizzle property names a caller reads. */
export type PaymentsCustomerRow = typeof paymentsCustomerTable.$inferSelect

/** The Stripe customer already on file for a reference, or nothing; an empty result is what makes customer-not-found deterministic offline. */
export async function readPaymentsCustomerRow(
  drizzleClient: NodePgDatabase<Record<string, unknown>>,
  billingReferenceId: string,
): Promise<PaymentsCustomerRow | undefined> {
  const rows = await drizzleClient
    .select()
    .from(paymentsCustomerTable)
    .where(eq(paymentsCustomerTable.billingReferenceId, billingReferenceId))
    .limit(1)
  return rows[0]
}

function customerInsertValues(values: PaymentsCustomerRowValues) {
  return {
    id: generatePaymentsRowId('paycus'),
    billingReferenceId: values.billingReferenceId,
    billingScope: values.billingScope,
    stripeCustomerId: values.stripeCustomerId,
    billingContactEmail: values.billingContactEmail,
    createdAt: values.writtenAt,
    updatedAt: values.writtenAt,
  }
}

/** Upsert from a checkout call, which may set the receipt address on an existing row because the app supplied it. */
export async function upsertPaymentsCustomerFromCheckout(
  drizzleClient: NodePgDatabase<Record<string, unknown>>,
  values: PaymentsCustomerRowValues,
): Promise<void> {
  await drizzleClient
    .insert(paymentsCustomerTable)
    .values(customerInsertValues(values))
    .onConflictDoUpdate({
      target: paymentsCustomerTable.billingReferenceId,
      set: {
        stripeCustomerId: values.stripeCustomerId,
        billingContactEmail: values.billingContactEmail,
        updatedAt: values.writtenAt,
      },
    })
}

// billingContactEmail is absent from the set clause on purpose, and that absence is the rule: on an
// existing row the address stays exactly as createCheckoutSession wrote it, from what the app said.
/** Upsert from a webhook delivery, which may seed the receipt address on a new row but never change one. */
export async function upsertPaymentsCustomerFromWebhook(
  drizzleClient: NodePgDatabase<Record<string, unknown>>,
  values: PaymentsCustomerRowValues,
): Promise<void> {
  await drizzleClient
    .insert(paymentsCustomerTable)
    .values(customerInsertValues(values))
    .onConflictDoUpdate({
      target: paymentsCustomerTable.billingReferenceId,
      set: {
        stripeCustomerId: values.stripeCustomerId,
        updatedAt: values.writtenAt,
      },
    })
}
