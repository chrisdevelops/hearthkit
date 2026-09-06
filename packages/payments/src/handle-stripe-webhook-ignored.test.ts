import { afterAll, describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  countGatePaymentsRows,
  createVerifiedGatePaymentsDatabase,
  type GatePaymentsDatabase,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  buildGateCheckoutSessionObject,
  buildGateStripeWebhookDelivery,
  buildGateSubscriptionObject,
  gateBillingReferenceMetadata,
  gateCheckoutPriceMetadata,
  gateNowSecondsSinceEpoch,
  uniqueGateStripeId,
} from '../test-fixtures/payments-gate-stripe-events.ts'
import {
  gatePaymentsCatalog,
  uniqueGateBillingContactEmail,
  uniqueGateBillingReferenceId,
  uniqueGatePaymentsCatalogNames,
} from '../test-fixtures/payments-gate-values.ts'
import {
  createGatePaymentsClient,
  loadHearthkitPaymentsEntry,
  type HearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import {
  handleStripeWebhookResultSchema,
  type PaymentsClient,
  type PaymentsWebhookIgnoredReason,
} from './payments-contract.ts'

/**
 * Every value of ignoredReason, all six, with no Stripe key and no network. An ignored delivery is a
 * RESULT and not a failure: Stripe delivers every event type an endpoint is subscribed to and most of
 * them are none of this package's business, so modelling that as an error would make a webhook route
 * log a stack trace on an ordinary Tuesday.
 *
 * Every gate here also asserts that nothing was written. "Ignored" has to mean ignored: a delivery
 * that half-wrote a customer row and then declined to record the rest would pass a kind check while
 * leaving the database in a state nobody asked for.
 */

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  paymentsClient: PaymentsClient
  gateDatabase: GatePaymentsDatabase
  subscriptionPriceName: string
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const gateDatabase = await createVerifiedGatePaymentsDatabase('ignored', paymentsEntry)
  const catalogNames = uniqueGatePaymentsCatalogNames('ignored')
  const paymentsClient = createGatePaymentsClient({
    paymentsEntry,
    drizzleClient: gateDatabase.drizzleClient,
    paymentsCatalog: gatePaymentsCatalog(catalogNames),
  })
  return {
    paymentsEntry,
    paymentsClient,
    gateDatabase,
    subscriptionPriceName: catalogNames.subscriptionPriceName,
  }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ gateDatabase }) => gateDatabase.removeGatePaymentsDatabase())
})

/** Delivers one synthesised, locally signed event and asserts it was ignored for the stated reason, writing nothing. */
async function expectDeliveryIgnored(
  stripeEventType: string,
  eventDataObject: Record<string, unknown>,
  ignoredReason: PaymentsWebhookIgnoredReason,
): Promise<void> {
  const { paymentsEntry, paymentsClient, gateDatabase } = await gateFile.read()
  const delivery = buildGateStripeWebhookDelivery(paymentsClient, {
    stripeEventType,
    eventDataObject,
  })

  const result = await paymentsEntry.handleStripeWebhook({
    paymentsClient,
    rawRequestBody: delivery.rawRequestBody,
    requestHeaders: delivery.requestHeaders,
  })
  handleStripeWebhookResultSchema.parse(result)
  const ignored = expectResultKind(result, 'payments-webhook-ignored')

  expect(ignored.ignoredReason).toBe(ignoredReason)
  // Both webhook results carry the event id, so a log line traces back to a delivery in the Stripe
  // dashboard even when nothing was written.
  expect(String(ignored.stripeEventId)).toBe(delivery.stripeEventId)
  expect(ignored.stripeEventType).toBe(stripeEventType)

  expect(
    await countGatePaymentsRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema,
    ),
  ).toEqual({ payments_customer: 0, payments_subscription: 0, payments_purchase: 0 })
}

