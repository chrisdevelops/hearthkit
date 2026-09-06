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
  readGateStripeCheckoutSession,
} from '../test-fixtures/payments-gate-stripe-account.ts'
import {
  deadStripeApiBaseUrl,
  gateCancelUrl,
  gatePaymentsCatalog,
  gateStripeSecretKey,
  gateSuccessUrl,
  gateSuccessUrlWithCheckoutSessionPlaceholder,
  hasGateStripeSecretKey,
  reserveDeadLoopbackPort,
  uniqueGateBillingContactEmail,
  uniqueGateBillingReferenceId,
  uniqueGatePaymentsCatalogNames,
  type GatePaymentsCatalogNames,
} from '../test-fixtures/payments-gate-values.ts'
import {
  createGatePaymentsClient,
  loadHearthkitPaymentsEntry,
  type HearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import {
  createCheckoutSessionResultSchema,
  stripeOneTimeCheckoutMode,
  stripeSubscriptionCheckoutMode,
  type PaymentsClient,
  type PaymentsSyncedPrice,
} from './payments-contract.ts'

/**
 * The catalog half of the price lookup is a local map read and needs no network at all, so it is
 * gated offline; the Stripe half needs a real test-mode account. Neither asks Stripe to tell us the
 * price is missing: the Stripe arm is an empty prices.list result, which is a 200 with no data rather
 * than an error, so depending on an API error code was never necessary.
 */

const createdStripeCustomerIds: string[] = []

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  gateDatabase: GatePaymentsDatabase
  offlineClient: PaymentsClient
  catalogNames: GatePaymentsCatalogNames
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const gateDatabase = await createVerifiedGatePaymentsDatabase('checkout', paymentsEntry)
  const catalogNames = uniqueGatePaymentsCatalogNames('checkout')
  const offlineClient = createGatePaymentsClient({
    paymentsEntry,
    drizzleClient: gateDatabase.drizzleClient,
    paymentsCatalog: gatePaymentsCatalog(catalogNames),
    stripeApiBaseUrl: deadStripeApiBaseUrl(await reserveDeadLoopbackPort()),
  })
  return { paymentsEntry, gateDatabase, offlineClient, catalogNames }
})

/**
 * The live account, with the catalog pushed to it once and the test-mode guard asserted on the very
 * first object that came back. Everything else in this file that touches Stripe reads this, so
 * nothing is created after a live key is detected.
 */
const liveGateFile = defineGateFileContext<{
  liveClient: PaymentsClient
  syncedPrices: readonly PaymentsSyncedPrice[]
}>(async () => {
  const { paymentsEntry, gateDatabase, catalogNames } = await gateFile.read()
  const liveClient = createGatePaymentsClient({
    paymentsEntry,
    drizzleClient: gateDatabase.drizzleClient,
    paymentsCatalog: gatePaymentsCatalog(catalogNames),
    stripeSecretKey: gateStripeSecretKey,
  })
  const synced = expectResultKind(
    await paymentsEntry.syncPaymentsCatalog({ paymentsClient: liveClient }),
    'payments-catalog-synced',
  )
  assertGateStripeIsTestMode(synced.stripeLivemode)
  return { liveClient, syncedPrices: synced.syncedPrices }
})

afterAll(async () => {
  await liveGateFile.releaseIfCreated(async ({ liveClient, syncedPrices }) => {
    for (const stripeCustomerId of createdStripeCustomerIds) {
      await deleteGateStripeCustomer(liveClient, stripeCustomerId)
    }
    await archiveGateStripeCatalog(liveClient, syncedPrices)
  })
  await gateFile.releaseIfCreated(({ gateDatabase }) => gateDatabase.removeGatePaymentsDatabase())
})

