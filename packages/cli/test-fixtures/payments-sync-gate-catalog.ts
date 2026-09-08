import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { paymentsCatalogSchema } from '@hearthkit/payments/payments-contract'

/**
 * The catalog files a payments sync gate drops into a throwaway project directory, plus the file
 * that exists and exports nothing usable.
 *
 * The written catalog is a plain object literal with no import in it, unlike templates/app's, which
 * imports paymentsCatalogSchema and parses at module scope. A gate directory is a temporary
 * directory with no node_modules, so a file importing @hearthkit/payments could only resolve through
 * a symlink the gate itself made, which would prove the gate's own plumbing rather than the CLI's.
 * The object is validated here instead, against the same schema, so a sync failure in a gate is
 * never the fixture's fault. The exported value is type-annotated so the file still exercises Node's
 * type stripping, which is what lets the CLI import a .ts catalog with no build step.
 */

/** Every Stripe identity one gate run writes; the product name becomes the Stripe product id and each price name its lookup_key, so all three are run-unique. */
export type GateCliCatalogNames = {
  productName: string
  subscriptionPriceName: string
  oneTimePriceName: string
}

/** Catalog names unique to this call, in the lowercase kebab-case shape the payments catalog schema requires, so repeated and parallel runs never collide in the shared test-mode account. */
export function uniqueGateCliCatalogNames(purpose: string): GateCliCatalogNames {
  const token = randomUUID().replaceAll('-', '').slice(0, 10)
  return {
    productName: `gate-cli-${purpose}-${token}`,
    subscriptionPriceName: `gate-cli-${purpose}-${token}-monthly`,
    oneTimePriceName: `gate-cli-${purpose}-${token}-lifetime`,
  }
}

/** One product carrying one subscription price and one one-time price, validated against paymentsCatalogSchema before it is ever written to disk. */
function gateCliCatalogValue(catalogNames: GateCliCatalogNames): unknown {
  return paymentsCatalogSchema.parse({
    products: [
      {
        productName: catalogNames.productName,
        displayName: `Gate ${catalogNames.productName}`,
        description: 'Product created by a @hearthkit/cli payments sync gate run.',
        prices: [
          {
            priceName: catalogNames.subscriptionPriceName,
            currency: 'usd',
            unitAmountMinorUnits: 1900,
            priceKind: 'subscription',
            recurringInterval: 'month',
            recurringIntervalCount: 1,
          },
          {
            priceName: catalogNames.oneTimePriceName,
            currency: 'usd',
            unitAmountMinorUnits: 29_900,
            priceKind: 'one-time',
          },
        ],
      },
    ],
  })
}

/** Writes a loadable catalog module exporting appPaymentsCatalog, and returns the absolute path the CLI must resolve to. */
export async function writeGateCliCatalogFile(options: {
  directoryPath: string
  fileName: string
  catalogNames: GateCliCatalogNames
}): Promise<string> {
  const catalogFilePath = join(options.directoryPath, options.fileName)
  const catalogJson = JSON.stringify(gateCliCatalogValue(options.catalogNames), null, 2)
  await writeFile(
    catalogFilePath,
    [
      '// Written by a @hearthkit/cli payments sync gate. No import: this directory has no node_modules.',
      'type GateCatalog = { products: unknown[] }',
      '',
      `export const appPaymentsCatalog: GateCatalog = ${catalogJson}`,
      '',
    ].join('\n'),
    'utf8',
  )
  return catalogFilePath
}

/**
 * Writes a catalog module that loads cleanly and exports neither appPaymentsCatalog nor a default,
 * which is the half of cli-payments-catalog-unloadable that is not a thrown import.
 */
export async function writeGateCliUnusableCatalogFile(options: {
  directoryPath: string
  fileName: string
}): Promise<string> {
  const catalogFilePath = join(options.directoryPath, options.fileName)
  await writeFile(
    catalogFilePath,
    [
      '// Written by a @hearthkit/cli payments sync gate: a real module with no catalog in it.',
      'export const someOtherExport: string = "this module exports no catalog at all"',
      '',
    ].join('\n'),
    'utf8',
  )
  return catalogFilePath
}
