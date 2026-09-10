import type { AuthOrganizationId, AuthUserId } from '@hearthkit/auth/auth-contract'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type Stripe from 'stripe'
import { z } from 'zod'

/** Unique literal prefix of the failure message when a caller-supplied value is rejected before any service is contacted. */
export const paymentsInputInvalidErrorPrefix = 'hearthkit payments input invalid:'

/** Unique literal prefix of the failure message when the app's catalog is malformed or names something twice. */
export const paymentsCatalogInvalidErrorPrefix = 'hearthkit payments catalog invalid:'

/** Unique literal prefix of the failure message when a named price is in neither the catalog nor Stripe. */
export const paymentsPriceNotFoundErrorPrefix = 'hearthkit payments price not found:'

/** Unique literal prefix of the failure message when no customer row exists for the billing reference. */
export const paymentsCustomerNotFoundErrorPrefix = 'hearthkit payments customer not found:'

/** Unique literal prefix of the failure message when a webhook request carries no signature or a signature that does not verify. */
export const paymentsWebhookSignatureInvalidErrorPrefix =
  'hearthkit payments webhook signature invalid:'

/** Unique literal prefix of the failure message when Stripe refuses the API key or its permissions. */
export const paymentsStripeUnauthorizedErrorPrefix = 'hearthkit payments stripe unauthorized:'

/** Unique literal prefix of the failure message when the Stripe API could not be reached or the request timed out. */
export const paymentsStripeUnreachableErrorPrefix = 'hearthkit payments stripe unreachable:'

/** Unique literal prefix of the failure message when Postgres refuses, the password or database is wrong, or the tables are missing. */
export const paymentsDatabaseUnavailableErrorPrefix = 'hearthkit payments database unavailable:'

/** Unique literal prefix of the failure message when a payments call failed in a way this package does not name. */
export const paymentsRequestFailedErrorPrefix = 'hearthkit payments request failed:'

/** HTTP header Stripe signs a webhook delivery with; this package reads it off the request headers so the name is spelled once. */
export const stripeSignatureHeaderName = 'stripe-signature'

/** HTTP status Stripe answers with when the API key is wrong or revoked; mapped to payments-stripe-unauthorized. */
export const stripeUnauthorizedHttpStatus = 401

/** HTTP status Stripe answers with when a restricted key lacks the permission; mapped to the same failure as 401. */
export const stripeForbiddenHttpStatus = 403

/** Stripe checkout mode this package uses for a subscription price; Stripe spells the one-time case differently, see below. */
export const stripeSubscriptionCheckoutMode = 'subscription'

/** Stripe checkout mode this package uses for a one-time price; note it is `payment`, not `one-time` or `one_time`. */
export const stripeOneTimeCheckoutMode = 'payment'

/** Stripe price type for a subscription price, as Price.type reports it; not the same word as the checkout mode. */
export const stripeRecurringPriceType = 'recurring'

/** Stripe price type for a one-time price, as Price.type reports it; note the underscore, which the catalog spelling does not have. */
export const stripeOneTimePriceType = 'one_time'

/** Stripe metadata key carrying the billing reference on every session and subscription this package creates. */
export const hearthkitBillingReferenceMetadataKey = 'hearthkit_billing_reference_id'

/** Stripe metadata key carrying the billing scope on every session and subscription this package creates. */
export const hearthkitBillingScopeMetadataKey = 'hearthkit_billing_scope'

// THESE THREE GO ON THE SESSION ONLY, NEVER ON subscription_data.metadata. A webhook payload does not
// carry Checkout.Session.line_items — the field is declared optional and the SDK calls it "includable"
// on a retrieve — so the purchase path has no other source for the price it sold. The subscription
// path must NOT use them: a portal upgrade changes the subscription's price without touching metadata
// stamped at creation, so a stamped price name goes stale and becomes actively wrong. The subscription
// path reads its price live from items.data[].price.lookup_key instead, which cannot go stale.
/** Stripe session metadata key carrying the catalog price name a one-time purchase was for. */
export const hearthkitPriceNameMetadataKey = 'hearthkit_price_name'

/** Stripe session metadata key carrying the Stripe price id a one-time purchase was for. */
export const hearthkitStripePriceIdMetadataKey = 'hearthkit_stripe_price_id'

/** Stripe session metadata key carrying the quantity bought, written as a decimal string because Stripe metadata values are strings. */
export const hearthkitQuantityMetadataKey = 'hearthkit_quantity'

// The same four @better-auth/stripe handles, read out of its dist. Matching the set is deliberate:
// it is sufficient for subscription state, and it keeps a later move to that plugin a data question.
/** Stripe event types handleStripeWebhook acts on; every other type is reported as ignored, which is a result and not a failure. */
export const handledStripeWebhookEventTypes = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const

/** One handled Stripe event type; the literal union, so a typo cannot pass as an event type. */
export const handledStripeWebhookEventTypeSchema = z.enum(handledStripeWebhookEventTypes)

/** Name of a Stripe event this package acts on. */
export type HandledStripeWebhookEventType = z.infer<typeof handledStripeWebhookEventTypeSchema>

// Read off stripe@22.6.1's Subscription.Status at esm/resources/Subscriptions.d.ts:478. THE DECOY IS
// ONE UNION AWAY IN THE SAME FILE: SubscriptionListParams.Status at :2703 adds `all` and `ended`, and
// neither is a status a subscription can hold. The stored column is a plain string rather than an
// enum, because Stripe's own union ends in OtherString and can grow; this list is for comparison.
/** Subscription statuses Stripe reports at the pinned SDK version; the stored column accepts any string, so a new one cannot break a write. */
export const paymentsKnownSubscriptionStatuses = [
  'active',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'past_due',
  'paused',
  'trialing',
  'unpaid',
] as const

/** The two statuses that mean a customer is currently entitled; the same pair @better-auth/stripe's isActiveOrTrialing tests. */
export const paymentsActiveSubscriptionStatuses = ['active', 'trialing'] as const

// The same allowlist @hearthkit/auth uses for auth-database-unavailable, and the reasoning transfers
// with it. Deliberately NOT "any cause carrying a code": 23505 is a unique violation, which is a
// caller error rather than an unavailable database, and this package has three unique constraints a
// concurrent webhook delivery can race into. Everything outside these four stays in the catch-all.
/** Postgres and socket codes, found one .cause hop below a DrizzleQueryError, that mean the database is unavailable rather than the caller wrong. */
export const paymentsDatabaseUnavailableCauseCodes = [
  'ECONNREFUSED',
  '42P01',
  '3D000',
  '28P01',
] as const

