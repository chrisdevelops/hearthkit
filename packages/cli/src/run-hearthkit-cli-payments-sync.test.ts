import { isAbsolute, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  expectCliFailure,
  expectCliSuccess,
  runHearthkitCliGate,
  singleStandardOutputLine,
} from '../test-fixtures/cli-run-expectations.ts'
import {
  createGateDirectory,
  removeGateDirectory,
} from '../test-fixtures/gate-project-directories.ts'
import { loadHearthkitCliPaymentsExports } from '../test-fixtures/hearthkit-cli-payments-exports.ts'
import {
  uniqueGateCliCatalogNames,
  writeGateCliCatalogFile,
  writeGateCliUnusableCatalogFile,
  type GateCliCatalogNames,
} from '../test-fixtures/payments-sync-gate-catalog.ts'
import {
  archiveGateStripeSyncedPrices,
  assertGateStripeSyncWasTestMode,
  readGateStripeSecretKey,
} from '../test-fixtures/stripe-gate-secret-key.ts'

/**
 * hearthkit payments sync. One live gate against Stripe test mode, and the three file and
 * environment paths that reach no service at all.
 *
 * The command is specified to read exactly one environment variable, so every gate here hands it an
 * environment holding only that variable or nothing. It opens no Postgres connection either — the
 * CLI builds the payments client with a database URL nothing listens on — so a sync that started
 * querying would fail these gates rather than pass them.
 */

/** Prices this run created in the shared test-mode Stripe account, archived in afterAll. */
const createdStripePrices: { stripePriceId: unknown; stripeProductId: unknown }[] = []

let gateDirectoryPath: string
let liveCatalogNames: GateCliCatalogNames
let gateStripeSecretKey: string | undefined

beforeAll(async () => {
  gateDirectoryPath = await createGateDirectory('payments-sync')
  liveCatalogNames = uniqueGateCliCatalogNames('sync')
})

afterAll(async () => {
  if (gateStripeSecretKey !== undefined && createdStripePrices.length > 0) {
    await archiveGateStripeSyncedPrices(gateStripeSecretKey, createdStripePrices)
  }
  await removeGateDirectory(gateDirectoryPath)
})

