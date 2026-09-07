import { hearthkitAuthDrizzleSchema } from '@hearthkit/auth'

// hearthkit-section:begin @hearthkit/payments
import { hearthkitPaymentsDrizzleSchema } from '@hearthkit/payments'

// hearthkit-section:end @hearthkit/payments
/**
 * Every table this app's migration covers, in one file, because the app owns its migration.
 *
 * `drizzle.config.ts` points at this file and `drizzle-kit generate` reads it, and drizzle-kit only
 * looks at a module's TOP-LEVEL exported values: a table nested inside an exported object is invisible
 * to it. That is why each table is re-exported on its own line below rather than only through the maps
 * the packages ship. Renaming one of those exports is safe — the SQL table name lives on the table
 * object, not on the binding — but deleting one drops that table from the next migration.
 *
 * Add your own tables here with `pgTable` from `drizzle-orm/pg-core` and spread them into
 * `appDrizzleSchema` alongside the hearthkit ones.
 */

/** The auth table map exactly as `@hearthkit/auth` ships it; all seven exist whatever the organizations flag is. */
export { hearthkitAuthDrizzleSchema }

// hearthkit-section:begin @hearthkit/payments
/** The payments table map exactly as `@hearthkit/payments` ships it. */
export { hearthkitPaymentsDrizzleSchema }

// hearthkit-section:end @hearthkit/payments
/** Better Auth's account holder; the SQL table is `user`, which is a reserved word Drizzle quotes for you. */
export const authUserTable = hearthkitAuthDrizzleSchema.user

/** One signed-in session row. */
export const authSessionTable = hearthkitAuthDrizzleSchema.session

/** One credential or linked social account per user. */
export const authAccountTable = hearthkitAuthDrizzleSchema.account

/** One-time tokens: magic links, email verification and password resets. */
export const authVerificationTable = hearthkitAuthDrizzleSchema.verification

/** Organizations; present in user-scoped mode too, so moving between modes re-homes rows rather than migrating tables. */
export const authOrganizationTable = hearthkitAuthDrizzleSchema.organization

/** Membership of an organization, with the member's role. */
export const authMemberTable = hearthkitAuthDrizzleSchema.member

/** Outstanding invitations to an organization. */
export const authInvitationTable = hearthkitAuthDrizzleSchema.invitation

// hearthkit-section:begin @hearthkit/payments
/** One Stripe customer per billing reference. */
export const paymentsCustomerTable = hearthkitPaymentsDrizzleSchema.payments_customer

/** The most recent subscription state Stripe reported for a billing reference. */
export const paymentsSubscriptionTable = hearthkitPaymentsDrizzleSchema.payments_subscription

/** One completed one-time checkout. */
export const paymentsPurchaseTable = hearthkitPaymentsDrizzleSchema.payments_purchase

// hearthkit-section:end @hearthkit/payments
/** The whole table map, which is what the Drizzle client is built with; one object, one migration. */
export const appDrizzleSchema = {
  ...hearthkitAuthDrizzleSchema,
  // hearthkit-section:begin @hearthkit/payments
  ...hearthkitPaymentsDrizzleSchema,
  // hearthkit-section:end @hearthkit/payments
}
