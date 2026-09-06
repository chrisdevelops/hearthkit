import type Stripe from 'stripe'
import { findPaymentsCatalogPrice } from './payments-catalog-lookup.ts'
import {
  billingContactEmailSchema,
  billingReferenceIdSchema,
  defaultCheckoutQuantity,
  hearthkitBillingReferenceMetadataKey,
  hearthkitBillingScopeMetadataKey,
  hearthkitPriceNameMetadataKey,
  hearthkitQuantityMetadataKey,
  hearthkitStripePriceIdMetadataKey,
  paymentsClientSchema,
  paymentsPriceNameSchema,
  paymentsQuantitySchema,
  paymentsRedirectUrlSchema,
  stripeCheckoutSessionIdSchema,
  stripeCustomerIdSchema,
  stripeOneTimeCheckoutMode,
  stripeSubscriptionCheckoutMode,
  type CreateCheckoutSessionOptions,
  type CreateCheckoutSessionResult,
  type PaymentsCatalogPrice,
  type PaymentsClient,
} from './payments-contract.ts'
import {
  readPaymentsCustomerRow,
  upsertPaymentsCustomerFromCheckout,
} from './payments-customer-record.ts'
import {
  paymentsInputInvalidFailure,
  paymentsPriceNotFoundFailure,
  paymentsRequestFailedFailure,
} from './payments-failure-results.ts'
import { findActiveStripePriceByLookupKey } from './stripe-price-lookup-key.ts'
import { thrownPaymentsErrorToFailure } from './thrown-payments-error-failure.ts'

/**
 * Creates a hosted Checkout Session, creating the Stripe customer and the local customer row when
 * neither exists yet. That is why this function can never report payments-customer-not-found: it is
 * the thing that puts a customer on file, and only the portal call refuses to.
 *
 * Every caller-supplied value is a plain string or number on the options object and is validated here
 * before any service is contacted, because these values always originate from user input or from an
 * HTTP request and validating them late produces a diagnostic that points at the wrong cause.
 */

// Three spellings of one idea, and all three are real: this package's priceKind, Stripe's Price.type,
// and Stripe's checkout mode. Note that the one-time case is `payment` here and `one_time` on the
// price object, and that Stripe's own word changes between the two.
function checkoutModeForCatalogPrice(
  catalogPrice: PaymentsCatalogPrice,
): Stripe.Checkout.SessionCreateParams.Mode {
  return catalogPrice.priceKind === 'subscription'
    ? stripeSubscriptionCheckoutMode
    : stripeOneTimeCheckoutMode
}

type ValidatedCheckoutInput = {
  paymentsClient: PaymentsClient
  billingReferenceId: string
  billingContactEmail: string
  priceName: string
  quantity: number
  successUrl: string
  cancelUrl: string
}

function validateCheckoutInput(
  options: CreateCheckoutSessionOptions,
): ValidatedCheckoutInput | CreateCheckoutSessionResult {
  if (!paymentsClientSchema.safeParse(options.paymentsClient).success) {
    return paymentsInputInvalidFailure('drizzle-client')
  }
  if (!billingReferenceIdSchema.safeParse(options.billingReferenceId).success) {
    return paymentsInputInvalidFailure('billing-reference-id')
  }
  if (!billingContactEmailSchema.safeParse(options.billingContactEmail).success) {
    return paymentsInputInvalidFailure('billing-contact-email')
  }
  // A well-formed name the catalog does not have is payments-price-not-found, not this: a name that
  // is not lowercase kebab-case could never have been a Stripe lookup key in the first place.
  if (!paymentsPriceNameSchema.safeParse(options.priceName).success) {
    return paymentsInputInvalidFailure('price-name')
  }
  const quantity = options.quantity ?? defaultCheckoutQuantity
  if (!paymentsQuantitySchema.safeParse(quantity).success) {
    return paymentsInputInvalidFailure('quantity')
  }
  if (!paymentsRedirectUrlSchema.safeParse(options.successUrl).success) {
    return paymentsInputInvalidFailure('success-url')
  }
  if (!paymentsRedirectUrlSchema.safeParse(options.cancelUrl).success) {
    return paymentsInputInvalidFailure('cancel-url')
  }
  return {
    paymentsClient: options.paymentsClient,
    billingReferenceId: options.billingReferenceId,
    billingContactEmail: options.billingContactEmail,
    priceName: options.priceName,
    quantity,
    // Handed to Stripe byte for byte, never round-tripped through `new URL(value).href`: Stripe
    // supports a {CHECKOUT_SESSION_ID} placeholder in success_url, and normalising percent-encodes the
    // braces, which turns the placeholder into literal text Stripe never substitutes.
    successUrl: options.successUrl,
    cancelUrl: options.cancelUrl,
  }
}

