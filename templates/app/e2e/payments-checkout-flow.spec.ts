import { createHmac, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  hearthkitBillingReferenceMetadataKey,
  hearthkitPriceNameMetadataKey,
  hearthkitQuantityMetadataKey,
  hearthkitStripePriceIdMetadataKey,
  stripeSignatureHeaderName,
} from '@hearthkit/payments/payments-contract'

/**
 * The payments section, end to end, WITHOUT automating Stripe's hosted UI.
 *
 * Driving Checkout with a browser means automating a third-party page this project does not control
 * and that changes without notice. So the flow proves the two halves separately, which together are
 * the whole journey: the redirect really reaches Stripe carrying the session
 * `createCheckoutSession` returned, and the state transition a completed payment causes is driven by
 * posting a locally signed `checkout.session.completed` to the webhook route. That is the same
 * transition @hearthkit/payments' own gates already prove, and it needs no `stripe listen` session,
 * because the webhook secret is a value this project chose rather than one Stripe issued.
 *
 * Needs Stripe test mode and the Postgres the auth section already requires. @hearthkit/payments
 * requires @hearthkit/auth, so this flow can sign a person in first and the section can assume a
 * session exists.
 */

/** The test-mode key; an empty value counts as unset, the same rule hearthkit config applies everywhere. */
const stripeSecretKey = (process.env.STRIPE_SECRET_KEY ?? '').trim()

/** The signing secret the running app verifies against; the flow signs with the same value. */
const stripeWebhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim()

/** One person, created by this run, whose billing reference is what the webhook body names. */
const checkoutRunToken = randomUUID().replaceAll('-', '').slice(0, 12)
const signUpEmailAddress = `hearthkit-payments-flow-${checkoutRunToken}@hearthkit.test`
const signUpPassword = `hearthkit-flow-password-${checkoutRunToken}`
const signUpDisplayName = `Hearthkit Billing ${checkoutRunToken}`

/** What the checkout route answers with, which is createCheckoutSession's own success shape. */
type CheckoutSessionCreated = {
  kind: string
  stripeCheckoutSessionId: string
  checkoutUrl: string
  stripeCustomerId: string
  priceName: string
  stripeLivemode: boolean
}

/**
 * The `t=<unix seconds>,v1=<hmac>` header Stripe sends and the SDK verifies, computed here with no
 * network. The signed payload is the timestamp, a full stop, and the exact bytes of the body, so the
 * body is built once as a string and both signed and sent unchanged.
 */
function signStripeWebhookBody(rawRequestBody: string): string {
  const timestampSeconds = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', stripeWebhookSecret)
    .update(`${String(timestampSeconds)}.${rawRequestBody}`, 'utf8')
    .digest('hex')
  return `t=${String(timestampSeconds)},v1=${signature}`
}

test('a checkout redirect reaches Stripe with the right session, and its completion webhook records the purchase', async ({
  page,
  request,
}) => {
  // A skipped gate is not a passing gate: this reports as skipped rather than passing when no key is
  // present, so a run's counts say whether Stripe was exercised at all.
  test.skip(
    stripeSecretKey === '',
    'the payments flow needs STRIPE_SECRET_KEY, and a run without one has not exercised Stripe',
  )
  expect(
    stripeWebhookSecret,
    'the running app validates STRIPE_WEBHOOK_SECRET at boot, so the flow signs with the same value',
  ).not.toBe('')

  await page.goto('/sign-in')
  await page.getByTestId('auth-name-input').fill(signUpDisplayName)
  await page.getByTestId('auth-email-input').fill(signUpEmailAddress)
  await page.getByTestId('auth-password-input').fill(signUpPassword)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL('**/account', { timeout: 30_000 })

  const billingResponse = await page.goto('/billing')
  expect(billingResponse?.status()).toBe(200)

  // The billing reference and the Stripe price id are what the webhook body has to carry: a delivery
  // carries no line_items, so session metadata is the only source for what was sold.
  const billingReferenceId = (await page.getByTestId('billing-reference').innerText()).trim()
  expect(billingReferenceId).not.toBe('')

  const priceCard = page.getByTestId('billing-price').first()
  const priceName = (await priceCard.getAttribute('data-price-name')) ?? ''
  const stripePriceId = (await priceCard.getAttribute('data-stripe-price-id')) ?? ''
  expect(priceName, 'the billing section must name the catalog price it offers').not.toBe('')
  expect(
    stripePriceId,
    'the billing section must name the Stripe price its catalog synced to',
  ).not.toBe('')

  // The redirect half. The session id is read off the app's own answer rather than off the URL, so
  // the assertion is that Stripe sent the browser to the session THIS app created.
  const [checkoutResponse] = await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/payments/checkout')),
    priceCard.getByRole('button', { name: 'Checkout' }).click(),
  ])
  const created = (await checkoutResponse.json()) as CheckoutSessionCreated
  expect(created.kind).toBe('payments-checkout-session-created')
  expect(created.stripeLivemode, 'no gate here may touch a live Stripe account').toBe(false)

  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60_000 })
  expect(page.url()).toContain('checkout.stripe.com')
  expect(page.url()).toContain(created.stripeCheckoutSessionId)

  // The completion half, signed locally. Indented JSON on purpose: the handler must treat the body
  // as opaque bytes, and a re-serialised body verifies as a signature mismatch rather than as the
  // body-handling mistake it is.
  const rawRequestBody = JSON.stringify(
    {
      id: `evt_flow_${checkoutRunToken}`,
      object: 'event',
      api_version: '2026-08-27.clover',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: created.stripeCheckoutSessionId,
          object: 'checkout.session',
          amount_subtotal: 1900,
          amount_total: 1900,
          currency: 'usd',
          customer: created.stripeCustomerId,
          customer_email: signUpEmailAddress,
          customer_details: { email: signUpEmailAddress, name: signUpDisplayName, phone: null },
          livemode: false,
          metadata: {
            [hearthkitBillingReferenceMetadataKey]: billingReferenceId,
            [hearthkitPriceNameMetadataKey]: priceName,
            [hearthkitStripePriceIdMetadataKey]: stripePriceId,
            [hearthkitQuantityMetadataKey]: '1',
          },
          mode: 'payment',
          payment_intent: `pi_flow_${checkoutRunToken}`,
          payment_status: 'paid',
          status: 'complete',
          subscription: null,
        },
      },
    },
    null,
    2,
  )

  const webhookResponse = await request.post('/api/payments/webhook', {
    headers: {
      'content-type': 'application/json',
      [stripeSignatureHeaderName]: signStripeWebhookBody(rawRequestBody),
    },
    data: rawRequestBody,
  })
  expect(webhookResponse.status()).toBe(200)
  const webhookResult = (await webhookResponse.json()) as {
    kind: string
    webhookOutcome?: string
    ignoredReason?: string
  }
  expect(webhookResult.kind, JSON.stringify(webhookResult)).toBe('payments-webhook-processed')
  expect(webhookResult.webhookOutcome).toBe('purchase-recorded')

  // And the page reflects it, which is what a person would see after Stripe redirected them back.
  await page.goto('/billing')
  await expect(page.getByTestId('billing-purchase').filter({ hasText: priceName })).toBeVisible({
    timeout: 30_000,
  })
})
