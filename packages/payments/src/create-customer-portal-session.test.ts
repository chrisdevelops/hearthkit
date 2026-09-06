import { afterAll, describe, expect, it } from 'vitest'
import {
  expectPaymentsFailure,
  expectResultKind,
} from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  createVerifiedGatePaymentsDatabase,
  type GatePaymentsDatabase,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  archiveGateStripeCatalog,
  assertGateStripeIsTestMode,
  deleteGateStripeCustomer,
} from '../test-fixtures/payments-gate-stripe-account.ts'
import {
  deadStripeApiBaseUrl,
  gateCancelUrl,
  gatePaymentsCatalog,
  gateReturnUrl,
  gateStripeSecretKey,
  gateSuccessUrl,
  hasGateStripeSecretKey,
  reserveDeadLoopbackPort,
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
  createCustomerPortalSessionResultSchema,
  type PaymentsClient,
  type PaymentsSyncedPrice,
} from './payments-contract.ts'

/**
 * createCustomerPortalSession never creates anything — opening a billing portal for a person who has
 * never paid is not a thing to do quietly — so it is the only producer of
 * payments-customer-not-found. That half needs no Stripe key. Opening a real portal does.
 */

const createdStripePrices: PaymentsSyncedPrice[] = []
const createdStripeCustomerIds: string[] = []

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  gateDatabase: GatePaymentsDatabase
  offlineClient: PaymentsClient
  liveClient: PaymentsClient | undefined
  subscriptionPriceName: string
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const gateDatabase = await createVerifiedGatePaymentsDatabase('portal', paymentsEntry)
  const catalogNames = uniqueGatePaymentsCatalogNames('portal')
  const paymentsCatalog = gatePaymentsCatalog(catalogNames)
  const offlineClient = createGatePaymentsClient({
    paymentsEntry,
    drizzleClient: gateDatabase.drizzleClient,
    paymentsCatalog,
    stripeApiBaseUrl: deadStripeApiBaseUrl(await reserveDeadLoopbackPort()),
  })
  const liveClient = hasGateStripeSecretKey
    ? createGatePaymentsClient({
        paymentsEntry,
        drizzleClient: gateDatabase.drizzleClient,
        paymentsCatalog,
        stripeSecretKey: gateStripeSecretKey,
      })
    : undefined
  return {
    paymentsEntry,
    gateDatabase,
    offlineClient,
    liveClient,
    subscriptionPriceName: catalogNames.subscriptionPriceName,
  }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(async ({ gateDatabase, liveClient }) => {
    if (liveClient !== undefined) {
      for (const stripeCustomerId of createdStripeCustomerIds) {
        await deleteGateStripeCustomer(liveClient, stripeCustomerId)
      }
      await archiveGateStripeCatalog(liveClient, createdStripePrices)
    }
    await gateDatabase.removeGatePaymentsDatabase()
  })
})

describe('createCustomerPortalSession', () => {
  it('reports payments-customer-not-found for a reference with no customer row, without contacting Stripe', async () => {
    const { paymentsEntry, offlineClient } = await gateFile.read()
    const billingReferenceId = uniqueGateBillingReferenceId('portal-none')

    // The client's Stripe API base URL is a closed local port, so a call that asked Stripe about the
    // customer would answer payments-stripe-unreachable. This failure is an empty query result
    // instead: no API-level error code is consulted, which is what makes it deterministic offline.
    const result = await paymentsEntry.createCustomerPortalSession({
      paymentsClient: offlineClient,
      billingReferenceId,
      returnUrl: gateReturnUrl,
    })
    createCustomerPortalSessionResultSchema.parse(result)
    const failure = expectPaymentsFailure(result, 'payments-customer-not-found')
    expect(String(failure.billingReferenceId)).toBe(billingReferenceId)
  })

  it.skipIf(!hasGateStripeSecretKey)(
    'opens the hosted billing portal for a customer a checkout put on file',
    async () => {
      const { paymentsEntry, liveClient, subscriptionPriceName } = await gateFile.read()
      expect(liveClient, 'this gate runs only with STRIPE_SECRET_KEY set').toBeDefined()
      if (liveClient === undefined) {
        return
      }

      const synced = expectResultKind(
        await paymentsEntry.syncPaymentsCatalog({ paymentsClient: liveClient }),
        'payments-catalog-synced',
      )
      createdStripePrices.push(...synced.syncedPrices)
      assertGateStripeIsTestMode(synced.stripeLivemode)

      const billingReferenceId = uniqueGateBillingReferenceId('portal-live')
      const checkout = expectResultKind(
        await paymentsEntry.createCheckoutSession({
          paymentsClient: liveClient,
          billingReferenceId,
          billingContactEmail: uniqueGateBillingContactEmail('portal-live'),
          priceName: subscriptionPriceName,
          successUrl: gateSuccessUrl,
          cancelUrl: gateCancelUrl,
        }),
        'payments-checkout-session-created',
      )
      createdStripeCustomerIds.push(String(checkout.stripeCustomerId))

      // If this fails with a Stripe error about a portal configuration, the test-mode account needs
      // its billing portal settings saved once in the Stripe dashboard. CONTRACT.md flags that under
      // Still not verified precisely so the failure does not read as a bug in this package.
      const result = await paymentsEntry.createCustomerPortalSession({
        paymentsClient: liveClient,
        billingReferenceId,
        returnUrl: gateReturnUrl,
      })
      createCustomerPortalSessionResultSchema.parse(result)
      const opened = expectResultKind(result, 'payments-portal-session-created')

      // BillingPortal.Session.url is typed non-nullable, so unlike checkoutUrl there is no null case.
      expect(opened.portalUrl.startsWith('https://')).toBe(true)
      // The customer already on file, not a second one: this call never creates anything.
      expect(String(opened.stripeCustomerId)).toBe(String(checkout.stripeCustomerId))
    },
  )
})
