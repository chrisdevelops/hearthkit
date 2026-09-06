import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
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
  gatePaymentsCatalog,
  gatePaymentsEnv,
  uniqueGatePaymentsCatalogNames,
} from '../test-fixtures/payments-gate-values.ts'
import {
  loadHearthkitPaymentsEntry,
  type HearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import {
  createPaymentsClientResultSchema,
  type PaymentsCatalog,
  type PaymentsEnvValues,
} from './payments-contract.ts'

/**
 * createPaymentsClient contacts nothing: building a Stripe instance does no I/O and the Drizzle
 * client is lazy. So this whole file runs with no service anywhere, and the Drizzle client it uses
 * points at a closed port on purpose — if any gate here reached the database it would fail with
 * payments-database-unavailable rather than the answer it asserts.
 */

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  drizzleClient: NodePgDatabase<Record<string, unknown>>
  closeDatabaseClient: () => Promise<void>
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const { drizzleClient, closeDatabaseClient } = createGateDrizzleClientForUrl(
    unreachableGateDatabaseUrl,
    paymentsEntry.hearthkitPaymentsDrizzleSchema,
  )
  return { paymentsEntry, drizzleClient, closeDatabaseClient }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ closeDatabaseClient }) => closeDatabaseClient())
})

// Four problems in one catalog, which is the point: CONTRACT.md says catalogIssues names every
// problem in one pass, the way config reports every bad variable at once, because fixing a catalog
// one error per boot is miserable. `gate-shared-price` appears under two different products, which
// is the case a per-product uniqueness check would miss.
const catalogWithEveryProblem = {
  products: [
    {
      productName: 'gate-duplicated',
      displayName: 'Gate Duplicated',
      prices: [
        {
          priceName: 'gate-shared-price',
          currency: 'usd',
          unitAmountMinorUnits: 1900,
          priceKind: 'subscription',
          recurringInterval: 'month',
        },
      ],
    },
    {
      productName: 'gate-duplicated',
      displayName: 'Gate Duplicated Again',
      prices: [
        {
          priceName: 'gate-other-price',
          currency: 'usd',
          unitAmountMinorUnits: 500,
          priceKind: 'one-time',
        },
      ],
    },
    {
      productName: 'gate-third',
      displayName: 'Gate Third',
      prices: [
        {
          priceName: 'gate-shared-price',
          currency: 'usd',
          unitAmountMinorUnits: 2900,
          priceKind: 'one-time',
        },
      ],
    },
    { productName: 'gate-empty', displayName: 'Gate Empty', prices: [] },
    {
      productName: 'Gate Invalid Name',
      displayName: 'Gate Invalid',
      prices: [
        {
          priceName: 'gate-invalid-price',
          currency: 'USD',
          unitAmountMinorUnits: 19.5,
          priceKind: 'one-time',
        },
      ],
    },
  ],
}

