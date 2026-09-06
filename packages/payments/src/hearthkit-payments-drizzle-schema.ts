import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import type { HearthkitPaymentsDrizzleSchema } from './payments-contract.ts'

/**
 * The three payments tables, defined once for every project. The organizations scaffold flag decides
 * the `billingScope` written on a customer row and never which tables exist, for the same reason
 * `@hearthkit/auth` defines its organization tables in both modes: changing the flag later re-homes
 * existing rows, which is a data migration rather than a schema change.
 *
 * Every SQL table name equals the Drizzle schema key, because `verifyPaymentsTablesExist` looks these
 * same strings up in `information_schema.tables`. The SQL column names underneath are Drizzle's
 * business and are left equal to the property keys, which is the spelling a caller reads.
 *
 * There are deliberately no foreign keys to the auth tables. `billingReferenceId` points at `user` in
 * user-scoped mode and at `organization` in org-scoped mode, so one foreign key cannot express it and
 * adding one would couple this package's migrations to auth's table objects.
 */

/** The join between a hearthkit billing reference and a Stripe customer; one row per reference, and nothing else. */
export const paymentsCustomerTable = pgTable('payments_customer', {
  id: text().primaryKey(),
  billingReferenceId: text().notNull().unique(),
  billingScope: text().notNull(),
  stripeCustomerId: text().notNull().unique(),
  billingContactEmail: text().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})

// stripeSubscriptionId is unique because idempotency here is structural rather than a bookkeeping
// table: a replayed customer.subscription.* delivery writes the same values to the same row and the
// row count does not move. currentPeriodStart and currentPeriodEnd are nullable because they come
// from the subscription ITEM — stripe@22.6.1's Subscription object carries neither — and a
// subscription can be reported before an item that names a catalog price exists.
/** What Stripe last said about one subscription; `status` is a plain text column so a status Stripe adds later cannot break a write. */
export const paymentsSubscriptionTable = pgTable('payments_subscription', {
  id: text().primaryKey(),
  billingReferenceId: text().notNull(),
  stripeCustomerId: text().notNull(),
  stripeSubscriptionId: text().notNull().unique(),
  priceName: text().notNull(),
  stripePriceId: text().notNull(),
  status: text().notNull(),
  quantity: integer().notNull(),
  currentPeriodStart: timestamp(),
  currentPeriodEnd: timestamp(),
  cancelAtPeriodEnd: boolean().notNull().default(false),
  canceledAt: timestamp(),
  endedAt: timestamp(),
  trialStart: timestamp(),
  trialEnd: timestamp(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})

// stripeCheckoutSessionId is the idempotency key of the purchase path, for the same reason.
// stripePaymentIntentId is nullable because a fully discounted order has no payment intent at all.
/** One completed one-time checkout, recorded from the session's own fields and the metadata this package wrote. */
export const paymentsPurchaseTable = pgTable('payments_purchase', {
  id: text().primaryKey(),
  billingReferenceId: text().notNull(),
  stripeCustomerId: text().notNull(),
  stripeCheckoutSessionId: text().notNull().unique(),
  stripePaymentIntentId: text(),
  priceName: text().notNull(),
  stripePriceId: text().notNull(),
  currency: text().notNull(),
  amountTotalMinorUnits: integer().notNull(),
  quantity: integer().notNull(),
  purchasedAt: timestamp().notNull(),
  createdAt: timestamp().notNull(),
  updatedAt: timestamp().notNull(),
})

/** The Drizzle table map this package ships; spread it into the app's schema so one drizzle-kit run covers every table. */
export const hearthkitPaymentsDrizzleSchema = {
  payments_customer: paymentsCustomerTable,
  payments_subscription: paymentsSubscriptionTable,
  payments_purchase: paymentsPurchaseTable,
} satisfies HearthkitPaymentsDrizzleSchema
