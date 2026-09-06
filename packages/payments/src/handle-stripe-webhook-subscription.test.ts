import { afterAll, describe, expect, it } from 'vitest'
import {
  expectResultKind,
  gateDateFromStripeSeconds,
} from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  countGatePaymentsRows,
  createVerifiedGatePaymentsDatabase,
  readGatePaymentsTableRows,
  type GatePaymentsDatabase,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  buildGateCheckoutSessionObject,
  buildGateStripeWebhookDelivery,
  buildGateSubscriptionObject,
  gateBillingReferenceMetadata,
  gateNowSecondsSinceEpoch,
  uniqueGateStripeId,
  type GateSubscriptionItemOptions,
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
  paymentsActiveSubscriptionStatuses,
  paymentsCustomerSchema,
  paymentsKnownSubscriptionStatuses,
  readPaymentsSubscriptionResultSchema,
  type PaymentsClient,
} from './payments-contract.ts'

/**
 * Plan 4.8's gate line reads "replay a checkout.session.completed event through the webhook handler,
 * confirm the subscription row exists". That sequence cannot pass against this contract, and
 * CONTRACT.md says so in as many words under "Deviation from plan 4.8's gate wording": a
 * subscription-mode checkout.session.completed upserts the CUSTOMER row and reports
 * 'customer-linked', because a delivery carries no line_items and this package declines the retrieve
 * call that would be needed to do what the plan literally describes. The subscription row only ever
 * comes from customer.subscription.*, which Stripe sends for the same checkout anyway.
 *
 * So the sequence below is the contract's three-event replacement: checkout, then created, then
 * created again. All of it is synthesised and signed locally, so it needs no Stripe key.
 */

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  paymentsClient: PaymentsClient
  gateDatabase: GatePaymentsDatabase
  subscriptionPriceName: string
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const gateDatabase = await createVerifiedGatePaymentsDatabase('subscription', paymentsEntry)
  const catalogNames = uniqueGatePaymentsCatalogNames('subscription')
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

const thirtyDaysInSeconds = 2_592_000

function catalogSubscriptionItem(
  subscriptionPriceName: string,
  stripePriceId: string,
  currentPeriodStartSeconds: number,
  quantity = 3,
): GateSubscriptionItemOptions {
  return {
    stripePriceId,
    priceLookupKey: subscriptionPriceName,
    quantity,
    currentPeriodStartSeconds,
    currentPeriodEndSeconds: currentPeriodStartSeconds + thirtyDaysInSeconds,
  }
}

