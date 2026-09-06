import { afterAll, describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  createVerifiedGatePaymentsDatabase,
  type GatePaymentsDatabase,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  buildGateCheckoutSessionObject,
  buildGateStripeWebhookDelivery,
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
import { listPaymentsPurchasesResultSchema, type PaymentsClient } from './payments-contract.ts'

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  paymentsClient: PaymentsClient
  gateDatabase: GatePaymentsDatabase
  oneTimePriceName: string
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const gateDatabase = await createVerifiedGatePaymentsDatabase('listbuys', paymentsEntry)
  const catalogNames = uniqueGatePaymentsCatalogNames('listbuys')
  const paymentsClient = createGatePaymentsClient({
    paymentsEntry,
    drizzleClient: gateDatabase.drizzleClient,
    paymentsCatalog: gatePaymentsCatalog(catalogNames),
  })
  return {
    paymentsEntry,
    paymentsClient,
    gateDatabase,
    oneTimePriceName: catalogNames.oneTimePriceName,
  }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ gateDatabase }) => gateDatabase.removeGatePaymentsDatabase())
})

describe('listPaymentsPurchases', () => {
  it('reports an empty list as a success for a reference that has bought nothing', async () => {
    const { paymentsEntry, paymentsClient } = await gateFile.read()

    // An empty array is a success rather than an -absent variant: "what has this customer bought"
    // has a correct empty answer, whereas "which subscription is current" has no meaningful empty row.
    const result = await paymentsEntry.listPaymentsPurchases({
      paymentsClient,
      billingReferenceId: uniqueGateBillingReferenceId('listbuys-none'),
    })
    listPaymentsPurchasesResultSchema.parse(result)
    expect(expectResultKind(result, 'payments-purchases-listed').paymentsPurchases).toEqual([])
  })

  it('lists every completed purchase for a reference, newest first', async () => {
    const { paymentsEntry, paymentsClient, oneTimePriceName } = await gateFile.read()
    const billingReferenceId = uniqueGateBillingReferenceId('listbuys-two')
    const nowSeconds = gateNowSecondsSinceEpoch()

    async function deliverPurchase(
      stripeCheckoutSessionId: string,
      purchasedAtSeconds: number,
    ): Promise<void> {
      const delivery = buildGateStripeWebhookDelivery(paymentsClient, {
        stripeEventType: 'checkout.session.completed',
        // purchasedAt comes from the EVENT's created, so the ordering this gate asserts is chosen
        // here rather than raced for: no sleeping, and no dependence on write order.
        createdSecondsSinceEpoch: purchasedAtSeconds,
        eventDataObject: buildGateCheckoutSessionObject({
          stripeCheckoutSessionId,
          stripeCustomerId: uniqueGateStripeId('cus'),
          checkoutMode: 'payment',
          paymentStatus: 'paid',
          billingContactEmail: uniqueGateBillingContactEmail('listbuys'),
          stripePaymentIntentId: uniqueGateStripeId('pi'),
          currency: 'usd',
          amountTotalMinorUnits: 29_900,
          metadata: {
            ...gateBillingReferenceMetadata(billingReferenceId),
            ...gateCheckoutPriceMetadata(oneTimePriceName, uniqueGateStripeId('price'), 1),
          },
        }),
      })
      const result = await paymentsEntry.handleStripeWebhook({
        paymentsClient,
        rawRequestBody: delivery.rawRequestBody,
        requestHeaders: delivery.requestHeaders,
      })
      expect(expectResultKind(result, 'payments-webhook-processed').webhookOutcome).toBe(
        'purchase-recorded',
      )
    }

    const olderSessionId = uniqueGateStripeId('cs')
    const newerSessionId = uniqueGateStripeId('cs')
    // Delivered oldest last, so a list that came back in insertion order would be wrong in the same
    // direction as one that came back unsorted.
    await deliverPurchase(newerSessionId, nowSeconds)
    await deliverPurchase(olderSessionId, nowSeconds - 3_600)

    const result = await paymentsEntry.listPaymentsPurchases({
      paymentsClient,
      billingReferenceId,
    })
    listPaymentsPurchasesResultSchema.parse(result)
    const listed = expectResultKind(result, 'payments-purchases-listed').paymentsPurchases

    expect(listed.map((purchase) => String(purchase.stripeCheckoutSessionId))).toEqual([
      newerSessionId,
      olderSessionId,
    ])
    // Only this reference's purchases: the other files' references are in other databases, but the
    // empty-list gate above shares this one, so a query that ignored the reference would show here.
    for (const purchase of listed) {
      expect(String(purchase.billingReferenceId)).toBe(billingReferenceId)
    }
  })
})
