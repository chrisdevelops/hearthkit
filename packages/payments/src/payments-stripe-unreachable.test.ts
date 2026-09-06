import { afterAll, describe, expect, it } from 'vitest'
import { expectPaymentsFailure } from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  createVerifiedGatePaymentsDatabase,
  type GatePaymentsDatabase,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  deadStripeApiBaseUrl,
  gateCancelUrl,
  gatePaymentsCatalog,
  gateSuccessUrl,
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
  createCheckoutSessionResultSchema,
  syncPaymentsCatalogResultSchema,
  type PaymentsClient,
} from './payments-contract.ts'

/**
 * The failure CONTRACT.md Decision 5 keeps stripeApiBaseUrl for. Pointed at a closed local port it
 * produces payments-stripe-unreachable with no network and no Stripe account, which is what makes
 * this the sibling of db's database-server-unreachable rather than a failure nobody can gate.
 *
 * The database here is real and migrated, so a checkout that writes a customer row before reaching
 * Stripe still gets that far: the only thing that cannot be reached is Stripe.
 */

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  paymentsClient: PaymentsClient
  gateDatabase: GatePaymentsDatabase
  subscriptionPriceName: string
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const gateDatabase = await createVerifiedGatePaymentsDatabase('unreachable', paymentsEntry)
  const catalogNames = uniqueGatePaymentsCatalogNames('unreachable')
  const paymentsClient = createGatePaymentsClient({
    paymentsEntry,
    drizzleClient: gateDatabase.drizzleClient,
    paymentsCatalog: gatePaymentsCatalog(catalogNames),
    stripeApiBaseUrl: deadStripeApiBaseUrl(await reserveDeadLoopbackPort()),
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

describe('payments-stripe-unreachable', () => {
  it('reports it from sync and from checkout when the Stripe API base URL is a closed local port', async () => {
    const { paymentsEntry, paymentsClient, subscriptionPriceName } = await gateFile.read()

    const synced = await paymentsEntry.syncPaymentsCatalog({ paymentsClient })
    syncPaymentsCatalogResultSchema.parse(synced)
    const syncFailure = expectPaymentsFailure(synced, 'payments-stripe-unreachable')
    // Deliberately not asserting a retry count: the SDK retries a closed connection once even when
    // retries are disabled, so "Request was retried 1 times." is a legal part of this message.
    expect(syncFailure.stripeFailureDetail.length).toBeGreaterThan(0)

    // The same classification from a different producer, with a price name the catalog really has,
    // so the call gets past the local map lookup and out to the network before it fails.
    const checkout = await paymentsEntry.createCheckoutSession({
      paymentsClient,
      billingReferenceId: uniqueGateBillingReferenceId('unreachable'),
      billingContactEmail: uniqueGateBillingContactEmail('unreachable'),
      priceName: subscriptionPriceName,
      successUrl: gateSuccessUrl,
      cancelUrl: gateCancelUrl,
    })
    createCheckoutSessionResultSchema.parse(checkout)
    expect(
      expectPaymentsFailure(checkout, 'payments-stripe-unreachable').stripeFailureDetail.length,
    ).toBeGreaterThan(0)
  })
})