/** Longest catalog product name this package accepts; it is also the Stripe product id, which must be unique in the account. */
export const maximumPaymentsProductNameLength = 100

/** Longest catalog price name this package accepts; it is also the Stripe price lookup_key, documented at 200 characters. */
export const maximumPaymentsPriceNameLength = 200

/** Quantity createCheckoutSession uses when the caller does not choose one. */
export const defaultCheckoutQuantity = 1

// The Drizzle schema key equals the SQL table name, the same rule @hearthkit/auth follows, so
// verifyPaymentsTablesExist and the schema share one list and there is nothing to keep in step.
/** Every table the shipped Drizzle schema defines, in both user-scoped and org-scoped mode; the flag never removes one. */
export const hearthkitPaymentsTableNames = [
  'payments_customer',
  'payments_subscription',
  'payments_purchase',
] as const

/** One of the three payments table names; used by the table presence check and by anything asserting the migration ran. */
export const hearthkitPaymentsTableNameSchema = z.enum(hearthkitPaymentsTableNames)

/** Name of one payments table; the literal union, so a typo cannot pass as a table name. */
export type HearthkitPaymentsTableName = z.infer<typeof hearthkitPaymentsTableNameSchema>

/** The Drizzle table map this package ships; spread it into the app's schema so one drizzle-kit run covers every table. */
export type HearthkitPaymentsDrizzleSchema = Record<HearthkitPaymentsTableName, unknown>

// Both secrets are validated as non-empty with no whitespace, and NOT by an `sk_` or `whsec_` prefix.
// Measured: stripe@22.6.1 computes `/\s/.test(secret)` and warns that whitespace "often indicates an
// extra newline or space is in the value", so whitespace is the mistake upstream itself names. A
// prefix, by contrast, would have to come from documentation, would reject a legitimate restricted
// key, and would break the day Stripe issues a different one. Test mode is asserted from `livemode`
// on a returned object instead, which is behaviour rather than a string match.
const noWhitespacePattern = /^\S+$/

/** Value of STRIPE_SECRET_KEY; a secret, so it never appears in a failure, a log line, or any returned value. */
export const stripeSecretKeySchema = z
  .string()
  .regex(noWhitespacePattern)
  .brand<'StripeSecretKey'>()

/** Branded Stripe API key; treat every value of this type as a secret that must not be printed. */
export type StripeSecretKey = z.infer<typeof stripeSecretKeySchema>

/** Value of STRIPE_WEBHOOK_SECRET; a secret, and the gates choose it rather than obtaining it from Stripe. */
export const stripeWebhookSecretSchema = z
  .string()
  .regex(noWhitespacePattern)
  .brand<'StripeWebhookSecret'>()

/** Branded webhook signing secret; treat every value of this type as a secret that must not be printed. */
export type StripeWebhookSecret = z.infer<typeof stripeWebhookSecretSchema>

/** Env schema fragment this package contributes to config; both variables are required, per plan 4.8's input line. */
export const paymentsEnvSchemaFragment = z.object({
  STRIPE_SECRET_KEY: stripeSecretKeySchema,
  STRIPE_WEBHOOK_SECRET: stripeWebhookSecretSchema,
})

/** Validated values of this package's variables, as config returns them; the input to createPaymentsClient. */
export type PaymentsEnvValues = z.output<typeof paymentsEnvSchemaFragment>

/** Whether billing is keyed on a user or on an organization; the same two words @better-auth/stripe uses for customerType. */
export const billingScopeSchema = z.enum(['user', 'organization'])

/** Billing scope of a project, decided by the auth scaffold flag and stored on every customer row. */
export type BillingScope = z.infer<typeof billingScopeSchema>

/** Identifier of whoever is billed; opaque and generated by Better Auth, so never parse or construct one by hand. */
export const billingReferenceIdSchema = z.string().min(1).brand<'BillingReferenceId'>()

/** Branded billing reference; one name for the value that is a user id in user scope and an organization id in org scope. */
export type BillingReferenceId = z.infer<typeof billingReferenceIdSchema>

/** The two auth ids a billing reference is parsed from; stated so the seam between the packages is visible in the types. */
export type BillingReferenceOwnerId = AuthUserId | AuthOrganizationId

/** Address Stripe sends receipts to; the same brand email and auth use, so one parsed address flows through all three packages. */
export const billingContactEmailSchema = z.email().brand<'EmailAddress'>()

/** Branded billing contact address; produced by parsing an untrusted string, never by casting one. */
export type BillingContactEmail = z.infer<typeof billingContactEmailSchema>

/** Catalog product name; lowercase kebab-case, and it is also the Stripe product id, which makes sync idempotent without a search. */
export const paymentsProductNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(maximumPaymentsProductNameLength)
  .brand<'PaymentsProductName'>()

/** Branded catalog product name; stable across syncs, because renaming it creates a second Stripe product. */
export type PaymentsProductName = z.infer<typeof paymentsProductNameSchema>

/** Catalog price name; lowercase kebab-case, unique across the whole catalog, and also the Stripe price lookup_key. */
export const paymentsPriceNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(maximumPaymentsPriceNameLength)
  .brand<'PaymentsPriceName'>()

/** Branded catalog price name; the one value checkout takes, sync writes, and the webhook handler reads back off the price. */
export type PaymentsPriceName = z.infer<typeof paymentsPriceNameSchema>

/** Currency of a price; three lowercase letters, which is how Stripe spells ISO 4217. */
export const paymentsCurrencyCodeSchema = z
  .string()
  .regex(/^[a-z]{3}$/)
  .brand<'PaymentsCurrencyCode'>()

/** Branded currency code; lowercase, because Stripe returns it lowercase and a mixed-case comparison would silently fail. */
export type PaymentsCurrencyCode = z.infer<typeof paymentsCurrencyCodeSchema>

/** Price amount in the currency's smallest unit, as Stripe's unit_amount; 1900 is nineteen dollars, not nineteen hundred. */
export const paymentsUnitAmountMinorUnitsSchema = z.number().int().positive()

/** How often a subscription price recurs; Stripe's four intervals and no others. */
export const paymentsRecurringIntervalSchema = z.enum(['day', 'week', 'month', 'year'])

