import { afterAll, describe, expect, it } from 'vitest'
import {
  expectPaymentsFailure,
  expectResultKind,
  sortedGateNames,
} from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  createGateDrizzleClientForUrl,
  unreachableGateDatabaseUrl,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  archiveGateStripeCatalog,
  assertGateStripeIsTestMode,
} from '../test-fixtures/payments-gate-stripe-account.ts'
import {
  gatePaymentsCatalog,
  gateStripeSecretKey,
  gateWrongStripeSecretKey,
  hasGateStripeSecretKey,
  uniqueGatePaymentsCatalogNames,
  type GatePaymentsCatalogNames,
} from '../test-fixtures/payments-gate-values.ts'
import {
  createGatePaymentsClient,
  loadHearthkitPaymentsEntry,
  type HearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import {
  stripeForbiddenHttpStatus,
  stripeUnauthorizedHttpStatus,
  syncPaymentsCatalogResultSchema,
  type PaymentsClient,
  type PaymentsSyncedPrice,
} from './payments-contract.ts'

/**
 * All of syncPaymentsCatalog is live: it is the one function whose whole job is to change a Stripe
 * account, and nothing offline can stand in for that. It also settles the one thing CONTRACT.md lists
 * under Still not verified that everything else in sync depends on — whether Stripe accepts a
 * lowercase kebab-case custom product id, which is what makes sync idempotent without a search call.
 *
 * No database is needed here at all, so the Drizzle client points at a closed port: sync writes
 * nothing locally, and a sync that queried would fail these gates rather than pass them.
 */

const createdStripePrices: PaymentsSyncedPrice[] = []

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  catalogNames: GatePaymentsCatalogNames
  buildLiveClient: (unitAmountMinorUnits?: number, stripeSecretKey?: string) => PaymentsClient
  closeDatabaseClient: () => Promise<void>
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const { drizzleClient, closeDatabaseClient } = createGateDrizzleClientForUrl(
    unreachableGateDatabaseUrl,
    paymentsEntry.hearthkitPaymentsDrizzleSchema,
  )
  const catalogNames = uniqueGatePaymentsCatalogNames('sync')
  return {
    paymentsEntry,
    catalogNames,
    buildLiveClient: (unitAmountMinorUnits, stripeSecretKey = gateStripeSecretKey) =>
      createGatePaymentsClient({
        paymentsEntry,
        drizzleClient,
        paymentsCatalog: gatePaymentsCatalog(catalogNames, unitAmountMinorUnits),
        stripeSecretKey,
      }),
    closeDatabaseClient,
  }
})

/**
 * The first sync of this run's catalog, with the test-mode guard asserted on the object Stripe
 * answered with before anything else is created. Every live gate below reads this, so the guard runs
 * once and holds for all of them however the file is ordered.
 */
const liveGateFile = defineGateFileContext<{
  liveClient: PaymentsClient
  firstSyncedPrices: readonly PaymentsSyncedPrice[]
}>(async () => {
  const { paymentsEntry, buildLiveClient } = await gateFile.read()
  const liveClient = buildLiveClient()
  const synced = expectResultKind(
    await paymentsEntry.syncPaymentsCatalog({ paymentsClient: liveClient }),
    'payments-catalog-synced',
  )
  assertGateStripeIsTestMode(synced.stripeLivemode)
  createdStripePrices.push(...synced.syncedPrices)
  return { liveClient, firstSyncedPrices: synced.syncedPrices }
})

afterAll(async () => {
  await liveGateFile.releaseIfCreated(({ liveClient }) =>
    archiveGateStripeCatalog(liveClient, createdStripePrices),
  )
  await gateFile.releaseIfCreated(({ closeDatabaseClient }) => closeDatabaseClient())
})

