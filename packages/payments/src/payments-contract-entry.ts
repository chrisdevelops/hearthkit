/**
 * The ./payments-contract subpath of @hearthkit/payments: a named re-export of the eighteen contract
 * values that live in payments-contract.ts and every public type, and nothing that reaches an
 * implementation module. It exists because @hearthkit/cli imports paymentsFailureSchema and
 * paymentsSyncedPriceSchema at runtime (plus the PaymentsFailure, PaymentsCatalog and
 * PaymentsEnvValues types, and paymentsCatalogSchema in its fixture) and templates/app imports
 * hearthkitPaymentsTableNames and the five wire constants, while the `.` entry imports stripe,
 * drizzle-orm/pg-core and the Drizzle table definitions, none of which the cli's `hearthkit payments
 * sync` or templates/app's drizzle.config.ts should have to load to read a schema. This file and
 * payments-contract.ts import only zod at runtime, so either loads under bare node with no side
 * effect.
 */

/** Contract values: this package's env fragment, the failure union every function returns, and the catalog schema an app parses payments-catalog.ts with. */
export {
  paymentsCatalogSchema,
  paymentsEnvSchemaFragment,
  paymentsFailureSchema,
} from './payments-contract.ts'

/** Contract values: the full result schema of each of the eight functions, for validating a value that crossed a process or network boundary. */
export {
  createCheckoutSessionResultSchema,
  createCustomerPortalSessionResultSchema,
  createPaymentsClientResultSchema,
  handleStripeWebhookResultSchema,
  listPaymentsPurchasesResultSchema,
  readPaymentsSubscriptionResultSchema,
  syncPaymentsCatalogResultSchema,
  verifyPaymentsTablesExistResultSchema,
} from './payments-contract.ts'

/** Contract values: the table names drizzle-kit is pointed at, and the per-price row shape a sync run reports. */
export { hearthkitPaymentsTableNames, paymentsSyncedPriceSchema } from './payments-contract.ts'

/** Contract values: the five wire constants an app needs to sign a webhook body and read Stripe metadata back. */
export {
  hearthkitBillingReferenceMetadataKey,
  hearthkitPriceNameMetadataKey,
  hearthkitQuantityMetadataKey,
  hearthkitStripePriceIdMetadataKey,
  stripeSignatureHeaderName,
} from './payments-contract.ts'

/** Contract types: the branded vocabulary and the two scope words billing is keyed on. */
export type {
  BillingContactEmail,
  BillingReferenceId,
  BillingReferenceOwnerId,
  BillingScope,
  HandledStripeWebhookEventType,
  HearthkitPaymentsTableName,
  PaymentsCurrencyCode,
  PaymentsCustomerId,
  PaymentsPriceName,
  PaymentsProductName,
  PaymentsPurchaseId,
  PaymentsRecurringInterval,
  PaymentsSubscriptionId,
  StripeCheckoutSessionId,
  StripeCustomerId,
  StripeEventId,
  StripePaymentIntentId,
  StripePriceId,
  StripeProductId,
  StripeSecretKey,
  StripeSubscriptionId,
  StripeWebhookSecret,
} from './payments-contract.ts'

/** Contract types: the env values, the catalog, the three records this package reports, and the Drizzle table map. */
export type {
  HearthkitPaymentsDrizzleSchema,
  PaymentsCatalog,
  PaymentsCatalogPrice,
  PaymentsCatalogProduct,
  PaymentsClient,
  PaymentsCustomer,
  PaymentsEnvValues,
  PaymentsPurchase,
  PaymentsSubscription,
  PaymentsSyncedPrice,
} from './payments-contract.ts'

/** Contract types: the failure union and every discriminator carried on one. */
export type {
  PaymentsCatalogIssue,
  PaymentsCatalogIssueKind,
  PaymentsFailure,
  PaymentsInvalidFieldName,
  PaymentsPriceSyncAction,
  PaymentsWebhookIgnoredReason,
  PaymentsWebhookOutcome,
  PriceLookupFailure,
  WebhookSignatureFailureReason,
} from './payments-contract.ts'

/** Contract types: the option, result and function shapes of every function above. */
export type {
  CreateCheckoutSession,
  CreateCheckoutSessionOptions,
  CreateCheckoutSessionResult,
  CreateCustomerPortalSession,
  CreateCustomerPortalSessionOptions,
  CreateCustomerPortalSessionResult,
  CreatePaymentsClient,
  CreatePaymentsClientOptions,
  CreatePaymentsClientResult,
  HandleStripeWebhook,
  HandleStripeWebhookOptions,
  HandleStripeWebhookResult,
  ListPaymentsPurchases,
  ListPaymentsPurchasesOptions,
  ListPaymentsPurchasesResult,
  ReadPaymentsSubscription,
  ReadPaymentsSubscriptionOptions,
  ReadPaymentsSubscriptionResult,
  SyncPaymentsCatalog,
  SyncPaymentsCatalogOptions,
  SyncPaymentsCatalogResult,
  VerifyPaymentsTablesExist,
  VerifyPaymentsTablesExistOptions,
  VerifyPaymentsTablesExistResult,
} from './payments-contract.ts'
