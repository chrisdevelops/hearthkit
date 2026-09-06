/** Public entry point of @hearthkit/payments: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Validates the catalog and builds the Stripe client; synchronous, and contacts nothing. */
export { createPaymentsClient } from './create-payments-client.ts'

/** Pushes the held catalog to Stripe; idempotent, so a second run reports every price unchanged. */
export { syncPaymentsCatalog } from './sync-payments-catalog.ts'

/** Creates a hosted Checkout Session, putting a Stripe customer on file when the reference has none. */
export { createCheckoutSession } from './create-checkout-session.ts'

/** Opens Stripe's hosted billing portal; it creates nothing, so it is the only producer of customer-not-found. */
export { createCustomerPortalSession } from './create-customer-portal-session.ts'

/** Verifies a delivery with a local HMAC and records it; it needs Postgres but never the network. */
export { handleStripeWebhook } from './handle-stripe-webhook.ts'

/** The most recent subscription row for a reference, whatever its status; having none is a normal answer. */
export { readPaymentsSubscription } from './read-payments-subscription.ts'

/** Every completed one-time purchase for a reference, newest first; an empty list is a success. */
export { listPaymentsPurchases } from './list-payments-purchases.ts'

/** One query against information_schema; it takes the Drizzle client so a health check needs no Stripe key. */
export { verifyPaymentsTablesExist } from './verify-payments-tables-exist.ts'

/** The Drizzle table map, always carrying all three tables whatever the organizations flag is. */
export { hearthkitPaymentsDrizzleSchema } from './hearthkit-payments-drizzle-schema.ts'

/** Contract values: the unique literal prefix every returned failure message starts with. */
export {
  paymentsCatalogInvalidErrorPrefix,
  paymentsCustomerNotFoundErrorPrefix,
  paymentsDatabaseUnavailableErrorPrefix,
  paymentsInputInvalidErrorPrefix,
  paymentsPriceNotFoundErrorPrefix,
  paymentsRequestFailedErrorPrefix,
  paymentsStripeUnauthorizedErrorPrefix,
  paymentsStripeUnreachableErrorPrefix,
  paymentsWebhookSignatureInvalidErrorPrefix,
} from './payments-contract.ts'

/** Contract values: the Stripe literals this package matches by exact equality, each read off stripe@22.6.1 rather than from documentation. */
export {
  stripeForbiddenHttpStatus,
  stripeOneTimeCheckoutMode,
  stripeOneTimePriceType,
  stripeParsedBodySignatureMessagePrefix,
  stripeRecurringPriceType,
  stripeSignatureHeaderName,
  stripeSignatureScheme,
  stripeSignatureToleranceSeconds,
  stripeSubscriptionCheckoutMode,
  stripeUnauthorizedHttpStatus,
  stripeWrongSchemeSignatureMessage,
  stripeWrongSecretSignatureMessagePrefix,
} from './payments-contract.ts'

/** Contract values: the Stripe metadata keys createCheckoutSession writes and the webhook handler reads back. */
export {
  hearthkitBillingReferenceMetadataKey,
  hearthkitBillingScopeMetadataKey,
  hearthkitPriceNameMetadataKey,
  hearthkitQuantityMetadataKey,
  hearthkitStripePriceIdMetadataKey,
} from './payments-contract.ts'

/** Contract values: the name lists, status lists and limits an app and a gate compare against. */
export {
  defaultCheckoutQuantity,
  handledStripeWebhookEventTypeSchema,
  handledStripeWebhookEventTypes,
  hearthkitPaymentsTableNameSchema,
  hearthkitPaymentsTableNames,
  maximumPaymentsPriceNameLength,
  maximumPaymentsProductNameLength,
  paymentsActiveSubscriptionStatuses,
  paymentsDatabaseUnavailableCauseCodes,
  paymentsKnownSubscriptionStatuses,
} from './payments-contract.ts'

/** Contract values: this package's env fragment and the two secret schemas it is built from. */
export {
  paymentsEnvSchemaFragment,
  stripeSecretKeySchema,
  stripeWebhookSecretSchema,
} from './payments-contract.ts'

