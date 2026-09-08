/**
 * Exactly the surface the payments sync amendment adds to @hearthkit/cli, loaded through the public
 * entry point. Nothing here may be read from an internal module: a gate that imported
 * src/cli-contract.ts directly would still pass if index.ts never re-exported the constant, and the
 * contract says these are public values consumers grep for.
 *
 * The loader refuses anything missing because this repo's Vitest resolves an absent named export to
 * undefined instead of throwing, so without the check a gate could compare a prefix against
 * undefined and go green while asserting nothing.
 */

/** The seven public values a payments sync gate reads; every one is a plain string constant in the contract. */
export type HearthkitCliPaymentsExports = {
  cliPaymentsCatalogNotFoundErrorPrefix: string
  cliPaymentsCatalogUnloadableErrorPrefix: string
  cliPaymentsSyncFailedErrorPrefix: string
  cliPaymentsSyncCompleteLinePrefix: string
  defaultPaymentsCatalogPath: string
  paymentsCatalogModuleExportName: string
  stripeSecretKeyEnvVariableName: string
}

const expectedPaymentsExportNames: readonly (keyof HearthkitCliPaymentsExports)[] = [
  'cliPaymentsCatalogNotFoundErrorPrefix',
  'cliPaymentsCatalogUnloadableErrorPrefix',
  'cliPaymentsSyncFailedErrorPrefix',
  'cliPaymentsSyncCompleteLinePrefix',
  'defaultPaymentsCatalogPath',
  'paymentsCatalogModuleExportName',
  'stripeSecretKeyEnvVariableName',
]

/** Loads the payments sync constants from @hearthkit/cli at call time, so an unimplemented package fails one gate at a time instead of breaking collection for the whole file. */
export async function loadHearthkitCliPaymentsExports(): Promise<HearthkitCliPaymentsExports> {
  let loaded: unknown
  try {
    loaded = await import('@hearthkit/cli')
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/cli (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }

  const namespace = loaded as Partial<Record<keyof HearthkitCliPaymentsExports, unknown>>
  const missingExportNames = expectedPaymentsExportNames.filter((exportName) => {
    const value = namespace[exportName]
    return typeof value !== 'string' || value.length === 0
  })
  if (missingExportNames.length > 0) {
    throw new Error(
      `gate expected @hearthkit/cli to export ${missingExportNames.join(', ')} as non-empty strings`,
    )
  }

  return namespace as HearthkitCliPaymentsExports
}
