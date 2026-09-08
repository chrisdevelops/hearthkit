import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as paymentsContract from '../src/payments-contract.ts'
import type {
  CreateCheckoutSession,
  CreateCustomerPortalSession,
  CreatePaymentsClient,
  HandleStripeWebhook,
  HearthkitPaymentsDrizzleSchema,
  HearthkitPaymentsTableName,
  ListPaymentsPurchases,
  PaymentsCatalog,
  PaymentsClient,
  ReadPaymentsSubscription,
  SyncPaymentsCatalog,
  VerifyPaymentsTablesExist,
} from '../src/payments-contract.ts'
import { expectResultKind } from './payments-gate-expectations.ts'
import { gatePaymentsEnv } from './payments-gate-values.ts'

/** The env fragment's own type, read off the contract module so this fixture declares no second copy of it. */
export type PaymentsEnvSchemaFragment = typeof paymentsContract.paymentsEnvSchemaFragment

/** The whole public surface a gate is allowed to call; nothing here may be imported from an internal module. */
export type HearthkitPaymentsEntry = {
  createPaymentsClient: CreatePaymentsClient
  syncPaymentsCatalog: SyncPaymentsCatalog
  createCheckoutSession: CreateCheckoutSession
  createCustomerPortalSession: CreateCustomerPortalSession
  handleStripeWebhook: HandleStripeWebhook
  readPaymentsSubscription: ReadPaymentsSubscription
  listPaymentsPurchases: ListPaymentsPurchases
  verifyPaymentsTablesExist: VerifyPaymentsTablesExist
  paymentsEnvSchemaFragment: PaymentsEnvSchemaFragment
  hearthkitPaymentsDrizzleSchema: HearthkitPaymentsDrizzleSchema
  hearthkitPaymentsTableNames: readonly HearthkitPaymentsTableName[]
}

// The eight functions CONTRACT.md lists under Public functions, spelled out so a rename fails here by
// name instead of surfacing as "x is not a function" inside whichever gate ran first.
const expectedFunctionNames = [
  'createPaymentsClient',
  'syncPaymentsCatalog',
  'createCheckoutSession',
  'createCustomerPortalSession',
  'handleStripeWebhook',
  'readPaymentsSubscription',
  'listPaymentsPurchases',
  'verifyPaymentsTablesExist',
] as const

/**
 * Imports @hearthkit/payments through its public entry point at call time, so a package with no
 * implementation yet fails one gate at a time instead of breaking collection for a whole file.
 */
export async function importHearthkitPaymentsNamespace(): Promise<Record<string, unknown>> {
  try {
    return (await import('@hearthkit/payments')) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/payments (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/**
 * The public entry point narrowed to the surface the contract promises. Throws naming whatever is not
 * exported yet, because a missing named export resolves to undefined rather than throwing in this
 * repo's Vitest setup, which would let a gate pass while checking nothing.
 */
export async function loadHearthkitPaymentsEntry(): Promise<HearthkitPaymentsEntry> {
  const namespace = await importHearthkitPaymentsNamespace()

  const missingNames: string[] = expectedFunctionNames.filter(
    (exportName) => typeof namespace[exportName] !== 'function',
  )
  if (namespace.paymentsEnvSchemaFragment === undefined) {
    missingNames.push('paymentsEnvSchemaFragment')
  }
  if (!Array.isArray(namespace.hearthkitPaymentsTableNames)) {
    missingNames.push('hearthkitPaymentsTableNames')
  }
  // Only checked for being an object here. Whether it carries the right tables and columns is the
  // schema gate's job, and doing it here would make every database gate fail with that answer.
  if (
    typeof namespace.hearthkitPaymentsDrizzleSchema !== 'object' ||
    namespace.hearthkitPaymentsDrizzleSchema === null
  ) {
    missingNames.push('hearthkitPaymentsDrizzleSchema')
  }
  if (missingNames.length > 0) {
    throw new Error(`gate expected @hearthkit/payments to export ${missingNames.join(', ')}`)
  }

  return namespace as unknown as HearthkitPaymentsEntry
}

/** Everything createPaymentsClient needs from a gate; the catalog and the scope change per file, the rest rarely does. */
export type GatePaymentsClientOptions = {
  paymentsEntry: HearthkitPaymentsEntry
  drizzleClient: NodePgDatabase<Record<string, unknown>>
  paymentsCatalog: PaymentsCatalog
  organizationsEnabled?: boolean
  stripeApiBaseUrl?: string
  stripeSecretKey?: string
}

/**
 * A payments client, or a failure that names which gate setup was wrong. Building one contacts
 * nothing — constructing a Stripe instance does no I/O and the Drizzle client is lazy — so a gate
 * that only needs a client needs no service running anywhere.
 */
export function createGatePaymentsClient({
  paymentsEntry,
  drizzleClient,
  paymentsCatalog,
  organizationsEnabled = false,
  stripeApiBaseUrl,
  stripeSecretKey,
}: GatePaymentsClientOptions): PaymentsClient {
  const created = expectResultKind(
    paymentsEntry.createPaymentsClient({
      ...gatePaymentsEnv(stripeSecretKey),
      drizzleClient,
      paymentsCatalog,
      organizationsEnabled,
      ...(stripeApiBaseUrl === undefined ? {} : { stripeApiBaseUrl }),
    }),
    'payments-client-created',
  )
  return created.paymentsClient
}
