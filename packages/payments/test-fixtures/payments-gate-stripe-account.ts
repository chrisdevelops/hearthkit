import type { PaymentsClient, PaymentsSyncedPrice } from '../src/payments-contract.ts'

/**
 * The live half of the gate set, and it is deliberately small. Everything that can be proved without
 * a Stripe key is proved without one, because plan 4.8 tags these to skip when STRIPE_SECRET_KEY is
 * absent and a skipped gate is not a passing gate. What is left here needs a real account: catalog
 * sync, hosted Checkout, the hosted portal, the absent-from-stripe half of the price lookup, and the
 * 401 a wrong key produces.
 *
 * Every object these gates create in the shared test-mode account carries a run-unique name, and this
 * file archives or deletes what it can afterwards. Cleanup is hygiene rather than correctness — a
 * repeated run cannot collide, because no name is reused — so a cleanup failure must never replace a
 * gate's own diagnostic, and none of these helpers throws.
 */

type GateStripeAccountClient = {
  products?: { update?: (id: string, params: { active: boolean }) => Promise<unknown> }
  prices?: { update?: (id: string, params: { active: boolean }) => Promise<unknown> }
  customers?: { del?: (id: string) => Promise<unknown> }
  checkout?: {
    sessions?: {
      retrieve?: (id: string) => Promise<{ success_url?: string | null; mode?: string }>
    }
  }
}

function readGateStripeAccountClient(paymentsClient: PaymentsClient): GateStripeAccountClient {
  const stripeClient = (paymentsClient as unknown as { stripeClient?: GateStripeAccountClient })
    .stripeClient
  if (typeof stripeClient !== 'object' || stripeClient === null) {
    throw new Error(
      'gate expected paymentsClient.stripeClient to be a Stripe instance, which is what a live gate cleans up and reads side effects through',
    )
  }
  return stripeClient
}

/**
 * Refuses to go any further when the account is not in test mode. `livemode` is the guard CONTRACT.md
 * chose precisely because it is measured off the object Stripe answered with rather than matched
 * against an API key prefix, which is a constant nothing offline can verify. It is asserted on the
 * first object any live gate causes to exist, and every later live gate is written to run only after
 * that assertion has held.
 */
export function assertGateStripeIsTestMode(stripeLivemode: boolean): void {
  if (stripeLivemode) {
    throw new Error(
      'gate refuses to run against a live Stripe account: the first object this run created came back with livemode true, so STRIPE_SECRET_KEY is a live key and no gate here may touch it',
    )
  }
}

/**
 * Archives every price and product a sync created. Stripe prices cannot be deleted and a product
 * with prices cannot be deleted either, so `active: false` is the whole of what cleanup can be here.
 */
export async function archiveGateStripeCatalog(
  paymentsClient: PaymentsClient,
  syncedPrices: readonly PaymentsSyncedPrice[],
): Promise<void> {
  let stripeClient: GateStripeAccountClient
  try {
    stripeClient = readGateStripeAccountClient(paymentsClient)
  } catch {
    return
  }

  for (const syncedPrice of syncedPrices) {
    try {
      await stripeClient.prices?.update?.(String(syncedPrice.stripePriceId), { active: false })
    } catch {
      // Hygiene only, per the note at the top of this file.
    }
  }
  for (const stripeProductId of new Set(
    syncedPrices.map((syncedPrice) => String(syncedPrice.stripeProductId)),
  )) {
    try {
      await stripeClient.products?.update?.(stripeProductId, { active: false })
    } catch {
      // Hygiene only.
    }
  }
}

/** Deletes a customer a checkout gate created; customers, unlike prices, really can be deleted. */
export async function deleteGateStripeCustomer(
  paymentsClient: PaymentsClient,
  stripeCustomerId: string,
): Promise<void> {
  try {
    await readGateStripeAccountClient(paymentsClient).customers?.del?.(stripeCustomerId)
  } catch {
    // Hygiene only.
  }
}

/**
 * The created session as Stripe stored it, so a gate can read back a field the contract promises is
 * passed through untouched. This is a side-effect read, the same category as reading a database row:
 * the package's own result carries no success_url, and the byte-for-byte rule is unobservable without
 * asking Stripe what it received.
 *
 * CALL THE METHOD ON ITS OWNER; NEVER EXTRACT IT FIRST. `const retrieve = …sessions?.retrieve` and
 * then `retrieve(id)` type-checks, reads naturally, and calls the SDK with `this === undefined`. It
 * fails inside Stripe's own code with `TypeError: Cannot read properties of undefined (reading
 * '_makeRequest')`, so the diagnostic points at the SDK rather than at this line. The obvious
 * spelling producing a wrong result rather than a clear error is the recurring shape docs/STATUS.md
 * collects for this repo, and this instance has a second edge: it is the only helper here that no
 * offline gate reaches, so it stays invisible until a live key exists. Holding the resource object
 * and calling `sessions.retrieve(...)` keeps the receiver, which is why the cleanup helpers above
 * are already safe — each calls through its resource, as in `prices?.update?.(…)`.
 */
export async function readGateStripeCheckoutSession(
  paymentsClient: PaymentsClient,
  stripeCheckoutSessionId: string,
): Promise<{ success_url?: string | null; mode?: string }> {
  const sessions = readGateStripeAccountClient(paymentsClient).checkout?.sessions
  if (sessions === undefined || typeof sessions.retrieve !== 'function') {
    throw new Error(
      'gate expected paymentsClient.stripeClient.checkout.sessions.retrieve to exist, which is how the success_url passthrough is observed',
    )
  }
  return sessions.retrieve(stripeCheckoutSessionId)
}
