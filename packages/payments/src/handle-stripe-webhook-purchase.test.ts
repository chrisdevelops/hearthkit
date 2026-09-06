import { afterAll, describe, expect, it } from 'vitest'
import {
  expectOnlyGateElement,
  expectPaymentsFailure,
  expectResultKind,
  gateDateFromStripeSeconds,
} from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  countGatePaymentsRows,
  createVerifiedGatePaymentsDatabase,
  type GatePaymentsDatabase,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  buildGateCheckoutSessionObject,
  buildGateStripeWebhookDelivery,
  gateBillingReferenceMetadata,
  gateCheckoutPriceMetadata,
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
  listPaymentsPurchasesResultSchema,
  type PaymentsClient,
} from './payments-contract.ts'

/**
 * The purchase path, with no Stripe key and no network. Every column comes from the session's own
 * plain fields or from session metadata this package wrote, and none from line_items, which a webhook
 * delivery does not carry — the field is declared optional and the SDK calls it "includable" on a
 * retrieve, and nothing expands it on a delivery.
 *
 * The price name every gate here sells is deliberately NOT in the client's catalog. A purchase is a
 * historical fact: deleting a price from payments-catalog.ts must not make a completed order
 * unrecordable, so the checkout path does not consult the catalog at all.
 */

const priceNameNotInTheCatalog = 'gate-price-deleted-from-the-catalog'

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  paymentsClient: PaymentsClient
  gateDatabase: GatePaymentsDatabase
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const gateDatabase = await createVerifiedGatePaymentsDatabase('purchase', paymentsEntry)
  const paymentsClient = createGatePaymentsClient({
    paymentsEntry,
    drizzleClient: gateDatabase.drizzleClient,
    paymentsCatalog: gatePaymentsCatalog(uniqueGatePaymentsCatalogNames('purchase')),
  })
  return { paymentsEntry, paymentsClient, gateDatabase }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ gateDatabase }) => gateDatabase.removeGatePaymentsDatabase())
})