async function resolveCheckoutStripeCustomerId(input: ValidatedCheckoutInput): Promise<string> {
  const existingCustomerRow = await readPaymentsCustomerRow(
    input.paymentsClient.drizzleClient,
    input.billingReferenceId,
  )
  const stripeCustomerId =
    existingCustomerRow?.stripeCustomerId ??
    (
      await input.paymentsClient.stripeClient.customers.create({
        email: input.billingContactEmail,
        metadata: {
          [hearthkitBillingReferenceMetadataKey]: input.billingReferenceId,
          [hearthkitBillingScopeMetadataKey]: input.paymentsClient.billingScope,
        },
      })
    ).id

  // One Stripe customer per billing reference: a second one would orphan the first one's payment
  // methods and split one person's billing history in two.
  await upsertPaymentsCustomerFromCheckout(input.paymentsClient.drizzleClient, {
    billingReferenceId: input.billingReferenceId,
    billingScope: input.paymentsClient.billingScope,
    stripeCustomerId,
    billingContactEmail: input.billingContactEmail,
    writtenAt: new Date(),
  })
  return stripeCustomerId
}

/** Resolves the price, puts a Stripe customer on file, and opens a hosted Checkout Session. */
export async function createCheckoutSession(
  options: CreateCheckoutSessionOptions,
): Promise<CreateCheckoutSessionResult> {
  const input = validateCheckoutInput(options)
  if ('kind' in input) {
    return input
  }

  const catalogPrice = findPaymentsCatalogPrice(
    input.paymentsClient.paymentsCatalog,
    input.priceName,
  )
  if (catalogPrice === undefined) {
    return paymentsPriceNotFoundFailure(input.priceName, 'absent-from-catalog')
  }

  try {
    const stripePrice = await findActiveStripePriceByLookupKey(
      input.paymentsClient.stripeClient,
      input.priceName,
    )
    if (stripePrice === undefined) {
      return paymentsPriceNotFoundFailure(input.priceName, 'absent-from-stripe')
    }

    const stripeCustomerId = await resolveCheckoutStripeCustomerId(input)
    const referenceMetadata = {
      [hearthkitBillingReferenceMetadataKey]: input.billingReferenceId,
      [hearthkitBillingScopeMetadataKey]: input.paymentsClient.billingScope,
    }
    const checkoutMode = checkoutModeForCatalogPrice(catalogPrice)

    const checkoutSession = await input.paymentsClient.stripeClient.checkout.sessions.create({
      mode: checkoutMode,
      customer: stripeCustomerId,
      line_items: [{ price: stripePrice.id, quantity: input.quantity }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // The price trio goes on the SESSION and never on subscription_data.metadata: a portal upgrade
      // changes a subscription's price without touching metadata stamped at creation, so a stamped
      // price name would go stale and then be reported as fact. It is here because a webhook delivery
      // carries no line_items, so the purchase path has no other source for what it sold.
      metadata: {
        ...referenceMetadata,
        [hearthkitPriceNameMetadataKey]: input.priceName,
        [hearthkitStripePriceIdMetadataKey]: stripePrice.id,
        [hearthkitQuantityMetadataKey]: String(input.quantity),
      },
      // The second copy of the two reference keys, so customer.subscription.* events carry them on the
      // subscription object itself; without it those events have no reference at all.
      ...(checkoutMode === stripeSubscriptionCheckoutMode
        ? { subscription_data: { metadata: referenceMetadata } }
        : {}),
    })

    // Stripe types Session.url as `string | null` because it is only present while a hosted session is
    // active; this package always creates hosted sessions, so a null there is not a contract state.
    if (checkoutSession.url === null) {
      return paymentsRequestFailedFailure({
        paymentsFailureDetail:
          'Stripe created the checkout session without a hosted page URL, which a hosted session always has while it is active',
      })
    }

    return {
      kind: 'payments-checkout-session-created',
      stripeCheckoutSessionId: stripeCheckoutSessionIdSchema.parse(checkoutSession.id),
      checkoutUrl: checkoutSession.url,
      stripeCustomerId: stripeCustomerIdSchema.parse(stripeCustomerId),
      priceName: paymentsPriceNameSchema.parse(input.priceName),
      // Read off the object Stripe answered with, whose own generated type says it is true in live
      // mode and false in test mode. That is a measurement, not a match on an API key prefix.
      stripeLivemode: checkoutSession.livemode,
    }
  } catch (thrownValue) {
    return thrownPaymentsErrorToFailure(thrownValue, input.paymentsClient)
  }
}
