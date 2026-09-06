import {
  maximumPaymentsPriceNameLength,
  paymentsCatalogInvalidErrorPrefix,
  paymentsCustomerNotFoundErrorPrefix,
  paymentsDatabaseUnavailableErrorPrefix,
  paymentsInputInvalidErrorPrefix,
  paymentsPriceNotFoundErrorPrefix,
  paymentsRequestFailedErrorPrefix,
  paymentsStripeUnauthorizedErrorPrefix,
  paymentsStripeUnreachableErrorPrefix,
  paymentsWebhookSignatureInvalidErrorPrefix,
  type BillingReferenceId,
  type PaymentsCatalogIssue,
  type PaymentsFailure,
  type PaymentsInvalidFieldName,
  type PriceLookupFailure,
  type WebhookSignatureFailureReason,
} from './payments-contract.ts'

/**
 * The one place a failure value is built, so every message keeps its unique literal prefix and no
 * variant is ever assembled twice with two different wordings.
 */

/** One variant of the failure union, selected by its kind, so a producer states which failure it returns. */
export type PaymentsFailureOfKind<TKind extends PaymentsFailure['kind']> = Extract<
  PaymentsFailure,
  { kind: TKind }
>

// The rule that was broken, never the value that broke it. A billing reference, an address and a
// redirect URL are all things a caller may log, and a reason that quoted its input would put one of
// them back in front of whoever reads the failure.
/** Why each caller-supplied field was rejected, stated as the rule and never as the rejected value. */
export const paymentsInvalidFieldReasons: Record<PaymentsInvalidFieldName, string> = {
  'billing-reference-id': 'must be a non-empty identifier that Better Auth generated',
  'billing-contact-email': 'must be a single valid mailbox',
  'price-name': `must be lowercase kebab-case of at most ${String(maximumPaymentsPriceNameLength)} characters`,
  quantity: 'must be a positive whole number of units',
  'success-url': 'must be an absolute http or https URL, because Stripe rejects a relative path',
  'cancel-url': 'must be an absolute http or https URL, because Stripe rejects a relative path',
  'return-url': 'must be an absolute http or https URL, because Stripe rejects a relative path',
  'raw-request-body':
    'must be the exact request text Stripe sent, so read request.text() and never request.json()',
  'request-headers': 'must be a Headers-like object carrying a get method',
  'stripe-api-base-url': 'must be an absolute http or https URL when it is supplied at all',
  'payments-env':
    'must carry STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET as non-empty values with no whitespace',
  'drizzle-client': 'must be the Drizzle client @hearthkit/db built',
}

/** Failure for a caller-supplied value rejected before any database or Stripe call is made. */
export function paymentsInputInvalidFailure(
  invalidFieldName: PaymentsInvalidFieldName,
): PaymentsFailureOfKind<'payments-input-invalid'> {
  const invalidFieldReason = paymentsInvalidFieldReasons[invalidFieldName]
  return {
    kind: 'payments-input-invalid',
    invalidFieldName,
    invalidFieldReason,
    message: `${paymentsInputInvalidErrorPrefix} ${invalidFieldName} ${invalidFieldReason}`,
  }
}

/** Failure naming every problem in the app's catalog in one list, because fixing one error per boot is miserable. */
export function paymentsCatalogInvalidFailure(
  catalogIssues: readonly PaymentsCatalogIssue[],
): PaymentsFailureOfKind<'payments-catalog-invalid'> {
  const perIssue = catalogIssues.map(
    (issue) =>
      `${issue.catalogIssueKind} at ${issue.catalogEntryName}: ${issue.catalogIssueReason}`,
  )
  return {
    kind: 'payments-catalog-invalid',
    catalogIssues: catalogIssues.map((issue) => ({ ...issue })),
    message: `${paymentsCatalogInvalidErrorPrefix} ${perIssue.join('; ')}`,
  }
}

// One variant with a discriminator rather than two kinds: the caller does the same thing with both,
// which is to tell the buyer this plan is unavailable, and only the operator's next step differs.
/** Failure when the named price is in neither the catalog nor Stripe; priceLookupFailure says which. */
export function paymentsPriceNotFoundFailure(
  priceName: string,
  priceLookupFailure: PriceLookupFailure,
): PaymentsFailureOfKind<'payments-price-not-found'> {
  const nextStep =
    priceLookupFailure === 'absent-from-catalog'
      ? 'no price in payments-catalog.ts carries that name'
      : 'the catalog carries that name but no active Stripe price does, so run the catalog sync against this account'
  return {
    kind: 'payments-price-not-found',
    priceName,
    priceLookupFailure,
    message: `${paymentsPriceNotFoundErrorPrefix} ${priceName} is ${priceLookupFailure}, ${nextStep}`,
  }
}