describe('handleStripeWebhook purchase path', () => {
  it('records a purchase for a paid one-time session and for a fully discounted one, from session metadata rather than line items', async () => {
    const { paymentsEntry, paymentsClient } = await gateFile.read()

    const paidReferenceId = uniqueGateBillingReferenceId('purchase-paid')
    const paidSessionId = uniqueGateStripeId('cs')
    const paidCustomerId = uniqueGateStripeId('cus')
    const paidPaymentIntentId = uniqueGateStripeId('pi')
    const paidPriceId = uniqueGateStripeId('price')
    const paidDelivery = buildGateStripeWebhookDelivery(paymentsClient, {
      stripeEventType: 'checkout.session.completed',
      eventDataObject: buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: paidSessionId,
        stripeCustomerId: paidCustomerId,
        checkoutMode: 'payment',
        paymentStatus: 'paid',
        billingContactEmail: uniqueGateBillingContactEmail('purchase-paid'),
        stripePaymentIntentId: paidPaymentIntentId,
        currency: 'usd',
        amountTotalMinorUnits: 59_800,
        metadata: {
          ...gateBillingReferenceMetadata(paidReferenceId),
          // Quantity is a decimal STRING, because every Stripe metadata value is a string, and it is
          // parsed back here rather than defaulted.
          ...gateCheckoutPriceMetadata(priceNameNotInTheCatalog, paidPriceId, 2),
        },
      }),
    })

    const paidResult = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: paidDelivery.rawRequestBody,
      requestHeaders: paidDelivery.requestHeaders,
    })
    handleStripeWebhookResultSchema.parse(paidResult)
    const paidProcessed = expectResultKind(paidResult, 'payments-webhook-processed')
    expect(paidProcessed.webhookOutcome).toBe('purchase-recorded')
    expect(String(paidProcessed.stripeEventId)).toBe(paidDelivery.stripeEventId)

    const paidList = await paymentsEntry.listPaymentsPurchases({
      paymentsClient,
      billingReferenceId: paidReferenceId,
    })
    listPaymentsPurchasesResultSchema.parse(paidList)
    const paidPurchases = expectResultKind(paidList, 'payments-purchases-listed').paymentsPurchases
    expect(paidPurchases).toHaveLength(1)
    const paidPurchase = expectOnlyGateElement(paidPurchases, 'purchase for the paid reference')
    expect(String(paidPurchase.stripeCheckoutSessionId)).toBe(paidSessionId)
    expect(String(paidPurchase.stripeCustomerId)).toBe(paidCustomerId)
    expect(String(paidPurchase.stripePaymentIntentId)).toBe(paidPaymentIntentId)
    expect(String(paidPurchase.billingReferenceId)).toBe(paidReferenceId)
    expect(String(paidPurchase.priceName)).toBe(priceNameNotInTheCatalog)
    expect(String(paidPurchase.stripePriceId)).toBe(paidPriceId)
    expect(String(paidPurchase.currency)).toBe('usd')
    expect(paidPurchase.amountTotalMinorUnits).toBe(59_800)
    expect(paidPurchase.quantity).toBe(2)
    // purchasedAt is the EVENT's created, seconds since the epoch, not the moment the row was written.
    expect(paidPurchase.purchasedAt.getTime()).toBe(
      gateDateFromStripeSeconds(paidDelivery.createdSecondsSinceEpoch).getTime(),
    )

    // A fully discounted order: no payment intent at all, which is why that column is nullable, and
    // a zero total, which is why amountTotalMinorUnits allows zero. payment_status is
    // no_payment_required, the third member of that union and the second one that records a purchase.
    const discountedReferenceId = uniqueGateBillingReferenceId('purchase-free')
    const discountedSessionId = uniqueGateStripeId('cs')
    const discountedDelivery = buildGateStripeWebhookDelivery(paymentsClient, {
      stripeEventType: 'checkout.session.completed',
      eventDataObject: buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: discountedSessionId,
        stripeCustomerId: uniqueGateStripeId('cus'),
        checkoutMode: 'payment',
        paymentStatus: 'no_payment_required',
        billingContactEmail: uniqueGateBillingContactEmail('purchase-free'),
        stripePaymentIntentId: null,
        currency: 'usd',
        amountTotalMinorUnits: 0,
        metadata: {
          ...gateBillingReferenceMetadata(discountedReferenceId),
          ...gateCheckoutPriceMetadata(priceNameNotInTheCatalog, uniqueGateStripeId('price'), 1),
        },
      }),
    })

    const discountedResult = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: discountedDelivery.rawRequestBody,
      requestHeaders: discountedDelivery.requestHeaders,
    })
    handleStripeWebhookResultSchema.parse(discountedResult)
    expect(expectResultKind(discountedResult, 'payments-webhook-processed').webhookOutcome).toBe(
      'purchase-recorded',
    )

    const discountedList = expectResultKind(
      await paymentsEntry.listPaymentsPurchases({
        paymentsClient,
        billingReferenceId: discountedReferenceId,
      }),
      'payments-purchases-listed',
    )
    expect(discountedList.paymentsPurchases).toHaveLength(1)
    const discountedPurchase = expectOnlyGateElement(
      discountedList.paymentsPurchases,
      'purchase for the fully discounted reference',
    )
    expect(discountedPurchase.stripePaymentIntentId).toBeNull()
    expect(discountedPurchase.amountTotalMinorUnits).toBe(0)
  })

  it('writes no second row when the same purchase delivery arrives twice, because the write is an upsert on the checkout session id', async () => {
    const { paymentsEntry, paymentsClient, gateDatabase } = await gateFile.read()
    const billingReferenceId = uniqueGateBillingReferenceId('purchase-replay')
    const before = await countGatePaymentsRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema,
    )

    const delivery = buildGateStripeWebhookDelivery(paymentsClient, {
      stripeEventType: 'checkout.session.completed',
      eventDataObject: buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: uniqueGateStripeId('cs'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        checkoutMode: 'payment',
        paymentStatus: 'paid',
        billingContactEmail: uniqueGateBillingContactEmail('purchase-replay'),
        stripePaymentIntentId: uniqueGateStripeId('pi'),
        currency: 'usd',
        amountTotalMinorUnits: 29_900,
        metadata: {
          ...gateBillingReferenceMetadata(billingReferenceId),
          ...gateCheckoutPriceMetadata(priceNameNotInTheCatalog, uniqueGateStripeId('price'), 1),
        },
      }),
    })

    // Stripe delivers events more than once. Idempotency here is structural rather than a
    // bookkeeping table: the same bytes write the same values to the same row.
    for (const attempt of [1, 2]) {
      const result = await paymentsEntry.handleStripeWebhook({
        paymentsClient,
        rawRequestBody: delivery.rawRequestBody,
        requestHeaders: delivery.requestHeaders,
      })
      handleStripeWebhookResultSchema.parse(result)
      expect(
        expectResultKind(result, 'payments-webhook-processed').webhookOutcome,
        `delivery attempt ${attempt}`,
      ).toBe('purchase-recorded')
    }

    const after = await countGatePaymentsRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema,
    )
    // Asserting exactly one new row is stronger than asserting the second delivery was refused,
    // because it holds even if the two deliveries interleave.
    expect(after.payments_purchase - before.payments_purchase).toBe(1)

    const listed = expectResultKind(
      await paymentsEntry.listPaymentsPurchases({ paymentsClient, billingReferenceId }),
      'payments-purchases-listed',
    )
    expect(listed.paymentsPurchases).toHaveLength(1)
  })

  it('reports payments-request-failed when a paid session carries no currency, which is not a contract state', async () => {
    const { paymentsEntry, paymentsClient, gateDatabase } = await gateFile.read()
    const before = await countGatePaymentsRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema,
    )

    // Session.currency and Session.amount_total are plain nullable fields, not expandable ones, so a
    // paid payment-mode session has both. A null here means something the contract does not model,
    // and it lands in the catch-all rather than being written as an empty string or a zero.
    const delivery = buildGateStripeWebhookDelivery(paymentsClient, {
      stripeEventType: 'checkout.session.completed',
      eventDataObject: buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: uniqueGateStripeId('cs'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        checkoutMode: 'payment',
        paymentStatus: 'paid',
        billingContactEmail: uniqueGateBillingContactEmail('purchase-nocurrency'),
        stripePaymentIntentId: uniqueGateStripeId('pi'),
        currency: null,
        amountTotalMinorUnits: null,
        metadata: {
          ...gateBillingReferenceMetadata(uniqueGateBillingReferenceId('purchase-nocurrency')),
          ...gateCheckoutPriceMetadata(priceNameNotInTheCatalog, uniqueGateStripeId('price'), 1),
        },
      }),
    })

    const result = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: delivery.rawRequestBody,
      requestHeaders: delivery.requestHeaders,
    })
    handleStripeWebhookResultSchema.parse(result)
    const failure = expectPaymentsFailure(result, 'payments-request-failed')
    expect(failure.paymentsFailureDetail.length).toBeGreaterThan(0)

    const after = await countGatePaymentsRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema,
    )
    expect(after.payments_purchase).toBe(before.payments_purchase)
  })
})