describe('syncPaymentsCatalog', () => {
  it.skipIf(!hasGateStripeSecretKey)(
    'creates a Stripe price for every catalog price on a first run, under a product whose id is the catalog product name',
    async () => {
      const { catalogNames } = await gateFile.read()
      const { firstSyncedPrices } = await liveGateFile.read()

      syncPaymentsCatalogResultSchema.parse({
        kind: 'payments-catalog-synced',
        syncedPrices: firstSyncedPrices,
        stripeLivemode: false,
      })
      expect(sortedGateNames(firstSyncedPrices.map((price) => price.priceName))).toEqual(
        sortedGateNames([catalogNames.subscriptionPriceName, catalogNames.oneTimePriceName]),
      )
      for (const syncedPrice of firstSyncedPrices) {
        expect(syncedPrice.syncAction).toBe('created')
        // The measurement CONTRACT.md says everything else in sync depends on: products.create
        // accepts a caller-supplied id, and this asserts Stripe really accepts this id SHAPE. If it
        // does not, sync needs a different identity mechanism and the contract comes back for a line.
        expect(String(syncedPrice.stripeProductId)).toBe(catalogNames.productName)
        expect(String(syncedPrice.stripePriceId).length).toBeGreaterThan(0)
      }
    },
  )

  it.skipIf(!hasGateStripeSecretKey)(
    'reports every price unchanged on a second run of the same catalog, reusing the product rather than duplicating it',
    async () => {
      const { paymentsEntry } = await gateFile.read()
      const { liveClient, firstSyncedPrices } = await liveGateFile.read()

      const result = await paymentsEntry.syncPaymentsCatalog({ paymentsClient: liveClient })
      syncPaymentsCatalogResultSchema.parse(result)
      const synced = expectResultKind(result, 'payments-catalog-synced')
      expect(synced.stripeLivemode).toBe(false)

      // Idempotent means every price reports unchanged, and it means the product id was supplied
      // rather than searched for: a second products.create on an id that already exists must not
      // become a second product or a resource_already_exists failure.
      for (const syncedPrice of synced.syncedPrices) {
        expect(syncedPrice.syncAction).toBe('unchanged')
      }
      const firstPriceIdByName = new Map(
        firstSyncedPrices.map((price) => [String(price.priceName), String(price.stripePriceId)]),
      )
      for (const syncedPrice of synced.syncedPrices) {
        expect(String(syncedPrice.stripePriceId)).toBe(
          firstPriceIdByName.get(String(syncedPrice.priceName)),
        )
      }
    },
  )

  it.skipIf(!hasGateStripeSecretKey)(
    'replaces a price whose amount changed, moving the lookup key onto a new Stripe price id',
    async () => {
      const { paymentsEntry, buildLiveClient } = await gateFile.read()
      const { firstSyncedPrices } = await liveGateFile.read()

      // Stripe prices are immutable in amount and currency, so the same lookup key at a new amount
      // cannot be an update: a new price is created with transfer_lookup_key and the superseded one
      // is archived. Existing subscriptions stay on the old price, which is Stripe's behaviour and
      // not something this package migrates.
      const repricedClient = buildLiveClient(2900)
      const result = await paymentsEntry.syncPaymentsCatalog({ paymentsClient: repricedClient })
      syncPaymentsCatalogResultSchema.parse(result)
      const synced = expectResultKind(result, 'payments-catalog-synced')
      createdStripePrices.push(...synced.syncedPrices)

      const firstPriceIdByName = new Map(
        firstSyncedPrices.map((price) => [String(price.priceName), String(price.stripePriceId)]),
      )
      for (const syncedPrice of synced.syncedPrices) {
        expect(syncedPrice.syncAction, String(syncedPrice.priceName)).toBe('replaced')
        // Nothing stores a Stripe price id as an identity, precisely because this happens. The
        // catalog keys on the lookup key instead, which is stable across a replacement.
        expect(String(syncedPrice.stripePriceId)).not.toBe(
          firstPriceIdByName.get(String(syncedPrice.priceName)),
        )
      }
    },
  )

  it.skipIf(!hasGateStripeSecretKey)(
    'reports payments-stripe-unauthorized when Stripe refuses the API key, without echoing the key back',
    async () => {
      const { paymentsEntry, buildLiveClient } = await gateFile.read()
      // A well-formed value that is not a key any account issued. This is the first-run state of
      // every project that pasted the wrong key, and without a name it would arrive as an opaque
      // catch-all in the one package that is holding somebody's money.
      const wrongKeyClient = buildLiveClient(undefined, gateWrongStripeSecretKey)

      const result = await paymentsEntry.syncPaymentsCatalog({ paymentsClient: wrongKeyClient })
      syncPaymentsCatalogResultSchema.parse(result)
      const failure = expectPaymentsFailure(result, 'payments-stripe-unauthorized')

      // 401 is a wrong or revoked key and 403 is a restricted key without the permission. One
      // variant, because the caller does the same thing with both; stripeErrorStatus is carried so
      // a reader sees which. CONTRACT.md lists which one Stripe actually answers with as unmeasured.
      expect([stripeUnauthorizedHttpStatus, stripeForbiddenHttpStatus]).toContain(
        failure.stripeErrorStatus,
      )
      expect(failure.stripeFailureDetail.length).toBeGreaterThan(0)
    },
  )
})
