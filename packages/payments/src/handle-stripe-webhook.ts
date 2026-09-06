import type Stripe from 'stripe'
import { redactPaymentsClientSecrets } from './payments-client-secrets.ts'
import {
  paymentsClientSchema,
  paymentsRequestHeadersSchema,
  stripeEventIdSchema,
  stripeSignatureHeaderName,
  type HandleStripeWebhookOptions,
  type HandleStripeWebhookResult,
  type PaymentsClient,
} from './payments-contract.ts'
import {
  paymentsInputInvalidFailure,
  paymentsRequestFailedFailure,
  paymentsWebhookSignatureInvalidFailure,
} from './payments-failure-results.ts'
import { recordStripeCheckoutSessionDelivery } from './stripe-checkout-session-event.ts'
import { recordStripeSubscriptionDelivery } from './stripe-subscription-event.ts'
import {
  paymentsWebhookIgnoredResult,
  type StripeWebhookDeliveryIdentity,
} from './stripe-webhook-delivery-results.ts'
import {
  readThrownPaymentsErrorDetails,
  stripeSignatureVerificationErrorTypeName,
} from './thrown-payments-error-details.ts'
import { thrownPaymentsErrorToFailure } from './thrown-payments-error-failure.ts'

/**
 * Verifies a delivery and then records what Stripe reported. It contacts Stripe over the network
 * never: verification is a local HMAC, and every handled event carries everything the write needs on
 * the payload itself, so this whole surface runs with no Stripe key.
 *
 * rawRequestBody must be the exact bytes Stripe sent. In a Next.js route handler that means
 * `await request.text()`, never `await request.json()`, and never a body some framework middleware
 * has already parsed and re-serialised — re-serialising changes the bytes the HMAC covers and
 * surfaces as a signature mismatch rather than as the body-handling mistake it is.
 */

function verifyStripeWebhookDelivery(
  paymentsClient: PaymentsClient,
  rawRequestBody: string,
  signatureHeader: string,
): { kind: 'stripe-event-verified'; stripeEvent: Stripe.Event } | HandleStripeWebhookResult {
  try {
    return {
      kind: 'stripe-event-verified',
      stripeEvent: paymentsClient.stripeClient.webhooks.constructEvent(
        rawRequestBody,
        signatureHeader,
        String(paymentsClient.stripeWebhookSecret),
      ),
    }
  } catch (thrownValue) {
    const details = readThrownPaymentsErrorDetails(thrownValue)
    if (details.stripeErrorTypeName !== stripeSignatureVerificationErrorTypeName) {
      return thrownPaymentsErrorToFailure(thrownValue, paymentsClient)
    }
    // The SDK error also carries `.payload`, which is the raw webhook body and therefore whatever
    // customer data the event held. Only the message is ever quoted.
    return paymentsWebhookSignatureInvalidFailure(
      'signature-verification-failed',
      redactPaymentsClientSecrets(details.paymentsFailureDetail, paymentsClient),
    )
  }
}

async function routeStripeWebhookDelivery(
  paymentsClient: PaymentsClient,
  stripeEvent: Stripe.Event,
  delivery: StripeWebhookDeliveryIdentity,
): Promise<HandleStripeWebhookResult> {
  switch (stripeEvent.type) {
    case 'checkout.session.completed':
      return recordStripeCheckoutSessionDelivery(paymentsClient, stripeEvent.data.object, delivery)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return recordStripeSubscriptionDelivery(paymentsClient, stripeEvent.data.object, delivery)
    default:
      // Stripe delivers every event type an endpoint is subscribed to and most of them are none of
      // this package's business, so this is a result rather than an error.
      return paymentsWebhookIgnoredResult(delivery, 'event-type-not-handled')
  }
}

/** Verifies the stripe-signature header locally and records the delivery; it never calls Stripe and never throws. */
export async function handleStripeWebhook(
  options: HandleStripeWebhookOptions,
): Promise<HandleStripeWebhookResult> {
  if (!paymentsClientSchema.safeParse(options.paymentsClient).success) {
    return paymentsInputInvalidFailure('drizzle-client')
  }
  if (typeof options.rawRequestBody !== 'string' || options.rawRequestBody.length === 0) {
    return paymentsInputInvalidFailure('raw-request-body')
  }
  if (!paymentsRequestHeadersSchema.safeParse(options.requestHeaders).success) {
    return paymentsInputInvalidFailure('request-headers')
  }

  const signatureHeader = options.requestHeaders.get(stripeSignatureHeaderName)
  if (signatureHeader === null || signatureHeader.length === 0) {
    return paymentsWebhookSignatureInvalidFailure('signature-header-missing')
  }

  const verified = verifyStripeWebhookDelivery(
    options.paymentsClient,
    options.rawRequestBody,
    signatureHeader,
  )
  if (verified.kind !== 'stripe-event-verified') {
    return verified
  }

  const stripeEventId = stripeEventIdSchema.safeParse(verified.stripeEvent.id)
  if (!stripeEventId.success) {
    return paymentsRequestFailedFailure({
      paymentsFailureDetail:
        'a verified Stripe delivery carried no event id, so nothing can be traced back to it',
    })
  }
  const delivery: StripeWebhookDeliveryIdentity = {
    stripeEventId: stripeEventId.data,
    stripeEventType: verified.stripeEvent.type,
    eventCreatedAt: new Date(verified.stripeEvent.created * 1000),
  }

  try {
    return await routeStripeWebhookDelivery(options.paymentsClient, verified.stripeEvent, delivery)
  } catch (thrownValue) {
    return thrownPaymentsErrorToFailure(thrownValue, options.paymentsClient)
  }
}