describe('payments-webhook-ignored', () => {
  it('ignores an event type it does not handle, reporting event-type-not-handled rather than failing', async () => {
    // The handled set is exactly the four @better-auth/stripe handles. invoice.paid is a real event
    // an endpoint can easily be subscribed to and is none of this package's business.
    await expectDeliveryIgnored(
      'invoice.paid',
      { id: uniqueGateStripeId('in'), object: 'invoice', livemode: false },
      'event-type-not-handled',
    )
  })

  it('ignores a completed session whose mode is setup, and one whose payment status is unpaid', async () => {
    const billingReferenceId = uniqueGateBillingReferenceId('ignored-mode')

    // Stripe's mode union is payment | setup | subscription. This package never creates a setup
    // session, so one arriving here came from somewhere else.
    await expectDeliveryIgnored(
      'checkout.session.completed',
      buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: uniqueGateStripeId('cs'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        checkoutMode: 'setup',
        paymentStatus: 'no_payment_required',
        billingContactEmail: uniqueGateBillingContactEmail('ignored-mode'),
        metadata: gateBillingReferenceMetadata(billingReferenceId),
      }),
      'checkout-mode-not-handled',
    )

    // A purchase is recorded for paid and for no_payment_required, which is what a fully discounted
    // order reports; unpaid is the third member of that union and the one that records nothing.
    await expectDeliveryIgnored(
      'checkout.session.completed',
      buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: uniqueGateStripeId('cs'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        checkoutMode: 'payment',
        paymentStatus: 'unpaid',
        billingContactEmail: uniqueGateBillingContactEmail('ignored-unpaid'),
        stripePaymentIntentId: uniqueGateStripeId('pi'),
        metadata: {
          ...gateBillingReferenceMetadata(billingReferenceId),
          ...gateCheckoutPriceMetadata(
            'gate-price-name-that-is-present',
            uniqueGateStripeId('price'),
            1,
          ),
        },
      }),
      'checkout-session-unpaid',
    )
  })

  it('ignores a session and a subscription that carry no billing reference metadata, because inventing one would attach someone else money to a hearthkit account', async () => {
    const { subscriptionPriceName } = await gateFile.read()

    await expectDeliveryIgnored(
      'checkout.session.completed',
      buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: uniqueGateStripeId('cs'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        checkoutMode: 'subscription',
        paymentStatus: 'paid',
        billingContactEmail: uniqueGateBillingContactEmail('ignored-noref'),
        stripeSubscriptionId: uniqueGateStripeId('sub'),
        metadata: {},
      }),
      'billing-reference-missing',
    )

    // One reason serves both paths because it means the same thing and has the same fix on each. A
    // subscription created by hand in the Stripe dashboard is exactly this: a real subscription on a
    // catalog price, with no hearthkit metadata on it anywhere.
    const nowSeconds = gateNowSecondsSinceEpoch()
    await expectDeliveryIgnored(
      'customer.subscription.created',
      buildGateSubscriptionObject({
        stripeSubscriptionId: uniqueGateStripeId('sub'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        subscriptionStatus: 'active',
        metadata: {},
        items: [
          {
            stripePriceId: uniqueGateStripeId('price'),
            priceLookupKey: subscriptionPriceName,
            quantity: 1,
            currentPeriodStartSeconds: nowSeconds,
            currentPeriodEndSeconds: nowSeconds + 2_592_000,
          },
        ],
      }),
      'billing-reference-missing',
    )
  })

  it('ignores a paid one-time session whose price metadata is absent, and one whose quantity is not a positive integer', async () => {
    const billingReferenceId = uniqueGateBillingReferenceId('ignored-price')

    // A delivery carries no line_items, so session metadata is the purchase path's only source for
    // what was sold. Without it there is no row to write, and this reason says to look at whatever
    // created the session rather than at the catalog.
    await expectDeliveryIgnored(
      'checkout.session.completed',
      buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: uniqueGateStripeId('cs'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        checkoutMode: 'payment',
        paymentStatus: 'paid',
        billingContactEmail: uniqueGateBillingContactEmail('ignored-price'),
        stripePaymentIntentId: uniqueGateStripeId('pi'),
        metadata: gateBillingReferenceMetadata(billingReferenceId),
      }),
      'checkout-price-metadata-missing',
    )

    // A quantity that is not a positive integer counts as missing rather than defaulting to one,
    // because silently billing one unit for an order of five is worse than declining to record it.
    await expectDeliveryIgnored(
      'checkout.session.completed',
      buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: uniqueGateStripeId('cs'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        checkoutMode: 'payment',
        paymentStatus: 'paid',
        billingContactEmail: uniqueGateBillingContactEmail('ignored-quantity'),
        stripePaymentIntentId: uniqueGateStripeId('pi'),
        metadata: {
          ...gateBillingReferenceMetadata(billingReferenceId),
          ...gateCheckoutPriceMetadata(
            'gate-price-name-that-is-present',
            uniqueGateStripeId('price'),
            'not-a-number',
          ),
        },
      }),
      'checkout-price-metadata-missing',
    )
  })

  it('ignores a subscription whose items carry no lookup key naming a catalog price, whether the key is foreign or absent', async () => {
    const billingReferenceId = uniqueGateBillingReferenceId('ignored-catalog')
    const nowSeconds = gateNowSecondsSinceEpoch()

    // The subscription path must consult the catalog, because priceName is resolved from lookup_key
    // and there is no metadata to fall back on. This reason says to look at the catalog, which is
    // exactly what the checkout path's reason does not say.
    await expectDeliveryIgnored(
      'customer.subscription.created',
      buildGateSubscriptionObject({
        stripeSubscriptionId: uniqueGateStripeId('sub'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        subscriptionStatus: 'active',
        metadata: gateBillingReferenceMetadata(billingReferenceId),
        items: [
          {
            stripePriceId: uniqueGateStripeId('price'),
            priceLookupKey: 'gate-price-belonging-to-some-other-catalog',
            quantity: 1,
            currentPeriodStartSeconds: nowSeconds,
            currentPeriodEndSeconds: nowSeconds + 2_592_000,
          },
        ],
      }),
      'subscription-price-not-in-catalog',
    )

    // Price.lookup_key is `string | null`, and a price created by hand in the dashboard has none.
    await expectDeliveryIgnored(
      'customer.subscription.updated',
      buildGateSubscriptionObject({
        stripeSubscriptionId: uniqueGateStripeId('sub'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        subscriptionStatus: 'active',
        metadata: gateBillingReferenceMetadata(billingReferenceId),
        items: [
          {
            stripePriceId: uniqueGateStripeId('price'),
            priceLookupKey: null,
            quantity: 1,
            currentPeriodStartSeconds: nowSeconds,
            currentPeriodEndSeconds: nowSeconds + 2_592_000,
          },
        ],
      }),
      'subscription-price-not-in-catalog',
    )
  })
})