/** Recurrence of a subscription price; absent from a one-time price, which is why the catalog price is a discriminated union. */
export type PaymentsRecurringInterval = z.infer<typeof paymentsRecurringIntervalSchema>

/** How many units of a price are being bought; a positive integer, defaulting to one. */
export const paymentsQuantitySchema = z.number().int().positive()

/** Identifier of a Stripe customer; opaque, generated by Stripe, so never parse or construct one. */
export const stripeCustomerIdSchema = z.string().min(1).brand<'StripeCustomerId'>()

/** Branded Stripe customer id; separately branded from the other Stripe ids because swapping two of them is the mistake a brand stops. */
export type StripeCustomerId = z.infer<typeof stripeCustomerIdSchema>

/** Identifier of a Stripe subscription; opaque, generated by Stripe, so never parse or construct one. */
export const stripeSubscriptionIdSchema = z.string().min(1).brand<'StripeSubscriptionId'>()

/** Branded Stripe subscription id; the unique key that makes a replayed webhook delivery an upsert rather than a duplicate row. */
export type StripeSubscriptionId = z.infer<typeof stripeSubscriptionIdSchema>

/** Identifier of a Stripe product; equal to the catalog product name, because this package supplies the id at create time. */
export const stripeProductIdSchema = z.string().min(1).brand<'StripeProductId'>()

/** Branded Stripe product id. */
export type StripeProductId = z.infer<typeof stripeProductIdSchema>

/** Identifier of a Stripe price; opaque, generated by Stripe, and it changes whenever a price is replaced. */
export const stripePriceIdSchema = z.string().min(1).brand<'StripePriceId'>()

/** Branded Stripe price id; never stable across a price change, which is why the catalog keys on the lookup key instead. */
export type StripePriceId = z.infer<typeof stripePriceIdSchema>

/** Identifier of a Stripe checkout session; opaque, generated by Stripe, so never parse or construct one. */
export const stripeCheckoutSessionIdSchema = z.string().min(1).brand<'StripeCheckoutSessionId'>()

/** Branded Stripe checkout session id; the unique key that makes a replayed purchase webhook an upsert rather than a duplicate row. */
export type StripeCheckoutSessionId = z.infer<typeof stripeCheckoutSessionIdSchema>

/** Identifier of a Stripe payment intent; opaque, and absent on a fully discounted order, which is why the column is nullable. */
export const stripePaymentIntentIdSchema = z.string().min(1).brand<'StripePaymentIntentId'>()

/** Branded Stripe payment intent id. */
export type StripePaymentIntentId = z.infer<typeof stripePaymentIntentIdSchema>

/** Identifier of a Stripe event; opaque, generated by Stripe, and reported back on every webhook result. */
export const stripeEventIdSchema = z.string().min(1).brand<'StripeEventId'>()

/** Branded Stripe event id; carried on both webhook results so a log line can be traced to a delivery in the Stripe dashboard. */
export type StripeEventId = z.infer<typeof stripeEventIdSchema>

/** Identifier of a customer row this package wrote; generated here, not by Stripe and not by Better Auth. */
export const paymentsCustomerIdSchema = z.string().min(1).brand<'PaymentsCustomerId'>()

/** Branded customer row id. */
export type PaymentsCustomerId = z.infer<typeof paymentsCustomerIdSchema>

/** Identifier of a subscription row this package wrote; generated here, not by Stripe. */
export const paymentsSubscriptionIdSchema = z.string().min(1).brand<'PaymentsSubscriptionId'>()

/** Branded subscription row id; not the Stripe subscription id, which is a separate column and a separate brand. */
export type PaymentsSubscriptionId = z.infer<typeof paymentsSubscriptionIdSchema>

/** Identifier of a purchase row this package wrote; generated here, not by Stripe. */
export const paymentsPurchaseIdSchema = z.string().min(1).brand<'PaymentsPurchaseId'>()

/** Branded purchase row id. */
export type PaymentsPurchaseId = z.infer<typeof paymentsPurchaseIdSchema>

// Stored as a plain string rather than an enum on purpose: Stripe's own union ends in OtherString and
// can grow, and a strict enum would turn a newly added status into a failed write in production.
// Compare against paymentsKnownSubscriptionStatuses instead of narrowing this.
/** Status of a subscription exactly as Stripe reported it; any string, so a status Stripe adds later cannot break a read or a write. */
export const paymentsSubscriptionStatusSchema = z.string().min(1)

/** Absolute http(s) URL a Stripe hosted page redirects back to; Stripe rejects a relative path, so this is checked before the call. */
export const paymentsRedirectUrlSchema = z.url({ protocol: /^https?$/ })

/** Base URL overriding the Stripe API host, port and protocol; omit it in every real deployment, it exists for tests and proxies. */
export const paymentsStripeApiBaseUrlSchema = z.url({ protocol: /^https?$/ })

/** A catalog price billed on a recurring schedule; maps to Stripe price type `recurring` and checkout mode `subscription`. */
export const paymentsSubscriptionCatalogPriceSchema = z.object({
  priceName: paymentsPriceNameSchema,
  currency: paymentsCurrencyCodeSchema,
  unitAmountMinorUnits: paymentsUnitAmountMinorUnitsSchema,
  priceKind: z.literal('subscription'),
  recurringInterval: paymentsRecurringIntervalSchema,
  recurringIntervalCount: z.number().int().positive().optional(),
})

/** A catalog price billed once; maps to Stripe price type `one_time` and checkout mode `payment`, neither of which is spelled this way. */
export const paymentsOneTimeCatalogPriceSchema = z.object({
  priceName: paymentsPriceNameSchema,
  currency: paymentsCurrencyCodeSchema,
  unitAmountMinorUnits: paymentsUnitAmountMinorUnitsSchema,
  priceKind: z.literal('one-time'),
})

// A discriminated union rather than an optional interval field, so a one-time price carrying a
// recurring interval is unrepresentable. It is also what keeps plan section 13's usage-based billing
// open: a metered price is a new member with its own fields, not a nullable column on this one.
/** One price in the catalog; the discriminant is priceKind, deliberately not billingMode, which Stripe already uses for something else. */
export const paymentsCatalogPriceSchema = z.discriminatedUnion('priceKind', [
  paymentsSubscriptionCatalogPriceSchema,
  paymentsOneTimeCatalogPriceSchema,
])

/** One catalog price; a subscription price or a one-time price, never a half-configured mixture of the two. */
export type PaymentsCatalogPrice = z.infer<typeof paymentsCatalogPriceSchema>

