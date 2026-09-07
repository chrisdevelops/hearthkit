import { createPaymentsClient } from '@hearthkit/payments'
import type { PaymentsClient } from '@hearthkit/payments'
import { appOrganizationsEnabled } from './app-auth-server.ts'
import { requireAppDatabaseClient } from './app-database-client.ts'
import { requireAppRuntimeConfig } from './app-runtime-config.ts'
import { appPaymentsCatalog } from './payments-catalog.ts'

/**
 * The payments client every billing page and `/api/payments/*` handler takes.
 *
 * Built on first use and kept, like the auth server instance: it contacts nothing, but it reads the
 * Stripe key out of config and `next build` prerenders with an empty environment.
 *
 * `organizationsEnabled` is read from `app-auth-server.ts` rather than declared a second time, because
 * the two must agree: it decides whether a billing reference is a user id or an organization id, and
 * two different answers would key one person's rows two ways.
 *
 * The returned handle carries the webhook signing secret. Never log it, never serialise it, and never
 * put it in a response body.
 */

// Every failure @hearthkit/payments can return from the checkout and portal calls, mapped to what it
// means over HTTP. The webhook route does NOT use this: its status follows the result kind, including
// two results that are not failures at all, and that mapping is spelled out where it is used.
/** HTTP status each payments failure answers with on the checkout and portal routes. */
export const paymentsFailureHttpStatusByKind: Readonly<Record<string, number>> = {
  'payments-input-invalid': 400,
  'payments-price-not-found': 404,
  'payments-customer-not-found': 404,
  'payments-catalog-invalid': 500,
  'payments-request-failed': 500,
  'payments-stripe-unauthorized': 502,
  'payments-stripe-unreachable': 502,
  'payments-database-unavailable': 503,
}

let cachedPaymentsClient: PaymentsClient | undefined

/** The payments client, or a thrown Error carrying the owning package's own prefixed message. */
export function requireAppPaymentsClient(): PaymentsClient {
  if (cachedPaymentsClient !== undefined) {
    return cachedPaymentsClient
  }

  const created = createPaymentsClient({
    paymentsEnv: requireAppRuntimeConfig(),
    drizzleClient: requireAppDatabaseClient(),
    paymentsCatalog: appPaymentsCatalog,
    organizationsEnabled: appOrganizationsEnabled,
  })
  if (created.kind !== 'payments-client-created') {
    throw new Error(created.message)
  }

  cachedPaymentsClient = created.paymentsClient
  return cachedPaymentsClient
}
