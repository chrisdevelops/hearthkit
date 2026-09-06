import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import {
  paymentsCatalogSchema,
  paymentsEnvSchemaFragment,
  type PaymentsCatalog,
  type PaymentsEnvValues,
} from '../src/payments-contract.ts'

/**
 * The values every gate hands @hearthkit/payments: the two secrets, the catalog, the one-off billing
 * references and addresses a run makes up, and the redirect URLs. Opens no socket of its own beyond
 * reserving a dead port, so the gates that contact nothing can use it with no service running.
 *
 * Every name a run creates carries a fresh random token, because a catalog product name is also the
 * Stripe product id and a price name is also the Stripe price lookup_key: two runs that reused a name
 * would collide inside the shared test-mode Stripe account rather than inside this repo.
 */

/**
 * STRIPE_SECRET_KEY for every gate that contacts no Stripe account. It is deliberately not shaped
 * like a real key: CONTRACT.md validates both secrets as non-empty with no whitespace and refuses to
 * encode an `sk_` prefix anywhere, so a placeholder that would fail a prefix check is the right
 * value to prove the schema really is shape-free. Finding it in a returned value proves a leak.
 */
export const gateOfflineStripeSecretKey = 'gate-stripe-secret-key-that-must-never-be-echoed'

/**
 * STRIPE_WEBHOOK_SECRET for every webhook gate. The gates choose this rather than obtaining it from
 * Stripe: generateTestHeaderString computes the HMAC locally, so the whole signature round trip is
 * offline and deterministic and the Stripe CLI is not a dependency of any gate here.
 */
export const gateStripeWebhookSecret = 'gate-stripe-webhook-secret-that-must-never-be-echoed'

/** A second, different signing secret, so a gate can sign a body with the wrong one on purpose. */
export const gateWrongStripeWebhookSecret = 'gate-stripe-webhook-secret-that-is-the-wrong-one'

/** The real test-mode key when the environment carries one; an empty value counts as unset, as config's contract has it. */
export const gateStripeSecretKey: string | undefined =
  process.env.STRIPE_SECRET_KEY !== undefined && process.env.STRIPE_SECRET_KEY.trim().length > 0
    ? process.env.STRIPE_SECRET_KEY
    : undefined

/** Whether the live Stripe gates can run at all; plan 4.8 tags them to skip without a key, and a skipped gate is not a passing gate. */
export const hasGateStripeSecretKey = gateStripeSecretKey !== undefined

/** A well-formed value that is not a key any account issued, for the gate that proves Stripe answers 401 rather than something else. */
export const gateWrongStripeSecretKey = 'sk_test_gate_key_that_no_stripe_account_ever_issued'

/** Every secret a returned value or a failure message may never contain, per CONTRACT.md's absolute secret rule. */
export const gateSecretsThatMustNeverLeak: readonly string[] = [
  gateOfflineStripeSecretKey,
  gateStripeWebhookSecret,
  gateWrongStripeWebhookSecret,
  // A wrong key is still a key the gates handed the package, and the rule has no exception for one
  // Stripe rejected: the failure it produces is exactly the one an operator pastes into a ticket.
  gateWrongStripeSecretKey,
  ...(gateStripeSecretKey === undefined ? [] : [gateStripeSecretKey]),
]

/** A run-unique id of lowercase letters and digits, short enough to fit inside a catalog name and a database name. */
export function uniqueGatePaymentsToken(): string {
  return randomUUID().replaceAll('-', '').slice(0, 10)
}

/** A billing reference unique to this call; opaque to this package, which never checks that it names anybody. */
export function uniqueGateBillingReferenceId(purpose: string): string {
  return `gate-${purpose}-${uniqueGatePaymentsToken()}`
}

/** A receipt address unique to this call, so a customer row can only have come from this gate. */
export function uniqueGateBillingContactEmail(purpose: string): string {
  return `gate-${purpose}-${uniqueGatePaymentsToken()}@hearthkit.test`
}

/** Where Stripe sends a finished checkout; absolute http(s), which is what Stripe requires. */
export const gateSuccessUrl = 'https://gate.hearthkit.test/checkout/success'