describe('hearthkit payments sync', () => {
  it('pushes the project catalog to Stripe test mode and reports one created price per catalog price', async () => {
    const { cliPaymentsSyncCompleteLinePrefix, defaultPaymentsCatalogPath } =
      await loadHearthkitCliPaymentsExports()
    // Not skipped when the key is absent: this is the only gate that proves the command reaches
    // Stripe at all, so a missing key has to fail loudly. The helper names both places to put it.
    gateStripeSecretKey = await readGateStripeSecretKey()
    const catalogFilePath = await writeGateCliCatalogFile({
      directoryPath: gateDirectoryPath,
      fileName: 'payments-catalog.ts',
      catalogNames: liveCatalogNames,
    })

    const run = await runHearthkitCliGate({
      argv: ['payments', 'sync'],
      cwd: gateDirectoryPath,
      // Only STRIPE_SECRET_KEY, because the contract says the command reads nothing else.
      env: { STRIPE_SECRET_KEY: gateStripeSecretKey },
    })

    const success = expectCliSuccess(run, 'payments-sync-command-succeeded', 0)
    // The measured test-mode guard, before this run's objects are touched again for any reason.
    assertGateStripeSyncWasTestMode(success.stripeLivemode)
    expect(success.stripeLivemode).toBe(false)
    createdStripePrices.push(...success.syncedPrices)

    // No --catalog flag, so the path is the default resolved against cwd.
    expect(success.catalogPath).toBe(resolve(gateDirectoryPath, defaultPaymentsCatalogPath))
    expect(success.catalogPath).toBe(catalogFilePath)
    expect([...success.syncedPrices].map((price) => String(price.priceName)).toSorted()).toEqual(
      [liveCatalogNames.subscriptionPriceName, liveCatalogNames.oneTimePriceName].toSorted(),
    )
    // Every price name is unique to this run, so the first sync of it can only create.
    expect(success.syncedPrices.every((price) => price.syncAction === 'created')).toBe(true)
    expect(success.createdPriceCount).toBe(success.syncedPrices.length)
    expect(success.replacedPriceCount).toBe(0)
    expect(success.unchangedPriceCount).toBe(0)
    expect(
      success.createdPriceCount + success.replacedPriceCount + success.unchangedPriceCount,
    ).toBe(success.syncedPrices.length)

    // One machine-readable line on stdout; only its prefix and the counts it carries are contract.
    const printedLine = singleStandardOutputLine(run)
    expect(printedLine.startsWith(cliPaymentsSyncCompleteLinePrefix)).toBe(true)
    expect(printedLine).toContain(String(success.createdPriceCount))
  })

  it('fails with cli-payments-catalog-not-found and the absolute default path when the project has no catalog file', async () => {
    const { cliPaymentsCatalogNotFoundErrorPrefix, defaultPaymentsCatalogPath } =
      await loadHearthkitCliPaymentsExports()
    // A directory of its own, so the live gate's catalog file cannot make this one pass.
    const emptyDirectoryPath = await createGateDirectory('payments-sync-empty')

    try {
      // No Stripe key at all: the file check comes first, so this path needs no service and no key.
      const run = await runHearthkitCliGate({
        argv: ['payments', 'sync'],
        cwd: emptyDirectoryPath,
        env: {},
      })

      const failure = expectCliFailure(run, 'cli-payments-catalog-not-found', 1)
      expect(isAbsolute(failure.catalogPath)).toBe(true)
      expect(failure.catalogPath).toBe(resolve(emptyDirectoryPath, defaultPaymentsCatalogPath))
      expect(failure.message.startsWith(cliPaymentsCatalogNotFoundErrorPrefix)).toBe(true)
      expect(run.standardError).toContain(failure.message)
      expect(run.standardOutput.trim()).toBe('')
    } finally {
      await removeGateDirectory(emptyDirectoryPath)
    }
  })

  it('fails with cli-payments-catalog-unloadable when the --catalog file exists but exports no catalog', async () => {
    const { cliPaymentsCatalogUnloadableErrorPrefix } = await loadHearthkitCliPaymentsExports()
    const unusableCatalogFileName = 'gate-unusable-catalog.ts'
    const unusableCatalogFilePath = await writeGateCliUnusableCatalogFile({
      directoryPath: gateDirectoryPath,
      fileName: unusableCatalogFileName,
    })

    const run = await runHearthkitCliGate({
      argv: ['payments', 'sync', '--catalog', `./${unusableCatalogFileName}`],
      cwd: gateDirectoryPath,
      env: {},
    })

    const failure = expectCliFailure(run, 'cli-payments-catalog-unloadable', 1)
    // The file is there, so this is not "not found", and the flag value is resolved against cwd.
    expect(failure.catalogPath).toBe(unusableCatalogFilePath)
    expect(failure.loadFailureDetail.length).toBeGreaterThan(0)
    expect(failure.message.startsWith(cliPaymentsCatalogUnloadableErrorPrefix)).toBe(true)
    expect(run.standardError).toContain(failure.message)
  })

  it('wraps the payments failure as cli-payments-sync-failed when STRIPE_SECRET_KEY is unset', async () => {
    const { cliPaymentsSyncFailedErrorPrefix, stripeSecretKeyEnvVariableName } =
      await loadHearthkitCliPaymentsExports()
    const catalogNames = uniqueGateCliCatalogNames('unset-key')
    const unsetKeyCatalogFileName = 'gate-unset-key-catalog.ts'
    await writeGateCliCatalogFile({
      directoryPath: gateDirectoryPath,
      fileName: unsetKeyCatalogFileName,
      catalogNames,
    })

    // The catalog loads, so the run gets as far as createPaymentsClient, which rejects the env
    // object. A missing key is deliberately not a CLI failure kind; it arrives wrapped.
    const run = await runHearthkitCliGate({
      argv: ['payments', 'sync', '--catalog', `./${unsetKeyCatalogFileName}`],
      cwd: gateDirectoryPath,
      env: {},
    })

    const failure = expectCliFailure(run, 'cli-payments-sync-failed', 1)
    expect(failure.paymentsFailure.kind).toBe('payments-input-invalid')
    if (failure.paymentsFailure.kind === 'payments-input-invalid') {
      expect(failure.paymentsFailure.invalidFieldName).toBe('payments-env')
    }
    expect(failure.message.startsWith(cliPaymentsSyncFailedErrorPrefix)).toBe(true)
    // Both prefixes stay greppable: the payments message follows the CLI prefix unchanged.
    expect(failure.message).toContain(failure.paymentsFailure.message)
    // The payments message names the field, not the variable, so the CLI's guidance names it.
    expect(run.standardError).toContain(stripeSecretKeyEnvVariableName)
    expect(run.standardError).toContain(failure.message)
  })
})