/** Contract values: the branded vocabulary schemas, so an app can parse an untrusted value before calling anything here. */
export {
  billingContactEmailSchema,
  billingReferenceIdSchema,
  billingScopeSchema,
  paymentsCurrencyCodeSchema,
  paymentsCustomerIdSchema,
  paymentsPriceNameSchema,
  paymentsProductNameSchema,
  paymentsPurchaseIdSchema,
  paymentsQuantitySchema,
  paymentsRecurringIntervalSchema,
  paymentsRedirectUrlSchema,
  paymentsStripeApiBaseUrlSchema,
  paymentsSubscriptionIdSchema,
  paymentsSubscriptionStatusSchema,
  paymentsUnitAmountMinorUnitsSchema,
  stripeCheckoutSessionIdSchema,
  stripeCustomerIdSchema,
  stripeEventIdSchema,
  stripePaymentIntentIdSchema,
  stripePriceIdSchema,
  stripeProductIdSchema,
  stripeSubscriptionIdSchema,
} from './payments-contract.ts'

/** Contract values: the catalog schemas an app validates payments-catalog.ts with, and the three row shapes this package reports. */
export {
  paymentsCatalogPriceSchema,
  paymentsCatalogProductSchema,
  paymentsCatalogSchema,
  paymentsCustomerSchema,
  paymentsOneTimeCatalogPriceSchema,
  paymentsPurchaseSchema,
  paymentsSubscriptionCatalogPriceSchema,
  paymentsSubscriptionSchema,
} from './payments-contract.ts'

/** Contract values: each failure variant's schema, the discriminator enums, and the union of all nine. */
export {
  paymentsCatalogInvalidFailureSchema,
  paymentsCatalogIssueKindSchema,
  paymentsCatalogIssueSchema,
  paymentsCustomerNotFoundFailureSchema,
  paymentsDatabaseUnavailableFailureSchema,
  paymentsFailureSchema,
  paymentsInputInvalidFailureSchema,
  paymentsInvalidFieldNameSchema,
  paymentsPriceNotFoundFailureSchema,
  paymentsRequestFailedFailureSchema,
  paymentsStripeUnauthorizedFailureSchema,
  paymentsStripeUnreachableFailureSchema,
  paymentsWebhookSignatureInvalidFailureSchema,
  priceLookupFailureSchema,
  webhookSignatureFailureReasonSchema,
} from './payments-contract.ts'

/** Contract values: the runtime checks for the three structural values this package takes in or hands back. */
export {
  paymentsClientSchema,
  paymentsDrizzleClientSchema,
  paymentsRequestHeadersSchema,
} from './payments-contract.ts'

/** Contract values: each function's options, success-only and full result schemas, so a narrowed result can be validated without rebuilding the schema. */
export {
  createCheckoutSessionOptionsSchema,
  createCheckoutSessionResultSchema,
  createCustomerPortalSessionOptionsSchema,
  createCustomerPortalSessionResultSchema,
  createPaymentsClientOptionsSchema,
  createPaymentsClientResultSchema,
  handleStripeWebhookOptionsSchema,
  handleStripeWebhookResultSchema,
  listPaymentsPurchasesOptionsSchema,
  listPaymentsPurchasesResultSchema,
  paymentsCatalogSyncedSchema,
  paymentsCheckoutSessionCreatedSchema,
  paymentsClientCreatedSchema,
  paymentsPortalSessionCreatedSchema,
  paymentsPriceSyncActionSchema,
  paymentsPurchasesListedSchema,
  paymentsSubscriptionAbsentSchema,
  paymentsSubscriptionFoundSchema,
  paymentsSyncedPriceSchema,
  paymentsTablesMissingSchema,
  paymentsTablesPresentSchema,
  paymentsWebhookIgnoredReasonSchema,
  paymentsWebhookIgnoredSchema,
  paymentsWebhookOutcomeSchema,
  paymentsWebhookProcessedSchema,
  readPaymentsSubscriptionOptionsSchema,
  readPaymentsSubscriptionResultSchema,
  syncPaymentsCatalogOptionsSchema,
  syncPaymentsCatalogResultSchema,
  verifyPaymentsTablesExistOptionsSchema,
  verifyPaymentsTablesExistResultSchema,
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