describe('handleStripeWebhook subscription path', () => {
  it('links the customer on a subscription checkout and then records the subscription row on customer.subscription.created', async () => {
    const { paymentsEntry, paymentsClient, gateDatabase, subscriptionPriceName } =
      await gateFile.read()
    const billingReferenceId = uniqueGateBillingReferenceId('sub-sequence')
    const billingContactEmail = uniqueGateBillingContactEmail('sub-sequence')
    const stripeCustomerId = uniqueGateStripeId('cus')
    const stripeSubscriptionId = uniqueGateStripeId('sub')
    const stripePriceId = uniqueGateStripeId('price')
    const periodStartSeconds = gateNowSecondsSinceEpoch()

    // Step one. A subscription-mode completed session links the customer; it does NOT write the
    // subscription row, and expecting it to is the plan's wording rather than this contract's.
    const checkoutDelivery = buildGateStripeWebhookDelivery(paymentsClient, {
      stripeEventType: 'checkout.session.completed',
      eventDataObject: buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: uniqueGateStripeId('cs'),
        stripeCustomerId,
        checkoutMode: 'subscription',
        paymentStatus: 'paid',
        billingContactEmail,
        stripeSubscriptionId,
        metadata: gateBillingReferenceMetadata(billingReferenceId),
      }),
    })
    const checkoutResult = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: checkoutDelivery.rawRequestBody,
      requestHeaders: checkoutDelivery.requestHeaders,
    })
    handleStripeWebhookResultSchema.parse(checkoutResult)
    expect(expectResultKind(checkoutResult, 'payments-webhook-processed').webhookOutcome).toBe(
      'customer-linked',
    )

    const customerRows = await readGatePaymentsTableRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema.payments_customer,
    )
    const writtenRow = customerRows.find(
      (row) => String(row.billingReferenceId) === billingReferenceId,
    )
    expect(
      writtenRow,
      'a subscription checkout must leave a customer row for its reference',
    ).toBeDefined()
    const customerRow = paymentsCustomerSchema.parse(writtenRow)
    expect(String(customerRow.stripeCustomerId)).toBe(stripeCustomerId)
    // The scaffold flag decides this one value; the client was built with organizationsEnabled false.
    expect(customerRow.billingScope).toBe('user')
    // CONTRACT.md names no source for this column on the webhook path — the purchase path has a
    // column-to-source table and the customer path does not — so the synthesised session carries the
    // same address in both `customer_email` and `customer_details.email` and either read satisfies
    // this. What the column cannot be is empty: it is text NOT NULL and it is where receipts go.
    expect(String(customerRow.billingContactEmail)).toBe(billingContactEmail)

    // Step two, which is the assertion plan 4.8 asks for, one event later than it says.
    const createdDelivery = buildGateStripeWebhookDelivery(paymentsClient, {
      stripeEventType: 'customer.subscription.created',
      eventDataObject: buildGateSubscriptionObject({
        stripeSubscriptionId,
        stripeCustomerId,
        subscriptionStatus: 'trialing',
        metadata: gateBillingReferenceMetadata(billingReferenceId),
        items: [catalogSubscriptionItem(subscriptionPriceName, stripePriceId, periodStartSeconds)],
        trialStartSeconds: periodStartSeconds,
        trialEndSeconds: periodStartSeconds + thirtyDaysInSeconds,
      }),
    })
    const createdResult = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: createdDelivery.rawRequestBody,
      requestHeaders: createdDelivery.requestHeaders,
    })
    handleStripeWebhookResultSchema.parse(createdResult)
    expect(expectResultKind(createdResult, 'payments-webhook-processed').webhookOutcome).toBe(
      'subscription-upserted',
    )

    const read = await paymentsEntry.readPaymentsSubscription({
      paymentsClient,
      billingReferenceId,
    })
    readPaymentsSubscriptionResultSchema.parse(read)
    const found = expectResultKind(read, 'payments-subscription-found').paymentsSubscription
    expect(String(found.stripeSubscriptionId)).toBe(stripeSubscriptionId)
    expect(String(found.stripeCustomerId)).toBe(stripeCustomerId)
    expect(String(found.stripePriceId)).toBe(stripePriceId)
    // Resolved from the price's lookup_key, which syncPaymentsCatalog set to the catalog price name.
    // SubscriptionItem.price is typed Price and never a string id, so this needs no second API call.
    expect(String(found.priceName)).toBe(subscriptionPriceName)
    expect(found.status).toBe('trialing')
    expect([...paymentsActiveSubscriptionStatuses]).toContain(found.status)
    expect(found.quantity).toBe(3)
    // The period dates come from the subscription ITEM. stripe@22.6.1's Subscription object has no
    // current_period_start or current_period_end at all, so reaching for one finds nothing.
    expect(found.currentPeriodStart?.getTime()).toBe(
      gateDateFromStripeSeconds(periodStartSeconds).getTime(),
    )
    expect(found.currentPeriodEnd?.getTime()).toBe(
      gateDateFromStripeSeconds(periodStartSeconds + thirtyDaysInSeconds).getTime(),
    )
    // These five are subscription-level fields that really do exist, unlike the period pair.
    expect(found.cancelAtPeriodEnd).toBe(false)
    expect(found.canceledAt).toBeNull()
    expect(found.endedAt).toBeNull()
    expect(found.trialStart?.getTime()).toBe(
      gateDateFromStripeSeconds(periodStartSeconds).getTime(),
    )
    expect(found.trialEnd?.getTime()).toBe(
      gateDateFromStripeSeconds(periodStartSeconds + thirtyDaysInSeconds).getTime(),
    )
  })

  it('leaves exactly one subscription row when the same customer.subscription.created delivery arrives twice', async () => {
    const { paymentsEntry, paymentsClient, gateDatabase, subscriptionPriceName } =
      await gateFile.read()
    const billingReferenceId = uniqueGateBillingReferenceId('sub-replay')
    const before = await countGatePaymentsRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema,
    )

    const delivery = buildGateStripeWebhookDelivery(paymentsClient, {
      stripeEventType: 'customer.subscription.created',
      eventDataObject: buildGateSubscriptionObject({
        stripeSubscriptionId: uniqueGateStripeId('sub'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        subscriptionStatus: 'active',
        metadata: gateBillingReferenceMetadata(billingReferenceId),
        items: [
          catalogSubscriptionItem(
            subscriptionPriceName,
            uniqueGateStripeId('price'),
            gateNowSecondsSinceEpoch(),
          ),
        ],
      }),
    })

    // The replay half of plan 4.8's gate. Deliver the same event twice, then assert exactly one row,
    // which is stronger than asserting the second delivery was refused because it holds even if the
    // two deliveries interleave.
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
      ).toBe('subscription-upserted')
    }

    const after = await countGatePaymentsRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema,
    )
    expect(after.payments_subscription - before.payments_subscription).toBe(1)
  })

  it('upserts the same row when Stripe reports an update and again when it reports a deletion, ending with the terminal status and endedAt', async () => {
    const { paymentsEntry, paymentsClient, gateDatabase, subscriptionPriceName } =
      await gateFile.read()
    const billingReferenceId = uniqueGateBillingReferenceId('sub-lifecycle')
    const stripeSubscriptionId = uniqueGateStripeId('sub')
    const stripeCustomerId = uniqueGateStripeId('cus')
    const catalogPriceId = uniqueGateStripeId('price')
    const periodStartSeconds = gateNowSecondsSinceEpoch()
    const before = await countGatePaymentsRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema,
    )

    async function deliverSubscriptionEvent(
      stripeEventType: string,
      subscriptionOptions: Parameters<typeof buildGateSubscriptionObject>[0],
    ): Promise<void> {
      const delivery = buildGateStripeWebhookDelivery(paymentsClient, {
        stripeEventType,
        eventDataObject: buildGateSubscriptionObject(subscriptionOptions),
      })
      const result = await paymentsEntry.handleStripeWebhook({
        paymentsClient,
        rawRequestBody: delivery.rawRequestBody,
        requestHeaders: delivery.requestHeaders,
      })
      handleStripeWebhookResultSchema.parse(result)
      expect(
        expectResultKind(result, 'payments-webhook-processed').webhookOutcome,
        stripeEventType,
      ).toBe('subscription-upserted')
    }

    await deliverSubscriptionEvent('customer.subscription.created', {
      stripeSubscriptionId,
      stripeCustomerId,
      subscriptionStatus: 'active',
      metadata: gateBillingReferenceMetadata(billingReferenceId),
      items: [catalogSubscriptionItem(subscriptionPriceName, catalogPriceId, periodStartSeconds)],
    })

    // The update carries two items and the first one is not ours, which is the case CONTRACT.md
    // names: the item this package reads is the first whose price.lookup_key names a catalog price,
    // not simply items.data[0].
    await deliverSubscriptionEvent('customer.subscription.updated', {
      stripeSubscriptionId,
      stripeCustomerId,
      subscriptionStatus: 'past_due',
      metadata: gateBillingReferenceMetadata(billingReferenceId),
      items: [
        {
          stripePriceId: uniqueGateStripeId('price'),
          priceLookupKey: 'gate-price-belonging-to-some-other-catalog',
          quantity: 9,
          currentPeriodStartSeconds: periodStartSeconds,
          currentPeriodEndSeconds: periodStartSeconds + thirtyDaysInSeconds,
        },
        catalogSubscriptionItem(subscriptionPriceName, catalogPriceId, periodStartSeconds, 5),
      ],
      cancelAtPeriodEnd: true,
    })

    const afterUpdate = expectResultKind(
      await paymentsEntry.readPaymentsSubscription({ paymentsClient, billingReferenceId }),
      'payments-subscription-found',
    ).paymentsSubscription
    expect(afterUpdate.status).toBe('past_due')
    expect(afterUpdate.cancelAtPeriodEnd).toBe(true)
    expect(String(afterUpdate.priceName)).toBe(subscriptionPriceName)
    expect(String(afterUpdate.stripePriceId)).toBe(catalogPriceId)
    expect(afterUpdate.quantity).toBe(5)

    const endedAtSeconds = periodStartSeconds + 60
    await deliverSubscriptionEvent('customer.subscription.deleted', {
      stripeSubscriptionId,
      stripeCustomerId,
      subscriptionStatus: 'canceled',
      metadata: gateBillingReferenceMetadata(billingReferenceId),
      items: [
        catalogSubscriptionItem(subscriptionPriceName, catalogPriceId, periodStartSeconds, 5),
      ],
      cancelAtPeriodEnd: false,
      canceledAtSeconds: endedAtSeconds,
      endedAtSeconds,
    })

    // The row is returned whatever its status: readPaymentsSubscription reports what Stripe last
    // said and the caller decides what counts as entitled.
    const afterDeletion = expectResultKind(
      await paymentsEntry.readPaymentsSubscription({ paymentsClient, billingReferenceId }),
      'payments-subscription-found',
    ).paymentsSubscription
    expect(afterDeletion.status).toBe('canceled')
    expect(afterDeletion.endedAt?.getTime()).toBe(
      gateDateFromStripeSeconds(endedAtSeconds).getTime(),
    )
    expect(afterDeletion.canceledAt?.getTime()).toBe(
      gateDateFromStripeSeconds(endedAtSeconds).getTime(),
    )
    expect([...paymentsActiveSubscriptionStatuses]).not.toContain(afterDeletion.status)

    // Three deliveries, one row: created, updated and deleted all upsert on the Stripe subscription id.
    const after = await countGatePaymentsRows(
      gateDatabase.drizzleClient,
      paymentsEntry.hearthkitPaymentsDrizzleSchema,
    )
    expect(after.payments_subscription - before.payments_subscription).toBe(1)

    // 'ended' and 'all' are members of SubscriptionListParams.Status, one union away from the real
    // one in the same file, and a status column holding either would be wrong in a way nothing else
    // would catch.
    expect([...paymentsKnownSubscriptionStatuses]).toContain('canceled')
    expect([...paymentsKnownSubscriptionStatuses]).not.toContain('ended')
    expect([...paymentsKnownSubscriptionStatuses]).not.toContain('all')
  })
})