/** Failure when no customer row exists for the reference; only the portal call produces it, because checkout creates the row. */
export function paymentsCustomerNotFoundFailure(
  billingReferenceId: BillingReferenceId,
): PaymentsFailureOfKind<'payments-customer-not-found'> {
  return {
    kind: 'payments-customer-not-found',
    billingReferenceId,
    message: `${paymentsCustomerNotFoundErrorPrefix} that billing reference has never completed a checkout, so there is no Stripe customer to open a portal for`,
  }
}

// stripeFailureDetail is the SDK error's message and nothing else. StripeSignatureVerificationError
// also carries `.payload`, which is the raw webhook body and therefore whatever customer data the
// event held, so nothing here ever reads it.
/** Failure when a webhook request carried no signature header or one that does not verify. */
export function paymentsWebhookSignatureInvalidFailure(
  signatureFailureReason: WebhookSignatureFailureReason,
  stripeFailureDetail?: string,
): PaymentsFailureOfKind<'payments-webhook-signature-invalid'> {
  return {
    kind: 'payments-webhook-signature-invalid',
    signatureFailureReason,
    ...(stripeFailureDetail === undefined || stripeFailureDetail.length === 0
      ? {}
      : { stripeFailureDetail }),
    message: `${paymentsWebhookSignatureInvalidErrorPrefix} ${signatureFailureReason}, so this request did not come from Stripe`,
  }
}

/** Failure when Stripe refused the API key with 401 or its permissions with 403; the status says which. */
export function paymentsStripeUnauthorizedFailure(
  stripeErrorStatus: number,
  stripeFailureDetail: string,
): PaymentsFailureOfKind<'payments-stripe-unauthorized'> {
  return {
    kind: 'payments-stripe-unauthorized',
    stripeErrorStatus,
    stripeFailureDetail,
    message: `${paymentsStripeUnauthorizedErrorPrefix} Stripe answered ${String(stripeErrorStatus)}: ${stripeFailureDetail}`,
  }
}

/** Failure when the Stripe API could not be reached or the request timed out. */
export function paymentsStripeUnreachableFailure(
  stripeFailureDetail: string,
): PaymentsFailureOfKind<'payments-stripe-unreachable'> {
  return {
    kind: 'payments-stripe-unreachable',
    stripeFailureDetail,
    message: `${paymentsStripeUnreachableErrorPrefix} ${stripeFailureDetail}`,
  }
}

/** Failure when Postgres refuses, the password or database is wrong, or the migrations never ran. */
export function paymentsDatabaseUnavailableFailure(
  databaseFailureDetail: string,
): PaymentsFailureOfKind<'payments-database-unavailable'> {
  return {
    kind: 'payments-database-unavailable',
    databaseFailureDetail,
    message: `${paymentsDatabaseUnavailableErrorPrefix} ${databaseFailureDetail}`,
  }
}

// No discriminator, deliberately: several producers land here — a null checkoutUrl, a null
// session.currency, a null session.amount_total — and a caller cannot tell them apart. The detail is
// for a human reading a log; anything that genuinely needs a branch gets its own variant instead.
/** Catch-all failure carrying whatever Stripe supplied, so no call ever throws instead of returning. */
export function paymentsRequestFailedFailure(details: {
  paymentsFailureDetail: string
  stripeErrorCode?: string
  stripeErrorStatus?: number
  stripeErrorParam?: string
}): PaymentsFailureOfKind<'payments-request-failed'> {
  return {
    kind: 'payments-request-failed',
    ...(details.stripeErrorCode === undefined ? {} : { stripeErrorCode: details.stripeErrorCode }),
    ...(details.stripeErrorStatus === undefined
      ? {}
      : { stripeErrorStatus: details.stripeErrorStatus }),
    ...(details.stripeErrorParam === undefined
      ? {}
      : { stripeErrorParam: details.stripeErrorParam }),
    paymentsFailureDetail: details.paymentsFailureDetail,
    message: `${paymentsRequestFailedErrorPrefix} ${details.paymentsFailureDetail}`,
  }
}
