import Stripe from 'stripe'
import { validatePaymentsCatalogEntries } from './payments-catalog-validation.ts'
import { rememberPaymentsClientSecrets } from './payments-client-secrets.ts'
import {
  paymentsCatalogInvalidFailure,
  paymentsInputInvalidFailure,
} from './payments-failure-results.ts'
import {
  paymentsDrizzleClientSchema,
  paymentsEnvSchemaFragment,
  paymentsStripeApiBaseUrlSchema,
  type CreatePaymentsClientOptions,
  type CreatePaymentsClientResult,
  type PaymentsClient,
} from './payments-contract.ts'

/**
 * Builds the handle every other function here takes. It contacts nothing: constructing a Stripe
 * instance does no I/O and the Drizzle client is lazy, so an app can call this at module scope in
 * lib/payments.ts and a wrong key surfaces on the first request rather than at import.
 *
 * The catalog is validated here so a malformed one fails at boot rather than at a buyer's checkout,
 * and organizationsEnabled is a parameter rather than an environment variable, exactly as in
 * @hearthkit/auth, so it stays a literal in the generated app's source.
 */

// host, port and protocol are first-class StripeConfig options. They are set from one absolute URL so
// a caller has one thing to supply, and left unset entirely when none was given, which is every real
// deployment.
function stripeApiBaseUrlConfig(stripeApiBaseUrl: string): Stripe.StripeConfig {
  const baseUrl = new URL(stripeApiBaseUrl)
  return {
    host: baseUrl.hostname,
    protocol: baseUrl.protocol === 'https:' ? 'https' : 'http',
    ...(baseUrl.port === '' ? {} : { port: baseUrl.port }),
  }
}

/** Validates the catalog and builds the Stripe client; synchronous, and opens no connection. */
export function createPaymentsClient(
  options: CreatePaymentsClientOptions,
): CreatePaymentsClientResult {
  const parsedEnv = paymentsEnvSchemaFragment.safeParse(options.paymentsEnv)
  if (!parsedEnv.success) {
    return paymentsInputInvalidFailure('payments-env')
  }

  if (!paymentsDrizzleClientSchema.safeParse(options.drizzleClient).success) {
    return paymentsInputInvalidFailure('drizzle-client')
  }

  let stripeApiConfig: Stripe.StripeConfig = {}
  if (options.stripeApiBaseUrl !== undefined) {
    if (!paymentsStripeApiBaseUrlSchema.safeParse(options.stripeApiBaseUrl).success) {
      return paymentsInputInvalidFailure('stripe-api-base-url')
    }
    stripeApiConfig = stripeApiBaseUrlConfig(options.stripeApiBaseUrl)
  }

  const validatedCatalog = validatePaymentsCatalogEntries(options.paymentsCatalog)
  if (validatedCatalog.kind === 'catalog-invalid') {
    return paymentsCatalogInvalidFailure(validatedCatalog.catalogIssues)
  }

  // No apiVersion and no maxNetworkRetries: the SDK's generated types describe only its own default
  // version, so pinning a different one would make every Stripe type in this package a lie, and the
  // default retry count is the behaviour the SDK's own idempotency logic was written against.
  const stripeClient = new Stripe(String(parsedEnv.data.STRIPE_SECRET_KEY), stripeApiConfig)
  const billingScope = options.organizationsEnabled ? 'organization' : 'user'

  const paymentsClient: PaymentsClient = {
    stripeClient,
    drizzleClient: options.drizzleClient,
    paymentsCatalog: validatedCatalog.paymentsCatalog,
    stripeWebhookSecret: parsedEnv.data.STRIPE_WEBHOOK_SECRET,
    organizationsEnabled: options.organizationsEnabled,
    billingScope,
  }
  rememberPaymentsClientSecrets(paymentsClient, {
    stripeSecretKey: String(parsedEnv.data.STRIPE_SECRET_KEY),
    stripeWebhookSecret: String(parsedEnv.data.STRIPE_WEBHOOK_SECRET),
  })

  return {
    kind: 'payments-client-created',
    paymentsClient,
    organizationsEnabled: options.organizationsEnabled,
    billingScope,
  }
}