describe('createPaymentsClient', () => {
  it('builds a client in both scaffold modes and echoes the flag back with the billing scope it decided', async () => {
    const { paymentsEntry, drizzleClient } = await gateFile.read()
    const paymentsCatalog = gatePaymentsCatalog(uniqueGatePaymentsCatalogNames('client'))

    const userScoped = paymentsEntry.createPaymentsClient({
      ...gatePaymentsEnv(),
      drizzleClient,
      paymentsCatalog,
      organizationsEnabled: false,
    })
    // Not run through expectValueCarriesNoSecret: the client handle is the one value CONTRACT.md
    // allows to carry the webhook secret, because carrying it to handleStripeWebhook is its job.
    createPaymentsClientResultSchema.parse(userScoped)
    const userMode = expectResultKind(userScoped, 'payments-client-created')
    expect(userMode.organizationsEnabled).toBe(false)
    expect(userMode.billingScope).toBe('user')
    expect(userMode.paymentsClient.billingScope).toBe('user')
    // The client carries the validated catalog, which is what makes the price lookup a local map
    // read needing no network at all.
    expect(
      sortedGateNames(userMode.paymentsClient.paymentsCatalog.products.map((p) => p.productName)),
    ).toEqual(sortedGateNames(paymentsCatalog.products.map((product) => product.productName)))

    const orgScoped = paymentsEntry.createPaymentsClient({
      ...gatePaymentsEnv(),
      drizzleClient,
      paymentsCatalog,
      organizationsEnabled: true,
    })
    createPaymentsClientResultSchema.parse(orgScoped)
    const orgMode = expectResultKind(orgScoped, 'payments-client-created')
    expect(orgMode.organizationsEnabled).toBe(true)
    // The flag decides this one value and nothing else. It never decides which tables exist, for the
    // same reason auth defines the organization tables in both modes: changing the flag later
    // re-homes existing rows, which is a data migration.
    expect(orgMode.billingScope).toBe('organization')
    expect(orgMode.paymentsClient.billingScope).toBe('organization')
  })

  it('reports every catalog problem in one pass, and reports catalog-has-no-products for an empty catalog', async () => {
    const { paymentsEntry, drizzleClient } = await gateFile.read()

    const result = paymentsEntry.createPaymentsClient({
      ...gatePaymentsEnv(),
      drizzleClient,
      // Deliberately not parsed through paymentsCatalogSchema: the whole point of this gate is a
      // catalog an app got wrong, which the schema would refuse to build.
      paymentsCatalog: catalogWithEveryProblem as unknown as PaymentsCatalog,
      organizationsEnabled: false,
    })
    const failure = expectPaymentsFailure(result, 'payments-catalog-invalid')

    expect(
      sortedGateNames([...new Set(failure.catalogIssues.map((issue) => issue.catalogIssueKind))]),
    ).toEqual(
      sortedGateNames([
        'duplicate-price-name',
        'duplicate-product-name',
        'entry-invalid',
        'product-has-no-prices',
      ]),
    )
    for (const issue of failure.catalogIssues) {
      expect(issue.catalogIssueReason.length).toBeGreaterThan(0)
    }
    // The reason states the rule that was broken, never the value, matching payments-input-invalid's
    // discipline. A catalog is app source rather than user input, but the rule is the same one.
    const everyReason = failure.catalogIssues.map((issue) => issue.catalogIssueReason).join(' ')
    expect(everyReason).not.toContain('19.5')

    const emptyCatalog = paymentsEntry.createPaymentsClient({
      ...gatePaymentsEnv(),
      drizzleClient,
      paymentsCatalog: { products: [] } as unknown as PaymentsCatalog,
      organizationsEnabled: false,
    })
    const emptyFailure = expectPaymentsFailure(emptyCatalog, 'payments-catalog-invalid')
    expect(emptyFailure.catalogIssues.map((issue) => issue.catalogIssueKind)).toContain(
      'catalog-has-no-products',
    )
  })

  it('rejects a Stripe API base URL, an environment object and a Drizzle client it cannot use, naming the field', async () => {
    const { paymentsEntry, drizzleClient } = await gateFile.read()
    const paymentsCatalog = gatePaymentsCatalog(uniqueGatePaymentsCatalogNames('badinput'))

    const badBaseUrl = paymentsEntry.createPaymentsClient({
      ...gatePaymentsEnv(),
      drizzleClient,
      paymentsCatalog,
      organizationsEnabled: false,
      // Absolute http(s) only: it overrides the Stripe API host, port and protocol, and a relative
      // value would silently point the SDK at nothing.
      stripeApiBaseUrl: 'api.stripe.test/v1',
    })
    expect(expectPaymentsFailure(badBaseUrl, 'payments-input-invalid').invalidFieldName).toBe(
      'stripe-api-base-url',
    )

    const badEnv = paymentsEntry.createPaymentsClient({
      paymentsEnv: { STRIPE_SECRET_KEY: '' } as unknown as PaymentsEnvValues,
      drizzleClient,
      paymentsCatalog,
      organizationsEnabled: false,
    })
    expect(expectPaymentsFailure(badEnv, 'payments-input-invalid').invalidFieldName).toBe(
      'payments-env',
    )

    const badDrizzleClient = paymentsEntry.createPaymentsClient({
      ...gatePaymentsEnv(),
      drizzleClient: undefined as unknown as NodePgDatabase<Record<string, unknown>>,
      paymentsCatalog,
      organizationsEnabled: false,
    })
    expect(expectPaymentsFailure(badDrizzleClient, 'payments-input-invalid').invalidFieldName).toBe(
      'drizzle-client',
    )
  })
})
