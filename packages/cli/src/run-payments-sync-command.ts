import { createDrizzleClient, postgresConnectionStringSchema } from '@hearthkit/db'
import type { PaymentsCatalog, PaymentsEnvValues } from '@hearthkit/payments/payments-contract'
import { z } from 'zod'
import { stripeSecretKeyEnvVariableName, type CliCommandResult } from './cli-contract.ts'
import {
  paymentsCatalogNotFoundFailure,
  paymentsCatalogUnloadableFailure,
  paymentsSyncFailedFailure,
} from './cli-failure-results.ts'
import type { CliRuntimeContext } from './cli-runtime-context.ts'
import { loadPaymentsCatalogModule } from './load-payments-catalog-module.ts'
import { readEnvironmentVariableValue } from './read-environment-variable-value.ts'

/**
 * hearthkit payments sync: resolve the catalog file, hand it to @hearthkit/payments, map the result.
 *
 * The file checks come first so a project with no catalog fails without a Stripe key. Everything
 * after that belongs to payments: the catalog value is passed on unvalidated, and a missing
 * STRIPE_SECRET_KEY is not a CLI failure kind — it arrives as the payments env failure, wrapped.
 *
 * @hearthkit/payments is imported inside the function rather than at the top of the file, so the one
 * command that syncs a catalog is the only one that pays for loading the Stripe SDK. Every other
 * command, and the bin's own startup, stays free of it.
 */

// Sync verifies no signature, runs no query and writes no customer row, so the CLI supplies the rest
// of the payments client itself rather than asking the operator for it: a placeholder webhook secret,
// a Drizzle client aimed at a port nothing listens on, and organizationsEnabled false. A sync that
// ever grew a query would report a wrapped payments-database-unavailable rather than touch a real
// database, which is the direction this is meant to fail in.
/** Webhook secret handed to createPaymentsClient because its env fragment requires one; sync never verifies a signature. */
const unusedWebhookSecretPlaceholder = 'hearthkit-cli-payments-sync-unused-webhook-secret'

/** Connection string the throwaway Drizzle client points at; a pool opens no connection until a query runs, and sync runs none. */
const unusedProjectDatabaseUrl = postgresConnectionStringSchema.parse(
  'postgresql://hearthkit:hearthkit@127.0.0.1:1/hearthkit-cli-payments-sync-unused',
)

// Both of these pass a value straight through with the type @hearthkit/payments declares and no check
// of their own. That is the contract: createPaymentsClient is what validates a catalog and an env
// object, so a bad catalog comes back as payments-catalog-invalid and an unset key as
// payments-input-invalid with payments-env, rather than as a second opinion formed here.
/** Passes the catalog module's export through unvalidated, because createPaymentsClient validates it. */
const unvalidatedPaymentsCatalogSchema = z.custom<PaymentsCatalog>()

/** Passes the env object through unvalidated, because createPaymentsClient rejects a missing key as payments-env. */
const unvalidatedPaymentsEnvSchema = z.custom<PaymentsEnvValues>()

/** Runs one payments sync invocation and returns the success shape or the CLI failure that wraps what payments said. */
export async function runPaymentsSyncCommand(options: {
  catalogPath: string
  context: CliRuntimeContext
}): Promise<CliCommandResult> {
  const { catalogPath, context } = options

  const catalogLoad = await loadPaymentsCatalogModule(catalogPath)
  if (catalogLoad.kind === 'payments-catalog-file-absent') {
    return paymentsCatalogNotFoundFailure(catalogPath)
  }
  if (catalogLoad.kind === 'payments-catalog-unloadable') {
    return paymentsCatalogUnloadableFailure(catalogPath, catalogLoad.loadFailureDetail)
  }

  const { createPaymentsClient, syncPaymentsCatalog } = await import('@hearthkit/payments')

  const stripeSecretKey =
    readEnvironmentVariableValue(context.environmentVariables, stripeSecretKeyEnvVariableName) ?? ''

  const { drizzleClient, closeDatabaseClient } = createDrizzleClient<Record<string, unknown>>({
    databaseUrl: unusedProjectDatabaseUrl,
    schema: {},
  })

  try {
    const clientResult = createPaymentsClient({
      paymentsEnv: unvalidatedPaymentsEnvSchema.parse({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: unusedWebhookSecretPlaceholder,
      }),
      drizzleClient,
      paymentsCatalog: unvalidatedPaymentsCatalogSchema.parse(catalogLoad.catalogValue),
      organizationsEnabled: false,
    })
    if (clientResult.kind !== 'payments-client-created') {
      return paymentsSyncFailedFailure(clientResult)
    }

    const syncResult = await syncPaymentsCatalog({ paymentsClient: clientResult.paymentsClient })
    if (syncResult.kind !== 'payments-catalog-synced') {
      return paymentsSyncFailedFailure(syncResult)
    }

    return {
      kind: 'payments-sync-command-succeeded',
      catalogPath,
      syncedPrices: syncResult.syncedPrices,
      createdPriceCount: countPricesSyncedBy(syncResult.syncedPrices, 'created'),
      replacedPriceCount: countPricesSyncedBy(syncResult.syncedPrices, 'replaced'),
      unchangedPriceCount: countPricesSyncedBy(syncResult.syncedPrices, 'unchanged'),
      stripeLivemode: syncResult.stripeLivemode,
    }
  } finally {
    await closeDatabaseClient()
  }
}

/** How many synced prices took one action; the three words are payments' own syncAction values. */
function countPricesSyncedBy(
  syncedPrices: readonly { syncAction: string }[],
  syncAction: string,
): number {
  return syncedPrices.filter((syncedPrice) => syncedPrice.syncAction === syncAction).length
}