/** Where Stripe sends an abandoned checkout. */
export const gateCancelUrl = 'https://gate.hearthkit.test/checkout/cancel'

/** Where Stripe's hosted billing portal sends the customer back to. */
export const gateReturnUrl = 'https://gate.hearthkit.test/account/billing'

/**
 * A success URL carrying Stripe's documented `{CHECKOUT_SESSION_ID}` placeholder. CONTRACT.md lists
 * "whether z.url() at zod@4.4.3 accepts a URL containing {CHECKOUT_SESSION_ID}" under Still not
 * verified, and requires the value be handed to Stripe byte for byte rather than round-tripped
 * through `new URL(value).href`, which percent-encodes the braces and turns the placeholder into
 * literal text Stripe never substitutes.
 */
export const gateSuccessUrlWithCheckoutSessionPlaceholder =
  'https://gate.hearthkit.test/checkout/success?session={CHECKOUT_SESSION_ID}'

/** A relative path, which Stripe rejects, so the contract rejects it before the call is made. */
export const gateRelativeRedirectUrl = '/checkout/success'

/** The validated environment values createPaymentsClient takes; extra keys are ignored, so an app passes config straight through. */
export function gatePaymentsEnv(stripeSecretKey: string = gateOfflineStripeSecretKey): {
  paymentsEnv: PaymentsEnvValues
} {
  return {
    paymentsEnv: paymentsEnvSchemaFragment.parse({
      STRIPE_SECRET_KEY: stripeSecretKey,
      STRIPE_WEBHOOK_SECRET: gateStripeWebhookSecret,
    }),
  }
}

/** The three names one gate run's catalog uses; all three are also Stripe identifiers, so all three are run-unique. */
export type GatePaymentsCatalogNames = {
  productName: string
  subscriptionPriceName: string
  oneTimePriceName: string
}

/** Catalog names unique to this call, in the lowercase kebab-case shape the contract's schemas require. */
export function uniqueGatePaymentsCatalogNames(purpose: string): GatePaymentsCatalogNames {
  const token = uniqueGatePaymentsToken()
  return {
    productName: `gate-${purpose}-${token}`,
    subscriptionPriceName: `gate-${purpose}-${token}-monthly`,
    oneTimePriceName: `gate-${purpose}-${token}-lifetime`,
  }
}

/** One product carrying one subscription price and one one-time price, which is every priceKind the contract has. */
export function gatePaymentsCatalog(
  catalogNames: GatePaymentsCatalogNames,
  unitAmountMinorUnits = 1900,
): PaymentsCatalog {
  return paymentsCatalogSchema.parse({
    products: [
      {
        productName: catalogNames.productName,
        displayName: `Gate ${catalogNames.productName}`,
        description: 'Product created by a @hearthkit/payments gate run.',
        prices: [
          {
            priceName: catalogNames.subscriptionPriceName,
            currency: 'usd',
            unitAmountMinorUnits,
            priceKind: 'subscription',
            recurringInterval: 'month',
            recurringIntervalCount: 1,
          },
          {
            priceName: catalogNames.oneTimePriceName,
            currency: 'usd',
            unitAmountMinorUnits: unitAmountMinorUnits + 28_000,
            priceKind: 'one-time',
          },
        ],
      },
    ],
  })
}

/**
 * A loopback port nothing is listening on, found by binding an ephemeral port and closing it again.
 * Reserving rather than hardcoding is what keeps the refused-connection gates from depending on which
 * high ports happen to be free on the machine running them.
 */
export async function reserveDeadLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('gate expected the reserved dead port server to be listening on a TCP port')
  }
  const reservedPort = address.port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return reservedPort
}

/**
 * A Stripe API base URL pointing at a closed local port. CONTRACT.md Decision 5 says stripeApiBaseUrl
 * exists for exactly this: it turns payments-stripe-unreachable into an offline, deterministic
 * failure, and it lets every input-validation gate prove that no service was contacted at all, since
 * a call that reached the network from here would come back unreachable rather than input-invalid.
 */
export function deadStripeApiBaseUrl(deadPortNumber: number): string {
  return `http://127.0.0.1:${deadPortNumber}`
}