/** One product in the catalog; productName is the Stripe product id and displayName is what a buyer sees on the checkout page. */
export const paymentsCatalogProductSchema = z.object({
  productName: paymentsProductNameSchema,
  displayName: z.string().min(1).max(250),
  description: z.string().min(1).max(1000).optional(),
  prices: z.array(paymentsCatalogPriceSchema).min(1),
})

/** One catalog product with at least one price; a product with no prices is nothing anyone can buy. */
export type PaymentsCatalogProduct = z.infer<typeof paymentsCatalogProductSchema>

/** The whole catalog the app defines in payments-catalog.ts; price names must be unique across every product, not merely within one. */
export const paymentsCatalogSchema = z.object({
  products: z.array(paymentsCatalogProductSchema).min(1),
})

/** The app's product and price catalog; validated once by createPaymentsClient so a mistake fails at boot rather than at checkout. */
export type PaymentsCatalog = z.infer<typeof paymentsCatalogSchema>

// billingContactEmail is text NOT NULL and has two writers with different rules. createCheckoutSession
// sets it from the caller's value. The customer-linked webhook path sets it ONLY when it inserts a row,
// from `session.customer_details.email ?? session.customer_email`, and NEVER on an update. Both Stripe
// fields are influenced by the buyer on a page the app does not control, so allowing an update would
// let a buyer silently redirect where receipts and dunning go; seeding a row that did not exist is the
// only case where nothing better is available. Read both, in that order: customer_email is a PREFILL
// field and is null on every session created with a customer id, while customer_details.email is the
// one documented as populated after completion — but its own SECOND sentence widens it to "the most
// recent valid email provided by the customer on the Checkout form" when they consented to promotional
// content, which is why it may seed a row and may not overwrite one. Both null on an insert is
// payments-request-failed, not an ignore: a completed checkout this package cannot record is not a
// normal state. No gate covers that branch.
/** A customer row as this package reports it; one row per billing reference, holding the Stripe customer it maps to. */
export const paymentsCustomerSchema = z.object({
  id: paymentsCustomerIdSchema,
  billingReferenceId: billingReferenceIdSchema,
  billingScope: billingScopeSchema,
  stripeCustomerId: stripeCustomerIdSchema,
  billingContactEmail: billingContactEmailSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

/** Customer record; the join between a hearthkit billing reference and a Stripe customer, and nothing else. */
export type PaymentsCustomer = z.infer<typeof paymentsCustomerSchema>

// currentPeriodStart and currentPeriodEnd come from the subscription ITEM, not the subscription:
// stripe@22.6.1's Subscription object has no current_period_* field at all, and @better-auth/stripe's
// dist reads them off the item in all four of its handlers. Reaching for subscription.current_period_end
// finds nothing. They are nullable here because a subscription can be reported before an item exists.
//
// quantity comes from that same item's `quantity`, which the SDK types OPTIONAL (`quantity?: number`),
// and it defaults to 1 when absent. That is not in tension with the hearthkit_quantity rule, which
// refuses to default: absence has a defined meaning on Stripe's own object — the item has no explicit
// quantity, which is one unit — and no defined meaning in a metadata string this package wrote and
// read back, where a bad value means the data is untrustworthy. Default where absence means something.
/** A subscription row as this package reports it; every field is what Stripe last told us, not a local interpretation of it. */
export const paymentsSubscriptionSchema = z.object({
  id: paymentsSubscriptionIdSchema,
  billingReferenceId: billingReferenceIdSchema,
  stripeCustomerId: stripeCustomerIdSchema,
  stripeSubscriptionId: stripeSubscriptionIdSchema,
  priceName: paymentsPriceNameSchema,
  stripePriceId: stripePriceIdSchema,
  status: paymentsSubscriptionStatusSchema,
  quantity: paymentsQuantitySchema,
  currentPeriodStart: z.coerce.date().nullable(),
  currentPeriodEnd: z.coerce.date().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  canceledAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
  trialStart: z.coerce.date().nullable(),
  trialEnd: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

/** Subscription record; compare status against paymentsActiveSubscriptionStatuses rather than testing for the row's presence. */
export type PaymentsSubscription = z.infer<typeof paymentsSubscriptionSchema>

// Every column here comes from the webhook payload's own session object or from session metadata this
// package wrote, and NONE from line_items, which a webhook delivery does not carry. currency and
// amountTotalMinorUnits come from Session.currency and Session.amount_total, both of which Stripe
// types `| null`; a paid payment-mode session has them, and a null on this path is not a contract
// state and becomes payments-request-failed, the same treatment a null checkoutUrl gets.
/** A purchase row as this package reports it; one completed one-time checkout, keyed on the Stripe checkout session. */
export const paymentsPurchaseSchema = z.object({
  id: paymentsPurchaseIdSchema,
  billingReferenceId: billingReferenceIdSchema,
  stripeCustomerId: stripeCustomerIdSchema,
  stripeCheckoutSessionId: stripeCheckoutSessionIdSchema,
  stripePaymentIntentId: stripePaymentIntentIdSchema.nullable(),
  priceName: paymentsPriceNameSchema,
  stripePriceId: stripePriceIdSchema,
  currency: paymentsCurrencyCodeSchema,
  amountTotalMinorUnits: z.number().int().min(0),
  quantity: paymentsQuantitySchema,
  purchasedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

/** Purchase record; amountTotalMinorUnits is Stripe's amount_total and can be zero when a coupon covered the whole order. */
export type PaymentsPurchase = z.infer<typeof paymentsPurchaseSchema>

/** Which caller-supplied value a call was rejected for; the reason never repeats the value itself. */
export const paymentsInvalidFieldNameSchema = z.enum([
  'billing-reference-id',
  'billing-contact-email',
  'price-name',
  'quantity',
  'success-url',
  'cancel-url',
  'return-url',
  'raw-request-body',
  'request-headers',
  'stripe-api-base-url',
  'payments-env',
  'drizzle-client',
])

/** Name of the field a call was rejected for; a gate asserts on this rather than on message text. */
export type PaymentsInvalidFieldName = z.infer<typeof paymentsInvalidFieldNameSchema>

/** What is wrong with one catalog entry; entry-invalid covers every schema rejection and the reason states which rule broke. */
export const paymentsCatalogIssueKindSchema = z.enum([
  'catalog-has-no-products',
  'product-has-no-prices',
  'duplicate-product-name',
  'duplicate-price-name',
  'entry-invalid',
])

/** Kind of catalog problem; a gate asserts on this enum rather than on the reason text. */
export type PaymentsCatalogIssueKind = z.infer<typeof paymentsCatalogIssueKindSchema>

/** One problem with the catalog, naming the offending product or price and the rule it broke, never the rejected value. */
export const paymentsCatalogIssueSchema = z.object({
  catalogIssueKind: paymentsCatalogIssueKindSchema,
  catalogEntryName: z.string(),
  catalogIssueReason: z.string().min(1),
})

/** One catalog problem; reported in a list so one boot names every mistake instead of one per restart. */
export type PaymentsCatalogIssue = z.infer<typeof paymentsCatalogIssueSchema>

// Two causes, one variant, because the caller does the same thing with both — tell the buyer the plan
// is unavailable — and only the operator's next step differs. Same rule that produced auth's single
// auth-input-invalid with an invalidFieldName. absent-from-catalog needs no network at all.
/** Why a price could not be resolved: it is in no catalog entry, or the catalog has it but Stripe has never been synced. */
export const priceLookupFailureSchema = z.enum(['absent-from-catalog', 'absent-from-stripe'])

/** Which half of the price lookup failed; a gate asserts on this enum rather than on message text. */
export type PriceLookupFailure = z.infer<typeof priceLookupFailureSchema>

/** Why a webhook request was rejected: no signature header at all, or a header whose HMAC does not verify. */
export const webhookSignatureFailureReasonSchema = z.enum([
  'signature-header-missing',
  'signature-verification-failed',
])

/** Which half of signature checking failed; both mean the request did not come from Stripe, so both are the same failure kind. */
export type WebhookSignatureFailureReason = z.infer<typeof webhookSignatureFailureReasonSchema>

/** Failure when a caller-supplied value is rejected; produced before any database or Stripe call is made. */
export const paymentsInputInvalidFailureSchema = z.object({
  kind: z.literal('payments-input-invalid'),
  invalidFieldName: paymentsInvalidFieldNameSchema,
  invalidFieldReason: z.string().min(1),
  message: z.string().startsWith(paymentsInputInvalidErrorPrefix),
})

/** Failure when the app's catalog is malformed or names a product or price twice; every problem in one list. */
export const paymentsCatalogInvalidFailureSchema = z.object({
  kind: z.literal('payments-catalog-invalid'),
  catalogIssues: z.array(paymentsCatalogIssueSchema).min(1),
  message: z.string().startsWith(paymentsCatalogInvalidErrorPrefix),
})

/** Failure when the named price is in neither the catalog nor Stripe; priceLookupFailure says which, because the fixes differ. */
export const paymentsPriceNotFoundFailureSchema = z.object({
  kind: z.literal('payments-price-not-found'),
  priceName: z.string().min(1),
  priceLookupFailure: priceLookupFailureSchema,
  message: z.string().startsWith(paymentsPriceNotFoundErrorPrefix),
})

/** Failure when no customer row exists for the billing reference; only the portal call produces it, because checkout creates the row. */
export const paymentsCustomerNotFoundFailureSchema = z.object({
  kind: z.literal('payments-customer-not-found'),
  billingReferenceId: billingReferenceIdSchema,
  message: z.string().startsWith(paymentsCustomerNotFoundErrorPrefix),
})

// stripeFailureDetail is the SDK error's `message` and nothing else. NEVER quote the error's
// `payload` property: StripeSignatureVerificationError carries the raw webhook body on it, which
// holds whatever customer data the event held.
/** Failure when a webhook request carries no signature header or one that does not verify; the caller answers 400 and writes nothing. */
export const paymentsWebhookSignatureInvalidFailureSchema = z.object({
  kind: z.literal('payments-webhook-signature-invalid'),
  signatureFailureReason: webhookSignatureFailureReasonSchema,
  stripeFailureDetail: z.string().min(1).optional(),
  message: z.string().startsWith(paymentsWebhookSignatureInvalidErrorPrefix),
})

/** Failure when Stripe refused the API key with 401 or its permissions with 403; one kind, because the caller does the same thing. */
export const paymentsStripeUnauthorizedFailureSchema = z.object({
  kind: z.literal('payments-stripe-unauthorized'),
  stripeErrorStatus: z.number().int(),
  stripeFailureDetail: z.string().min(1),
  message: z.string().startsWith(paymentsStripeUnauthorizedErrorPrefix),
})

/** Failure when the Stripe API could not be reached or the request timed out; the sibling of db's server-unreachable variant. */
export const paymentsStripeUnreachableFailureSchema = z.object({
  kind: z.literal('payments-stripe-unreachable'),
  stripeFailureDetail: z.string().min(1),
  message: z.string().startsWith(paymentsStripeUnreachableErrorPrefix),
})

// The detail is built from the `.cause`, never from the DrizzleQueryError wrapper: the wrapper's
// message repeats the failing SQL AND its bound parameters, which here would put a customer's email
// address and Stripe ids into a returned failure that a caller is likely to log.
/** Failure when Postgres refuses, the password or database is wrong, or migrations never ran; one of four allowlisted cause codes. */
export const paymentsDatabaseUnavailableFailureSchema = z.object({
  kind: z.literal('payments-database-unavailable'),
  databaseFailureDetail: z.string().min(1),
  message: z.string().startsWith(paymentsDatabaseUnavailableErrorPrefix),
})

// stripeErrorCode comes from `error.code` and stripeErrorStatus from `error.statusCode`. DO NOT read
// `error.type` expecting Stripe's own type string: measured at stripe@22.6.1, the constructor sets
// `this.type = type || this.constructor.name`, so it holds the SDK CLASS NAME such as
// 'StripeInvalidRequestError'. Stripe's own `invalid_request_error` is at `error.rawType`.
//
// THERE IS NO DISCRIMINATOR HERE AND THAT IS DELIBERATE. Several producers land in this variant — a
// null checkoutUrl, a null session.currency, a null session.amount_total — and a caller cannot tell
// them apart, because the three optional Stripe fields are absent on all of those paths and only
// paymentsFailureDetail differs. The detail is for a human reading a log. A gate asserts the kind and
// a non-empty detail, never which producer fired. Anything needing a branch gets its own variant.
/** Catch-all failure for anything this package cannot classify; it exists so no call ever throws instead of returning. */
export const paymentsRequestFailedFailureSchema = z.object({
  kind: z.literal('payments-request-failed'),
  stripeErrorCode: z.string().min(1).optional(),
  stripeErrorStatus: z.number().int().optional(),
  stripeErrorParam: z.string().min(1).optional(),
  paymentsFailureDetail: z.string().min(1),
  message: z.string().startsWith(paymentsRequestFailedErrorPrefix),
})

/** Every way a payments call can fail; each variant's message starts with its unique prefix and names the value at fault. */
export const paymentsFailureSchema = z.discriminatedUnion('kind', [
  paymentsInputInvalidFailureSchema,
  paymentsCatalogInvalidFailureSchema,
  paymentsPriceNotFoundFailureSchema,
  paymentsCustomerNotFoundFailureSchema,
  paymentsWebhookSignatureInvalidFailureSchema,
  paymentsStripeUnauthorizedFailureSchema,
  paymentsStripeUnreachableFailureSchema,
  paymentsDatabaseUnavailableFailureSchema,
  paymentsRequestFailedFailureSchema,
])

/** Discriminated failure union returned, never thrown, by every public function of this package. */
export type PaymentsFailure = z.infer<typeof paymentsFailureSchema>

/** Runtime check that a value is a Drizzle node-postgres client; the precise schema type lives on the option types. */
export const paymentsDrizzleClientSchema = z.custom<NodePgDatabase<Record<string, unknown>>>(
  (value) => typeof value === 'object' && value !== null,
)

/** Runtime check that a value behaves like a web Headers object; duck-typed so Next's read-only headers pass, as auth does it. */
export const paymentsRequestHeadersSchema = z.custom<Headers>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'get' in value &&
    typeof value.get === 'function',
)

// This is the one value that legitimately carries the webhook secret, because carrying it to
// handleStripeWebhook is its entire job. It must never be logged, serialised or returned in a
// failure. The API key is not on it: the Stripe client already holds that internally.
/** The handle createPaymentsClient returns; every other function takes it, and it holds one secret, so never log or serialise it. */
export type PaymentsClient = {
  stripeClient: Stripe
  drizzleClient: NodePgDatabase<Record<string, unknown>>
  paymentsCatalog: PaymentsCatalog
  stripeWebhookSecret: StripeWebhookSecret
  organizationsEnabled: boolean
  billingScope: BillingScope
}

// Unlike auth's browser client, this handle is a plain object rather than a Proxy, so these property
// checks are real rather than vacuous. They are still shallow on purpose: asserting the shape of the
// Stripe client or the Drizzle client would pin someone else's internals.
/** Runtime check that a value is a payments client handle; the members this package relies on are present and of the right sort. */
export const paymentsClientSchema = z.custom<PaymentsClient>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    'stripeClient' in value &&
    typeof value.stripeClient === 'object' &&
    'drizzleClient' in value &&
    typeof value.drizzleClient === 'object' &&
    'paymentsCatalog' in value &&
    typeof value.paymentsCatalog === 'object' &&
    'billingScope' in value &&
    typeof value.billingScope === 'string',
)

/** Runtime shape of createPaymentsClient options; organizationsEnabled is the auth scaffold flag, never an env variable. */
export const createPaymentsClientOptionsSchema = z.object({
  paymentsEnv: paymentsEnvSchemaFragment,
  drizzleClient: paymentsDrizzleClientSchema,
  paymentsCatalog: paymentsCatalogSchema,
  organizationsEnabled: z.boolean(),
  stripeApiBaseUrl: paymentsStripeApiBaseUrlSchema.optional(),
})

/** Options type for createPaymentsClient; pass the whole config object as paymentsEnv, extra keys are ignored. */
export type CreatePaymentsClientOptions = {
  paymentsEnv: PaymentsEnvValues
  drizzleClient: NodePgDatabase<Record<string, unknown>>
  paymentsCatalog: PaymentsCatalog
  organizationsEnabled: boolean
  stripeApiBaseUrl?: string
}

/** Success shape of createPaymentsClient; module-private, reachable only through the result union below. The flag and the scope are echoed back so a caller holding the result knows which mode it built. */
const paymentsClientCreatedSchema = z.object({
  kind: z.literal('payments-client-created'),
  paymentsClient: paymentsClientSchema,
  organizationsEnabled: z.boolean(),
  billingScope: billingScopeSchema,
})

/** Full result union of createPaymentsClient for runtime validation in gates. */
export const createPaymentsClientResultSchema = z.union([
  paymentsClientCreatedSchema,
  paymentsFailureSchema,
])

/** Result type of createPaymentsClient. */
export type CreatePaymentsClientResult = z.infer<typeof createPaymentsClientResultSchema>

/** Signature of createPaymentsClient: synchronous so an app can build it at module scope, and it opens no connection. */
export type CreatePaymentsClient = (
  options: CreatePaymentsClientOptions,
) => CreatePaymentsClientResult

/** What sync did to one price: nothing, created it, or replaced it because Stripe prices are immutable in amount and currency. */
export const paymentsPriceSyncActionSchema = z.enum(['unchanged', 'created', 'replaced'])

/** Outcome of syncing one price; a second sync of an unchanged catalog reports every price unchanged. */
export type PaymentsPriceSyncAction = z.infer<typeof paymentsPriceSyncActionSchema>

/** One price after sync, with the Stripe ids it now maps to and what sync had to do to get there. */
export const paymentsSyncedPriceSchema = z.object({
  priceName: paymentsPriceNameSchema,
  stripeProductId: stripeProductIdSchema,
  stripePriceId: stripePriceIdSchema,
  syncAction: paymentsPriceSyncActionSchema,
})

/** One synced price; the stripePriceId changes whenever syncAction is replaced, which is why nothing stores it as an identity. */
export type PaymentsSyncedPrice = z.infer<typeof paymentsSyncedPriceSchema>

/** Runtime shape of syncPaymentsCatalog options; the catalog is the one held by the client, not a second one passed here. */
export const syncPaymentsCatalogOptionsSchema = z.object({
  paymentsClient: paymentsClientSchema,
})

/** Options type for syncPaymentsCatalog. */
export type SyncPaymentsCatalogOptions = {
  paymentsClient: PaymentsClient
}

// stripeLivemode is read off the Stripe object the API answered with, whose own generated type says
// it is true in live mode and false in test mode. It is here so a gate can refuse to touch a live
// account without matching on an API key prefix, which is a constant nothing offline can verify.
/** Success shape of syncPaymentsCatalog; module-private. stripeLivemode is the measured guard a gate asserts false before creating anything. */
const paymentsCatalogSyncedSchema = z.object({
  kind: z.literal('payments-catalog-synced'),
  syncedPrices: z.array(paymentsSyncedPriceSchema).min(1),
  stripeLivemode: z.boolean(),
})

/** Full result union of syncPaymentsCatalog for runtime validation in gates. */
export const syncPaymentsCatalogResultSchema = z.union([
  paymentsCatalogSyncedSchema,
  paymentsFailureSchema,
])

/** Result type of syncPaymentsCatalog. */
export type SyncPaymentsCatalogResult = z.infer<typeof syncPaymentsCatalogResultSchema>

/** Signature of syncPaymentsCatalog: idempotent, so a second run over an unchanged catalog reports every price unchanged. */
export type SyncPaymentsCatalog = (
  options: SyncPaymentsCatalogOptions,
) => Promise<SyncPaymentsCatalogResult>

/** Runtime shape of createCheckoutSession options; the caller-supplied values are plain strings because they come from a request. */
export const createCheckoutSessionOptionsSchema = z.object({
  paymentsClient: paymentsClientSchema,
  billingReferenceId: z.string(),
  billingContactEmail: z.string(),
  priceName: z.string(),
  quantity: z.number().optional(),
  successUrl: z.string(),
  cancelUrl: z.string(),
})

/** Options type for createCheckoutSession; quantity defaults to one, and both URLs must be absolute because Stripe requires it. */
export type CreateCheckoutSessionOptions = {
  paymentsClient: PaymentsClient
  billingReferenceId: string
  billingContactEmail: string
  priceName: string
  quantity?: number
  successUrl: string
  cancelUrl: string
}

/** Success shape of createCheckoutSession; module-private. checkoutUrl is the hosted page to redirect the buyer to. */
const paymentsCheckoutSessionCreatedSchema = z.object({
  kind: z.literal('payments-checkout-session-created'),
  stripeCheckoutSessionId: stripeCheckoutSessionIdSchema,
  checkoutUrl: z.url(),
  stripeCustomerId: stripeCustomerIdSchema,
  priceName: paymentsPriceNameSchema,
  stripeLivemode: z.boolean(),
})

/** Full result union of createCheckoutSession for runtime validation in gates. */
export const createCheckoutSessionResultSchema = z.union([
  paymentsCheckoutSessionCreatedSchema,
  paymentsFailureSchema,
])

/** Result type of createCheckoutSession. */
export type CreateCheckoutSessionResult = z.infer<typeof createCheckoutSessionResultSchema>

/** Signature of createCheckoutSession: creates the Stripe customer and the customer row when neither exists, so it never reports customer-not-found. */
export type CreateCheckoutSession = (
  options: CreateCheckoutSessionOptions,
) => Promise<CreateCheckoutSessionResult>

/** Runtime shape of createCustomerPortalSession options; returnUrl is where Stripe sends the customer back to. */
export const createCustomerPortalSessionOptionsSchema = z.object({
  paymentsClient: paymentsClientSchema,
  billingReferenceId: z.string(),
  returnUrl: z.string(),
})

/** Options type for createCustomerPortalSession. */
export type CreateCustomerPortalSessionOptions = {
  paymentsClient: PaymentsClient
  billingReferenceId: string
  returnUrl: string
}

/** Success shape of createCustomerPortalSession; module-private. portalUrl is short-lived, so it is redirected to rather than stored. */
const paymentsPortalSessionCreatedSchema = z.object({
  kind: z.literal('payments-portal-session-created'),
  portalUrl: z.url(),
  stripeCustomerId: stripeCustomerIdSchema,
})

/** Full result union of createCustomerPortalSession for runtime validation in gates. */
export const createCustomerPortalSessionResultSchema = z.union([
  paymentsPortalSessionCreatedSchema,
  paymentsFailureSchema,
])

/** Result type of createCustomerPortalSession. */
export type CreateCustomerPortalSessionResult = z.infer<
  typeof createCustomerPortalSessionResultSchema
>

/** Signature of createCustomerPortalSession: never creates a customer, which is why it is the only producer of payments-customer-not-found. */
export type CreateCustomerPortalSession = (
  options: CreateCustomerPortalSessionOptions,
) => Promise<CreateCustomerPortalSessionResult>

/** What the webhook handler wrote: it linked a customer, upserted a subscription, or recorded a one-time purchase. */
export const paymentsWebhookOutcomeSchema = z.enum([
  'customer-linked',
  'subscription-upserted',
  'purchase-recorded',
])

/** Outcome of a processed webhook delivery; created, updated and deleted subscriptions all report subscription-upserted. */
export type PaymentsWebhookOutcome = z.infer<typeof paymentsWebhookOutcomeSchema>

// The two price reasons are path-specific because the two paths read the price from different places
// and a reader must be able to tell which one fired. The subscription path resolves the catalog price
// from items.data[].price.lookup_key, so its reason is about the catalog. The checkout path has no
// line items in the payload at all and reads the price from session metadata, so its reason is about
// the metadata. A completed purchase is never ignored merely because the catalog entry was deleted
// afterwards: a purchase is a historical fact, and the metadata already carries everything the row
// needs, so the checkout path does not consult the catalog.
/** Why a delivered event was not acted on; every value here is a normal state, not a mistake by anyone. */
export const paymentsWebhookIgnoredReasonSchema = z.enum([
  'event-type-not-handled',
  'checkout-mode-not-handled',
  'checkout-session-unpaid',
  'billing-reference-missing',
  'checkout-price-metadata-missing',
  'subscription-price-not-in-catalog',
])

/** Reason a delivery was ignored; a gate asserts on this enum rather than on message text. */
export type PaymentsWebhookIgnoredReason = z.infer<typeof paymentsWebhookIgnoredReasonSchema>

// rawRequestBody must be the exact bytes Stripe sent. Measured at stripe@22.6.1, a parsed object
// throws `Webhook payload must be provided as a string or a Buffer …`, and a re-serialised body
// verifies as a signature mismatch rather than as the body-handling mistake it is. In a Next route
// handler that means `await request.text()`, never `await request.json()`.
/** Runtime shape of handleStripeWebhook options; the body is the raw request text and the headers carry the stripe-signature entry. */
export const handleStripeWebhookOptionsSchema = z.object({
  paymentsClient: paymentsClientSchema,
  rawRequestBody: z.string(),
  requestHeaders: paymentsRequestHeadersSchema,
})

/** Options type for handleStripeWebhook; requestHeaders is whatever the route handler's Request carried. */
export type HandleStripeWebhookOptions = {
  paymentsClient: PaymentsClient
  rawRequestBody: string
  requestHeaders: Headers
}

/** Result shape when the delivery was acted on; module-private. A replay of the same event writes the same row and moves no count. */
const paymentsWebhookProcessedSchema = z.object({
  kind: z.literal('payments-webhook-processed'),
  stripeEventId: stripeEventIdSchema,
  stripeEventType: z.string().min(1),
  webhookOutcome: paymentsWebhookOutcomeSchema,
})

/** Result shape when the delivery was verified but not acted on; module-private. A successful answer, not a failure, because most events are none of our business. */
const paymentsWebhookIgnoredSchema = z.object({
  kind: z.literal('payments-webhook-ignored'),
  stripeEventId: stripeEventIdSchema,
  stripeEventType: z.string().min(1),
  ignoredReason: paymentsWebhookIgnoredReasonSchema,
})

/** Full result union of handleStripeWebhook for runtime validation in gates. */
export const handleStripeWebhookResultSchema = z.union([
  paymentsWebhookProcessedSchema,
  paymentsWebhookIgnoredSchema,
  paymentsFailureSchema,
])

/** Result type of handleStripeWebhook. */
export type HandleStripeWebhookResult = z.infer<typeof handleStripeWebhookResultSchema>

/** Signature of handleStripeWebhook: verifies locally with an HMAC and never calls Stripe, so it needs Postgres but no network. */
export type HandleStripeWebhook = (
  options: HandleStripeWebhookOptions,
) => Promise<HandleStripeWebhookResult>

/** Runtime shape of readPaymentsSubscription options. */
export const readPaymentsSubscriptionOptionsSchema = z.object({
  paymentsClient: paymentsClientSchema,
  billingReferenceId: z.string(),
})

/** Options type for readPaymentsSubscription. */
export type ReadPaymentsSubscriptionOptions = {
  paymentsClient: PaymentsClient
  billingReferenceId: string
}

/** Result shape when a subscription row exists; module-private. The row is returned whatever its status, and the caller decides what counts as entitled. */
const paymentsSubscriptionFoundSchema = z.object({
  kind: z.literal('payments-subscription-found'),
  paymentsSubscription: paymentsSubscriptionSchema,
})

/** Result shape when the reference has no subscription row at all; module-private. Nobody having a subscription is a normal answer, not a failure. */
const paymentsSubscriptionAbsentSchema = z.object({
  kind: z.literal('payments-subscription-absent'),
})

/** Full result union of readPaymentsSubscription for runtime validation in gates. */
export const readPaymentsSubscriptionResultSchema = z.union([
  paymentsSubscriptionFoundSchema,
  paymentsSubscriptionAbsentSchema,
  paymentsFailureSchema,
])

/** Result type of readPaymentsSubscription. */
export type ReadPaymentsSubscriptionResult = z.infer<typeof readPaymentsSubscriptionResultSchema>

/** Signature of readPaymentsSubscription: returns the greatest createdAt for the reference, with id descending as the tiebreak. */
export type ReadPaymentsSubscription = (
  options: ReadPaymentsSubscriptionOptions,
) => Promise<ReadPaymentsSubscriptionResult>

/** Runtime shape of listPaymentsPurchases options. */
export const listPaymentsPurchasesOptionsSchema = z.object({
  paymentsClient: paymentsClientSchema,
  billingReferenceId: z.string(),
})

/** Options type for listPaymentsPurchases. */
export type ListPaymentsPurchasesOptions = {
  paymentsClient: PaymentsClient
  billingReferenceId: string
}

/** Success shape of listPaymentsPurchases; module-private. An empty array is a success, because "has bought nothing" is a correct answer. */
const paymentsPurchasesListedSchema = z.object({
  kind: z.literal('payments-purchases-listed'),
  paymentsPurchases: z.array(paymentsPurchaseSchema),
})

/** Full result union of listPaymentsPurchases for runtime validation in gates. */
export const listPaymentsPurchasesResultSchema = z.union([
  paymentsPurchasesListedSchema,
  paymentsFailureSchema,
])

/** Result type of listPaymentsPurchases. */
export type ListPaymentsPurchasesResult = z.infer<typeof listPaymentsPurchasesResultSchema>

/** Signature of listPaymentsPurchases: newest first by purchasedAt, with id descending as the tiebreak. */
export type ListPaymentsPurchases = (
  options: ListPaymentsPurchasesOptions,
) => Promise<ListPaymentsPurchasesResult>

/** Runtime shape of verifyPaymentsTablesExist options; it takes the Drizzle client so a health check needs no Stripe key. */
export const verifyPaymentsTablesExistOptionsSchema = z.object({
  drizzleClient: paymentsDrizzleClientSchema,
})

/** Options type for verifyPaymentsTablesExist. */
export type VerifyPaymentsTablesExistOptions = {
  drizzleClient: NodePgDatabase<Record<string, unknown>>
}

/** Result shape when every payments table is present in the public schema; module-private, and true in both user-scoped and org-scoped mode. */
const paymentsTablesPresentSchema = z.object({
  kind: z.literal('payments-tables-present'),
  presentTableNames: z.array(hearthkitPaymentsTableNameSchema).min(1),
})

/** Result shape when at least one payments table is absent; module-private, a successful check reporting a negative answer. */
const paymentsTablesMissingSchema = z.object({
  kind: z.literal('payments-tables-missing'),
  missingTableNames: z.array(hearthkitPaymentsTableNameSchema).min(1),
})

/** Full result union of verifyPaymentsTablesExist for runtime validation in gates. */
export const verifyPaymentsTablesExistResultSchema = z.union([
  paymentsTablesPresentSchema,
  paymentsTablesMissingSchema,
  paymentsFailureSchema,
])

/** Result type of verifyPaymentsTablesExist. */
export type VerifyPaymentsTablesExistResult = z.infer<typeof verifyPaymentsTablesExistResultSchema>

/** Signature of verifyPaymentsTablesExist: one query against information_schema, so it is safe to call from a health check. */
export type VerifyPaymentsTablesExist = (
  options: VerifyPaymentsTablesExistOptions,
) => Promise<VerifyPaymentsTablesExistResult>
