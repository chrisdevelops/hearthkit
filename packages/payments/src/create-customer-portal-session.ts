import {
  billingReferenceIdSchema,
  paymentsClientSchema,
  paymentsRedirectUrlSchema,
  stripeCustomerIdSchema,
  type CreateCustomerPortalSessionOptions,
  type CreateCustomerPortalSessionResult,
} from './payments-contract.ts'
import { readPaymentsCustomerRow } from './payments-customer-record.ts'
import {
  paymentsCustomerNotFoundFailure,
  paymentsInputInvalidFailure,
} from './payments-failure-results.ts'
import { thrownPaymentsErrorToFailure } from './thrown-payments-error-failure.ts'

/**
 * Opens Stripe's hosted billing portal for the customer already on file. It never creates one —
 * opening a billing portal for a person who has never paid is not a thing to do quietly — which is
 * why this is the only producer of payments-customer-not-found in the whole package.
 *
 * That failure is an empty query result rather than an API-level error code, so it is deterministic
 * and needs no network at all: nothing here asks Stripe to tell us the customer is missing.
 *
 * If a live call fails with a Stripe error about a portal configuration, the account needs its
 * test-mode billing portal settings saved once in the Stripe dashboard. That is a one-off human step
 * rather than a bug in this package.
 */
export async function createCustomerPortalSession(
  options: CreateCustomerPortalSessionOptions,
): Promise<CreateCustomerPortalSessionResult> {
  if (!paymentsClientSchema.safeParse(options.paymentsClient).success) {
    return paymentsInputInvalidFailure('drizzle-client')
  }
  const parsedReference = billingReferenceIdSchema.safeParse(options.billingReferenceId)
  if (!parsedReference.success) {
    return paymentsInputInvalidFailure('billing-reference-id')
  }
  if (!paymentsRedirectUrlSchema.safeParse(options.returnUrl).success) {
    return paymentsInputInvalidFailure('return-url')
  }

  try {
    const customerRow = await readPaymentsCustomerRow(
      options.paymentsClient.drizzleClient,
      String(parsedReference.data),
    )
    if (customerRow === undefined) {
      return paymentsCustomerNotFoundFailure(parsedReference.data)
    }

    // BillingPortal.Session.url is typed non-nullable, so unlike a checkout session's url there is no
    // null case to rule out here.
    const portalSession = await options.paymentsClient.stripeClient.billingPortal.sessions.create({
      customer: customerRow.stripeCustomerId,
      return_url: options.returnUrl,
    })

    return {
      kind: 'payments-portal-session-created',
      portalUrl: portalSession.url,
      stripeCustomerId: stripeCustomerIdSchema.parse(customerRow.stripeCustomerId),
    }
  } catch (thrownValue) {
    return thrownPaymentsErrorToFailure(thrownValue, options.paymentsClient)
  }
}
