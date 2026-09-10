import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import { expectResultKind } from '../test-fixtures/payments-gate-expectations.ts'
import {
  readPaymentsPackageManifest,
  runPaymentsContractModulesUnderBareNode,
} from '../test-fixtures/payments-package-entry-points.ts'
import {
  hearthkitPaymentsContractSubpathValueExportNames,
  hearthkitPaymentsEntryValueExportNames,
  importHearthkitPaymentsContractSubpathNamespace,
  importHearthkitPaymentsNamespace,
  loadHearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import * as paymentsContract from './payments-contract.ts'

const everyPaymentsVariableName = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const

const completePaymentsEnv = {
  STRIPE_SECRET_KEY: 'sk_test_51GateSecretKeyThatIsNotRealAndHasNoWhitespace',
  STRIPE_WEBHOOK_SECRET: 'whsec_GateSigningSecretThatIsNotRealEither',
}

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
  it('exports exactly the twenty-seven allowlisted values and nothing else, each contract value the one payments-contract.ts already exports', async () => {
    const namespace = await importHearthkitPaymentsNamespace()
    const contractModule = paymentsContract as unknown as Record<string, unknown>

    // A module namespace carries value exports only, so every `export type` is already erased here and
    // the types CONTRACT.md keeps on the entry point are covered by typecheck instead. Both lists are
    // compared whole rather than name by name, so a failure names every wrong export at once instead
    // of stopping at the first and hiding the rest behind a rerun.
    const actualValueExportNames = Object.keys(namespace)
      .filter((exportName) => namespace[exportName] !== undefined)
      .toSorted()
    expect(
      actualValueExportNames,
      'src/index.ts must export exactly the allowlist in CONTRACT.md "Package entry point"',
    ).toEqual([...hearthkitPaymentsEntryValueExportNames].toSorted())

    // The eighteen contract values must be the identical values payments-contract.ts exports, not a
    // second copy: an app comparing entry.hearthkitPaymentsTableNames against the subpath's value is
    // comparing the same thing. The nine prefixes, the Stripe literals and HTTP statuses, the limits,
    // the branded and record schemas, the options schemas and the eleven per-arm success shapes stay
    // internal, so they are absent from the list above and a re-export of one of them fails the
    // whole-list comparison by name.
    const rebuiltInsteadOfReExported = hearthkitPaymentsContractSubpathValueExportNames.filter(
      (exportName) => namespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value payments-contract.ts exports, not a second copy of it',
    ).toEqual([])

    // Everything else on the allowlist comes from an implementation module: the eight functions, plus
    // hearthkitPaymentsDrizzleSchema, which is the Drizzle table map and therefore an object. Whether
    // it carries the right tables and columns is the schema gate's job, not this one's.
    const wrongShape = hearthkitPaymentsEntryValueExportNames.filter((exportName) => {
      const isContractValue = hearthkitPaymentsContractSubpathValueExportNames.includes(
        exportName as (typeof hearthkitPaymentsContractSubpathValueExportNames)[number],
      )
      if (isContractValue) {
        return false
      }
      if (exportName === 'hearthkitPaymentsDrizzleSchema') {
        return typeof namespace[exportName] !== 'object' || namespace[exportName] === null
      }
      return typeof namespace[exportName] !== 'function'
    })
    expect(
      wrongShape,
      'every allowlisted name outside the eighteen contract values must be one of the eight functions, or the Drizzle schema object',
    ).toEqual([])
  })

  it('publishes ./payments-contract as a second subpath carrying the eighteen contract values, loadable by a bare node process', async () => {
    const manifest = await readPaymentsPackageManifest()
    expect(manifest.packageName).toBe('@hearthkit/payments')
    expect(Object.keys(manifest.exportsMap).toSorted()).toEqual(['.', './payments-contract'])
    expect(JSON.stringify(manifest.exportsMap['./payments-contract'])).toContain(
      './src/payments-contract-entry.ts',
    )

    const subpathNamespace = await importHearthkitPaymentsContractSubpathNamespace()
    const contractModule = paymentsContract as unknown as Record<string, unknown>
    const subpathValueExportNames = Object.keys(subpathNamespace)
      .filter((exportName) => subpathNamespace[exportName] !== undefined)
      .toSorted()
    expect(
      subpathValueExportNames,
      'src/payments-contract-entry.ts must export exactly the eighteen allowlisted names that live in payments-contract.ts',
    ).toEqual([...hearthkitPaymentsContractSubpathValueExportNames].toSorted())

    const rebuiltInsteadOfReExported = hearthkitPaymentsContractSubpathValueExportNames.filter(
      (exportName) => subpathNamespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value payments-contract.ts exports, not a second copy of it',
    ).toEqual([])

    // The reason the subpath exists: the `.` entry imports the Stripe SDK, drizzle-orm/pg-core and
    // the table definitions, while both of these files import zod at runtime and nothing else. Each
    // is run on its own so a failure names the file, and stderr must be empty as well as the exit
    // code zero, because a module that warns on load still breaks a bare consumer.
    for (const bareNodeRun of await runPaymentsContractModulesUnderBareNode()) {
      expect(bareNodeRun.exitCode, `${bareNodeRun.modulePath}: ${bareNodeRun.standardError}`).toBe(
        0,
      )
      expect(bareNodeRun.standardError, `${bareNodeRun.modulePath} wrote to stderr`).toBe('')
    }
  })
})