describe('createCheckoutSession', () => {
  it('reports payments-price-not-found with absent-from-catalog for a name the catalog does not have, contacting Stripe never', async () => {
    const { paymentsEntry, offlineClient } = await gateFile.read()
    const priceName = 'gate-price-no-catalog-ever-had'

    // The client's Stripe API base URL is a closed local port, so a lookup that reached the network
    // would answer payments-stripe-unreachable. absent-from-catalog is decided before that: it is a
    // code mistake, and the operator's next step is to fix payments-catalog.ts rather than run sync.
    const result = await paymentsEntry.createCheckoutSession({
      paymentsClient: offlineClient,
      billingReferenceId: uniqueGateBillingReferenceId('checkout-nocatalog'),
      billingContactEmail: uniqueGateBillingContactEmail('checkout-nocatalog'),
      priceName,
      successUrl: gateSuccessUrl,
      cancelUrl: gateCancelUrl,
    })
    createCheckoutSessionResultSchema.parse(result)
    const failure = expectPaymentsFailure(result, 'payments-price-not-found')
    expect(failure.priceLookupFailure).toBe('absent-from-catalog')
    expect(failure.priceName).toBe(priceName)
  })

  it('accepts a success URL carrying Stripe placeholder braces rather than rejecting it as an invalid URL', async () => {
    const { paymentsEntry, offlineClient, catalogNames } = await gateFile.read()

    // CONTRACT.md lists "whether z.url() at zod@4.4.3 accepts a URL containing {CHECKOUT_SESSION_ID}"
    // under Still not verified. If the schema rejects it this comes back payments-input-invalid
    // naming success-url, and the schema has to loosen to a protocol-and-authority check. Reaching
    // the closed Stripe port instead is what proves validation let the placeholder through.
    const result = await paymentsEntry.createCheckoutSession({
      paymentsClient: offlineClient,
      billingReferenceId: uniqueGateBillingReferenceId('checkout-placeholder'),
      billingContactEmail: uniqueGateBillingContactEmail('checkout-placeholder'),
      priceName: catalogNames.subscriptionPriceName,
      successUrl: gateSuccessUrlWithCheckoutSessionPlaceholder,
      cancelUrl: gateCancelUrl,
    })
    createCheckoutSessionResultSchema.parse(result)
    expect(result.kind).not.toBe('payments-input-invalid')
    expectPaymentsFailure(result, 'payments-stripe-unreachable')
  })

  it.skipIf(!hasGateStripeSecretKey)(
    'creates a hosted checkout session for a subscription price in test mode, handing the success URL to Stripe byte for byte',
    async () => {
      const { paymentsEntry, catalogNames } = await gateFile.read()
      const { liveClient } = await liveGateFile.read()

      const result = await paymentsEntry.createCheckoutSession({
        paymentsClient: liveClient,
        billingReferenceId: uniqueGateBillingReferenceId('checkout-live'),
        billingContactEmail: uniqueGateBillingContactEmail('checkout-live'),
        priceName: catalogNames.subscriptionPriceName,
        quantity: 2,
        successUrl: gateSuccessUrlWithCheckoutSessionPlaceholder,
        cancelUrl: gateCancelUrl,
      })
      createCheckoutSessionResultSchema.parse(result)
      const created = expectResultKind(result, 'payments-checkout-session-created')
      createdStripeCustomerIds.push(String(created.stripeCustomerId))

      // Read off the object Stripe answered with, which is a measurement rather than a match on an
      // API key prefix.
      expect(created.stripeLivemode).toBe(false)
      expect(String(created.priceName)).toBe(catalogNames.subscriptionPriceName)
      // Stripe types Session.url as `string | null` because it is only present while a hosted
      // session is active; this package always creates hosted sessions, so a null there is not a
      // contract state and would have come back as payments-request-failed instead.
      expect(created.checkoutUrl.startsWith('https://')).toBe(true)

      const storedSession = await readGateStripeCheckoutSession(
        liveClient,
        String(created.stripeCheckoutSessionId),
      )
      // A subscription price maps to checkout mode `subscription`, which happens to be the same word
      // this package uses; the one-time case below is where the spellings diverge.
      expect(storedSession.mode).toBe(stripeSubscriptionCheckoutMode)
      // The URL is handed over unchanged, never round-tripped through `new URL(value).href`, which
      // percent-encodes the braces and turns Stripe's placeholder into literal text it never
      // substitutes. The symptom would be a success page receiving %7BCHECKOUT_SESSION_ID%7D.
      expect(storedSession.success_url).toBe(gateSuccessUrlWithCheckoutSessionPlaceholder)
    },
  )

  it.skipIf(!hasGateStripeSecretKey)(
    'reuses the Stripe customer already on file when the same reference buys again, this time a one-time price',
    async () => {
      const { paymentsEntry, catalogNames } = await gateFile.read()
      const { liveClient } = await liveGateFile.read()
      const billingReferenceId = uniqueGateBillingReferenceId('checkout-reuse')
      const billingContactEmail = uniqueGateBillingContactEmail('checkout-reuse')

      const first = expectResultKind(
        await paymentsEntry.createCheckoutSession({
          paymentsClient: liveClient,
          billingReferenceId,
          billingContactEmail,
          priceName: catalogNames.subscriptionPriceName,
          successUrl: gateSuccessUrl,
          cancelUrl: gateCancelUrl,
        }),
        'payments-checkout-session-created',
      )
      createdStripeCustomerIds.push(String(first.stripeCustomerId))

      const second = expectResultKind(
        await paymentsEntry.createCheckoutSession({
          paymentsClient: liveClient,
          billingReferenceId,
          billingContactEmail,
          priceName: catalogNames.oneTimePriceName,
          successUrl: gateSuccessUrl,
          cancelUrl: gateCancelUrl,
        }),
        'payments-checkout-session-created',
      )

      // One Stripe customer per billing reference. A second customer here would orphan the first
      // one's payment methods and split one person's billing history in two.
      expect(String(second.stripeCustomerId)).toBe(String(first.stripeCustomerId))
      expect(String(second.priceName)).toBe(catalogNames.oneTimePriceName)

      const storedSession = await readGateStripeCheckoutSession(
        liveClient,
        String(second.stripeCheckoutSessionId),
      )
      // Note the spelling: a one-time price is Stripe price type `one_time` with an underscore, but
      // its checkout mode is `payment`. Three names for one idea, and all three are real.
      expect(storedSession.mode).toBe(stripeOneTimeCheckoutMode)
    },
  )

  it.skipIf(!hasGateStripeSecretKey)(
    'reports payments-price-not-found with absent-from-stripe when the catalog has the price but sync has never run for it',
    async () => {
      const { paymentsEntry, gateDatabase } = await gateFile.read()
      // A catalog whose names have never been pushed anywhere. Every name a gate run makes up is
      // unique, so nothing in the shared test-mode account can be carrying this lookup key.
      const unsyncedNames = uniqueGatePaymentsCatalogNames('checkoutunsynced')
      const unsyncedClient = createGatePaymentsClient({
        paymentsEntry,
        drizzleClient: gateDatabase.drizzleClient,
        paymentsCatalog: gatePaymentsCatalog(unsyncedNames),
        stripeSecretKey: gateStripeSecretKey,
      })

      const result = await paymentsEntry.createCheckoutSession({
        paymentsClient: unsyncedClient,
        billingReferenceId: uniqueGateBillingReferenceId('checkout-unsynced'),
        billingContactEmail: uniqueGateBillingContactEmail('checkout-unsynced'),
        priceName: unsyncedNames.subscriptionPriceName,
        successUrl: gateSuccessUrl,
        cancelUrl: gateCancelUrl,
      })
      createCheckoutSessionResultSchema.parse(result)
      const failure = expectPaymentsFailure(result, 'payments-price-not-found')
      // The other half of the same variant. The caller does the same thing with both — tell the
      // buyer this plan is unavailable — and only the operator's next step differs, which here is
      // to run hearthkit payments sync against this account.
      expect(failure.priceLookupFailure).toBe('absent-from-stripe')
      expect(failure.priceName).toBe(unsyncedNames.subscriptionPriceName)
    },
  )
})
