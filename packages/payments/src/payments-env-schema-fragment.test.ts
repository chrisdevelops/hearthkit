import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/payments-gate-expectations.ts'
import {
  readPaymentsPackageManifest,
  runPaymentsContractUnderBareNode,
} from '../test-fixtures/payments-package-entry-points.ts'
import {
  importHearthkitPaymentsNamespace,
  loadHearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import * as paymentsContract from './payments-contract.ts'

const everyPaymentsVariableName = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const

const completePaymentsEnv = {
  STRIPE_SECRET_KEY: 'sk_test_51GateSecretKeyThatIsNotRealAndHasNoWhitespace',
  STRIPE_WEBHOOK_SECRET: 'whsec_GateSigningSecretThatIsNotRealEither',
}

// CONTRACT.md's entry point rule is mechanical: src/index.ts re-exports every value
// src/payments-contract.ts exports, with no exceptions. So the required list is read off the contract
// module's own namespace rather than typed out here. A hand-written list would fall behind the day
// someone forgot to extend it; a derived list cannot.
//
// A module namespace carries value exports only. Every `export type` in payments-contract.ts is
// erased before this file runs, so the types CONTRACT.md also asks the entry point to re-export are
// outside what this gate can see and are covered by typecheck instead.
function contractValueExportNames(contractModule: Record<string, unknown>): string[] {
  return Object.keys(contractModule).toSorted()
}

// Named in so many words by CONTRACT.md: the nine message prefixes, the env fragment, the failure
// union, the table name list, the two subscription status lists and the eight per-function result
// schemas. Spelled out as strings so renaming one in the contract fails this gate loudly, instead of
// quietly shrinking the derived list above to a set an entry point already satisfies.
const contractExportNamesTheContractNamesOutright = [
  'paymentsInputInvalidErrorPrefix',
  'paymentsCatalogInvalidErrorPrefix',
  'paymentsPriceNotFoundErrorPrefix',
  'paymentsCustomerNotFoundErrorPrefix',
  'paymentsWebhookSignatureInvalidErrorPrefix',
  'paymentsStripeUnauthorizedErrorPrefix',
  'paymentsStripeUnreachableErrorPrefix',
  'paymentsDatabaseUnavailableErrorPrefix',
  'paymentsRequestFailedErrorPrefix',
  'paymentsEnvSchemaFragment',
  'paymentsFailureSchema',
  'hearthkitPaymentsTableNames',
  'paymentsKnownSubscriptionStatuses',
  'paymentsActiveSubscriptionStatuses',
  'createPaymentsClientResultSchema',
  'syncPaymentsCatalogResultSchema',
  'createCheckoutSessionResultSchema',
  'createCustomerPortalSessionResultSchema',
  'handleStripeWebhookResultSchema',
  'readPaymentsSubscriptionResultSchema',
  'listPaymentsPurchasesResultSchema',
  'verifyPaymentsTablesExistResultSchema',
] as const

// Not exported by payments-contract.ts, so the derived list cannot cover them: the eight public
// functions and the Drizzle table map.
const entryPointOnlyExportNames = [
  'createPaymentsClient',
  'syncPaymentsCatalog',
  'createCheckoutSession',
  'createCustomerPortalSession',
  'handleStripeWebhook',
  'readPaymentsSubscription',
  'listPaymentsPurchases',
  'verifyPaymentsTablesExist',
  'hearthkitPaymentsDrizzleSchema',
] as const

describe('paymentsEnvSchemaFragment', () => {
  it('declares two required variables, names both at load when neither is set, treats an empty value as unset, and rejects one carrying whitespace', async () => {
    const { paymentsEnvSchemaFragment } = await loadHearthkitPaymentsEntry()
    expect(Object.keys(paymentsEnvSchemaFragment.shape).toSorted()).toEqual([
      ...everyPaymentsVariableName,
    ])

    const nothingSet = expectResultKind(
      loadHearthkitConfig({ fragments: [paymentsEnvSchemaFragment], env: {} }),
      'config-validation-failed',
    )
    expect(nothingSet.message).toContain('STRIPE_SECRET_KEY')
    expect(nothingSet.message).toContain('STRIPE_WEBHOOK_SECRET')
    expect(nothingSet.issues).toHaveLength(2)

    // An empty string is unset, per config's contract: a compose file carrying `STRIPE_SECRET_KEY=`
    // is the accident that rule exists to catch, and both variables are required here.
    const bothEmpty = expectResultKind(
      loadHearthkitConfig({
        fragments: [paymentsEnvSchemaFragment],
        env: { STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' },
      }),
      'config-validation-failed',
    )
    expect(bothEmpty.issues).toHaveLength(2)

    // Whitespace is the mistake upstream itself names: stripe@22.6.1 tests `/\s/.test(secret)` and
    // warns that whitespace "often indicates an extra newline or space is in the value". A copied
    // secret arrives with a trailing newline, which is why the rule is /^\S+$/ and not a prefix.
    const trailingNewline = expectResultKind(
      loadHearthkitConfig({
        fragments: [paymentsEnvSchemaFragment],
        env: {
          STRIPE_SECRET_KEY: `${completePaymentsEnv.STRIPE_SECRET_KEY}\n`,
          STRIPE_WEBHOOK_SECRET: completePaymentsEnv.STRIPE_WEBHOOK_SECRET,
        },
      }),
      'config-validation-failed',
    )
    expect(trailingNewline.message).toContain('STRIPE_SECRET_KEY')
    expect(trailingNewline.issues).toHaveLength(1)

    const innerSpace = expectResultKind(
      loadHearthkitConfig({
        fragments: [paymentsEnvSchemaFragment],
        env: {
          STRIPE_SECRET_KEY: completePaymentsEnv.STRIPE_SECRET_KEY,
          STRIPE_WEBHOOK_SECRET: 'whsec_Gate Signing Secret',
        },
      }),
      'config-validation-failed',
    )
    expect(innerSpace.message).toContain('STRIPE_WEBHOOK_SECRET')
    expect(innerSpace.issues).toHaveLength(1)

    const loaded = expectResultKind(
      loadHearthkitConfig({ fragments: [paymentsEnvSchemaFragment], env: completePaymentsEnv }),
      'config-loaded',
    )
    expect(String(loaded.config.STRIPE_SECRET_KEY)).toBe(completePaymentsEnv.STRIPE_SECRET_KEY)
    expect(String(loaded.config.STRIPE_WEBHOOK_SECRET)).toBe(
      completePaymentsEnv.STRIPE_WEBHOOK_SECRET,
    )
  })
})

describe('@hearthkit/payments entry point', () => {
  it('re-exports by name every value payments-contract.ts exports, plus the eight functions and the Drizzle schema', async () => {
    const namespace = await importHearthkitPaymentsNamespace()
    const contractModule = paymentsContract as unknown as Record<string, unknown>
    const requiredExportNames = contractValueExportNames(contractModule)

    const renamedInTheContract = contractExportNamesTheContractNamesOutright.filter(
      (exportName) => !requiredExportNames.includes(exportName),
    )
    expect(
      renamedInTheContract,
      'payments-contract.ts must still export the constants and schemas CONTRACT.md names outright',
    ).toEqual([])

    // Both lists are compared whole rather than one name at a time, so a failure names every export
    // that is wrong instead of stopping at the first and hiding the rest behind a rerun.
    const missingFromTheEntryPoint = requiredExportNames.filter(
      (exportName) => namespace[exportName] === undefined,
    )
    expect(
      missingFromTheEntryPoint,
      'src/index.ts must re-export these by name from payments-contract.ts',
    ).toEqual([])

    const rebuiltInsteadOfReExported = requiredExportNames.filter(
      (exportName) => namespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value payments-contract.ts exports, not a second copy of it',
    ).toEqual([])

    const missingImplementationExports = entryPointOnlyExportNames.filter(
      (exportName) => namespace[exportName] === undefined,
    )
    expect(
      missingImplementationExports,
      'src/index.ts must re-export the public functions and the Drizzle schema by name',
    ).toEqual([])
  })

  it('publishes ./payments-contract as a second subpath that a bare node process can load', async () => {
    const manifest = await readPaymentsPackageManifest()
    expect(manifest.packageName).toBe('@hearthkit/payments')
    expect(Object.keys(manifest.exportsMap).toSorted()).toEqual(['.', './payments-contract'])
    expect(JSON.stringify(manifest.exportsMap['./payments-contract'])).toContain(
      './src/payments-contract.ts',
    )

    // The reason the subpath exists: the `.` entry imports the Stripe SDK, drizzle-orm/pg-core and
    // the table definitions, while this file imports zod at runtime and nothing else — its stripe,
    // drizzle-orm/node-postgres and @hearthkit/auth/auth-contract imports are type-only and erased.
    const bareNodeRun = await runPaymentsContractUnderBareNode()
    expect(bareNodeRun.exitCode, bareNodeRun.standardError).toBe(0)
  })
})
