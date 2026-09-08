import { stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { paymentsCatalogModuleExportName } from './cli-contract.ts'

/**
 * Reads the project's catalog module off disk without validating what it exports.
 *
 * Node 24 strips types natively, so a `.ts` catalog needs no build step, and the file's own
 * `@hearthkit/payments` import resolves from the project's `node_modules` rather than from this
 * package. The exported value travels on as `unknown` on purpose: `createPaymentsClient` is what
 * validates a catalog, so a bad shape comes back as the payments failure rather than as a CLI one.
 */

/** What loading one catalog module came to; the two failing branches carry the detail the CLI reports. */
export type PaymentsCatalogModuleLoad =
  | { kind: 'payments-catalog-loaded'; catalogValue: unknown }
  | { kind: 'payments-catalog-file-absent' }
  | { kind: 'payments-catalog-unloadable'; loadFailureDetail: string }

/** True when a readable file sits at the path; a directory is treated as no catalog at all. */
async function catalogFileExists(catalogPath: string): Promise<boolean> {
  return stat(catalogPath).then(
    (entry) => entry.isFile(),
    () => false,
  )
}

/** Imports the catalog module at an absolute path and reads appPaymentsCatalog, falling back to the default export. */
export async function loadPaymentsCatalogModule(
  catalogPath: string,
): Promise<PaymentsCatalogModuleLoad> {
  if (!(await catalogFileExists(catalogPath))) {
    return { kind: 'payments-catalog-file-absent' }
  }

  let catalogModule: Record<string, unknown>
  try {
    catalogModule = await import(pathToFileURL(catalogPath).href)
  } catch (thrownValue) {
    return {
      kind: 'payments-catalog-unloadable',
      loadFailureDetail: thrownValue instanceof Error ? thrownValue.message : String(thrownValue),
    }
  }

  const namedExport = catalogModule[paymentsCatalogModuleExportName]
  if (namedExport !== undefined) {
    return { kind: 'payments-catalog-loaded', catalogValue: namedExport }
  }

  const defaultExport = catalogModule.default
  if (defaultExport !== undefined) {
    return { kind: 'payments-catalog-loaded', catalogValue: defaultExport }
  }

  return {
    kind: 'payments-catalog-unloadable',
    loadFailureDetail: `the module exports neither ${paymentsCatalogModuleExportName} nor a default export`,
  }
}
