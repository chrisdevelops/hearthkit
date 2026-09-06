import { afterAll, describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  createVerifiedGatePaymentsDatabase,
  type GatePaymentsDatabase,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  buildGateStripeWebhookDelivery,
  buildGateSubscriptionObject,
  gateBillingReferenceMetadata,
  gateNowSecondsSinceEpoch,
  uniqueGateStripeId,
} from '../test-fixtures/payments-gate-stripe-events.ts'
import {
  gatePaymentsCatalog,
  uniqueGateBillingReferenceId,
  uniqueGatePaymentsCatalogNames,
} from '../test-fixtures/payments-gate-values.ts'
import {
  createGatePaymentsClient,
  loadHearthkitPaymentsEntry,
  type HearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import { readPaymentsSubscriptionResultSchema, type PaymentsClient } from './payments-contract.ts'

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  paymentsClient: PaymentsClient
  gateDatabase: GatePaymentsDatabase
  subscriptionPriceName: string
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const gateDatabase = await createVerifiedGatePaymentsDatabase('readsub', paymentsEntry)
  const catalogNames = uniqueGatePaymentsCatalogNames('readsub')
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

describe('readPaymentsSubscription', () => {
  it('reports payments-subscription-absent, which is a normal answer and not a failure, for a reference that has none', async () => {
    const { paymentsEntry, paymentsClient } = await gateFile.read()

    // Nobody having a subscription is the ordinary state of most accounts. Modelling it as an error
    // would send every entitlement check's happy path through a catch.
    const result = await paymentsEntry.readPaymentsSubscription({
      paymentsClient,
      billingReferenceId: uniqueGateBillingReferenceId('readsub-none'),
    })
    readPaymentsSubscriptionResultSchema.parse(result)
    expectResultKind(result, 'payments-subscription-absent')
  })

  it('returns the most recent subscription for a reference whatever its status, rather than the first or the active one', async () => {
    const { paymentsEntry, paymentsClient, subscriptionPriceName } = await gateFile.read()
    const billingReferenceId = uniqueGateBillingReferenceId('readsub-latest')
    const periodStartSeconds = gateNowSecondsSinceEpoch()

    async function deliverSubscription(
      stripeSubscriptionId: string,
      subscriptionStatus: string,
    ): Promise<void> {
      const delivery = buildGateStripeWebhookDelivery(paymentsClient, {
        stripeEventType: 'customer.subscription.created',
        eventDataObject: buildGateSubscriptionObject({
          stripeSubscriptionId,
          stripeCustomerId: uniqueGateStripeId('cus'),
          subscriptionStatus,
          metadata: gateBillingReferenceMetadata(billingReferenceId),
          items: [
            {
              stripePriceId: uniqueGateStripeId('price'),
              priceLookupKey: subscriptionPriceName,
              quantity: 1,
              currentPeriodStartSeconds: periodStartSeconds,
              currentPeriodEndSeconds: periodStartSeconds + 2_592_000,
            },
          ],
        }),
      })
      const result = await paymentsEntry.handleStripeWebhook({
        paymentsClient,
        rawRequestBody: delivery.rawRequestBody,
        requestHeaders: delivery.requestHeaders,
      })
      expect(expectResultKind(result, 'payments-webhook-processed').webhookOutcome).toBe(
        'subscription-upserted',
      )
    }

    const olderSubscriptionId = uniqueGateStripeId('sub')
    const newerSubscriptionId = uniqueGateStripeId('sub')
    await deliverSubscription(olderSubscriptionId, 'active')
    // "Most recent" means greatest createdAt, which this package writes from its own clock. A quarter
    // of a second between the two writes puts them in different milliseconds with room to spare, so
    // the id-descending tiebreak — whose values no gate can predict — never has to decide this.
    await new Promise((resolve) => setTimeout(resolve, 250))
    await deliverSubscription(newerSubscriptionId, 'canceled')

    const result = await paymentsEntry.readPaymentsSubscription({
      paymentsClient,
      billingReferenceId,
    })
    readPaymentsSubscriptionResultSchema.parse(result)
    const found = expectResultKind(result, 'payments-subscription-found').paymentsSubscription

    expect(String(found.stripeSubscriptionId)).toBe(newerSubscriptionId)
    // The newer row is the canceled one on purpose. The row is returned whatever its status and the
    // caller reads status and decides, so an implementation that filtered to the active ones would
    // hand back the older subscription here and fail.
    expect(found.status).toBe('canceled')
  })
})
