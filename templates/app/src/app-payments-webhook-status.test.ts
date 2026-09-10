import { createHmac, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  expectExportedFunctionOfType,
  importTemplateModule,
} from '../test-fixtures/app-template-gate-expectations.ts'
import {
  gateSupersetEnv,
  reserveDeadLoopbackPort,
} from '../test-fixtures/app-template-gate-environment.ts'
import {
  appTemplateOptionalPackageNames,
  appTemplateSectionsByOptionalPackage,
  appTemplateSupersetEnvVariableNames,
} from './app-template-contract.ts'

/**
 * The status code the payments webhook route answers with, which is not one number.
 *
 * @hearthkit/payments relies on Stripe's bounded retry as the operator's signal that a delivery could
 * not be recorded, so an unconditional 200 does not merely mislabel a failure — it deletes that
 * mechanism, silently, and the checkout is lost with no alert anywhere. The template's own contract
 * says so against itself: "an implementation that answered 200 for payments-request-failed would pass
 * every gate this template plans, and the property it destroyed would only be missed in production."
 * These are the two cheap rows of that table, plus the ordinary-traffic row nobody disputed.
 *
 * All three are offline. Signing is a local HMAC, so no Stripe key is involved and none of these
 * gates is tagged to skip; the one that needs a database needs it to be ABSENT, which a closed
 * loopback port supplies.
 */

/** Where the webhook route lives; named once so a pre-implementation run says which file to write. */
const paymentsWebhookRoutePath = 'app/api/payments/webhook/route.ts'

/** A route handler as Next calls it: a Web Request in, a Web Response out. */
type PaymentsWebhookRouteHandler = (request: Request) => Promise<Response>

/** Narrows the route's POST export to the handler signature; the gates below check what it answers. */
const paymentsWebhookRouteHandlerSchema = z.custom<PaymentsWebhookRouteHandler>(
  (value) => typeof value === 'function',
)

/** The fields these gates assert on out of the webhook route's JSON answer; every other field is left alone. */
const webhookResponseBodySchema = z.object({
  kind: z.string().optional(),
  signatureFailureReason: z.string().optional(),
  ignoredReason: z.string().optional(),
})

/** The signing secret the gate configures the app with, and a different one to sign wrongly with. */
const gateStripeWebhookSecret = 'gate-template-webhook-secret-that-must-never-be-echoed'
const gateWrongStripeWebhookSecret = 'gate-template-webhook-secret-that-is-the-wrong-one'

/**
 * The `t=<unix seconds>,v1=<hmac>` header Stripe sends and the SDK verifies, computed locally.
 *
 * The signed payload is the timestamp, a full stop, and the exact bytes of the body, so the body is
 * built once as a string and both signed and sent unchanged. This is what makes every gate here
 * offline: no `stripe listen` session and no key, because the webhook secret is a value this gate
 * chose rather than one Stripe issued.
 */
function stripeSignatureHeaderValue(rawRequestBody: string, signingSecret: string): string {
  const timestampSeconds = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', signingSecret)
    .update(`${String(timestampSeconds)}.${rawRequestBody}`, 'utf8')
    .digest('hex')
  return `t=${String(timestampSeconds)},v1=${signature}`
}

/** One synthesised delivery's bytes; indented on purpose, so the handler must treat the body as opaque. */
function stripeEventBody(options: {
  stripeEventType: string
  eventDataObject: Record<string, unknown>
}): string {
  return JSON.stringify(
    {
      id: `evt_gate_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
      object: 'event',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: options.stripeEventType,
      data: { object: options.eventDataObject },
    },
    null,
    2,
  )
}

/**
 * A paid one-time checkout session carrying every piece of metadata the purchase path reads, so the
 * only thing that can stop it being recorded is the database.
 */
function paidCheckoutSessionObject(billingReferenceId: string): Record<string, unknown> {
  const sessionToken = randomUUID().replaceAll('-', '').slice(0, 12)
  return {
    id: `cs_gate_${sessionToken}`,
    object: 'checkout.session',
    amount_subtotal: 1900,
    amount_total: 1900,
    currency: 'usd',
    customer: `cus_gate_${sessionToken}`,
    customer_email: `gate-webhook-${sessionToken}@hearthkit.test`,
    customer_details: {
      email: `gate-webhook-${sessionToken}@hearthkit.test`,
      name: null,
      phone: null,
    },
    livemode: false,
    metadata: {
      hearthkit_billing_reference_id: billingReferenceId,
      hearthkit_price_name: 'gate-webhook-price',
      hearthkit_stripe_price_id: `price_gate_${sessionToken}`,
      hearthkit_quantity: '1',
    },
    mode: 'payment',
    payment_intent: `pi_gate_${sessionToken}`,
    payment_status: 'paid',
    status: 'complete',
    subscription: null,
  }
}

/** Stubs a full superset environment, with the webhook secret this gate signs against. */
function stubSupersetEnvironment(overrides: Readonly<Record<string, string>>): void {
  for (const [variableName, value] of Object.entries(
    gateSupersetEnv({
      supersetEnvVariableNames: appTemplateSupersetEnvVariableNames,
      optionalEnvVariableNames: appTemplateOptionalPackageNames.flatMap(
        (optionalPackageName) =>
          appTemplateSectionsByOptionalPackage[optionalPackageName].envVariableNames,
      ),
      overrides: { STRIPE_WEBHOOK_SECRET: gateStripeWebhookSecret, ...overrides },
    }),
  )) {
    vi.stubEnv(variableName, value)
  }
}

/** Loads the route's POST handler, failing this gate by name when the file is not written yet. */
async function loadPaymentsWebhookRouteHandler(): Promise<PaymentsWebhookRouteHandler> {
  const routeNamespace = await importTemplateModule(
    paymentsWebhookRoutePath,
    () => import('../app/api/payments/webhook/route.ts'),
  )
  return expectExportedFunctionOfType(
    routeNamespace,
    'POST',
    paymentsWebhookRoutePath,
    paymentsWebhookRouteHandlerSchema,
  )
}

/** The header name @hearthkit/payments reads, taken from its contract rather than retyped. */
async function readStripeSignatureHeaderName(): Promise<string> {
  const { stripeSignatureHeaderName } = (await import('@hearthkit/payments/payments-contract')) as {
    stripeSignatureHeaderName: string
  }
  return stripeSignatureHeaderName
}

/** Posts one delivery to the route exactly as Stripe would: raw bytes plus a signature header. */
async function postSignedDelivery(options: {
  rawRequestBody: string
  signingSecret: string
}): Promise<Response> {
  const handlePaymentsWebhookRequest = await loadPaymentsWebhookRouteHandler()
  const signatureHeaderName = await readStripeSignatureHeaderName()

  return handlePaymentsWebhookRequest(
    new Request('http://127.0.0.1/api/payments/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [signatureHeaderName]: stripeSignatureHeaderValue(
          options.rawRequestBody,
          options.signingSecret,
        ),
      },
      body: options.rawRequestBody,
    }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe(`POST /api/payments/webhook`, () => {
  it('answers 400 for a delivery signed with the wrong secret, and writes nothing', async () => {
    // A closed database port, deliberately: a request that did not come from Stripe must be refused
    // before anything is written, so this gate answering 503 would mean the route reached the
    // database on an unverified body.
    stubSupersetEnvironment({
      DATABASE_URL: `postgres://hearthkit:hearthkit@127.0.0.1:${String(await reserveDeadLoopbackPort())}/hearthkit`,
    })

    const response = await postSignedDelivery({
      rawRequestBody: stripeEventBody({
        stripeEventType: 'checkout.session.completed',
        eventDataObject: paidCheckoutSessionObject('gate-webhook-wrong-secret'),
      }),
      signingSecret: gateWrongStripeWebhookSecret,
    })
    const responseBodyText = await response.text()

    expect(response.status, responseBodyText).toBe(400)

    // Asserted on the kind and the enum, never on the message: four different signature failures
    // share the opening words "No signatures found", so message text cannot tell them apart and a
    // gate written against it would pass for the wrong reason.
    const webhookResult = webhookResponseBodySchema.parse(JSON.parse(responseBodyText))
    expect(webhookResult.kind).toBe('payments-webhook-signature-invalid')
    // The reason enum is internal to @hearthkit/payments since step 5, so the literal is compared
    // directly; a renamed reason still fails here, because the contract states the two spellings.
    if (webhookResult.signatureFailureReason !== undefined) {
      expect(webhookResult.signatureFailureReason).toBe('signature-verification-failed')
    }

    // The secret the route was configured with is never echoed, whatever else the body carries.
    expect(responseBodyText).not.toContain(gateStripeWebhookSecret)
    expect(responseBodyText).not.toContain(gateWrongStripeWebhookSecret)
  })

  it('answers 503 for a validly signed delivery it could not record because the database is unreachable', async () => {
    // This is the row that matters most and the cheapest of the two 5xx rows to produce. Answering
    // 200 here tells Stripe the delivery was handled, so it never retries, and a completed checkout
    // is lost with nothing anywhere to say so. The 503 is what keeps Stripe's bounded retry — the
    // operator's only signal — alive.
    stubSupersetEnvironment({
      DATABASE_URL: `postgres://hearthkit:hearthkit@127.0.0.1:${String(await reserveDeadLoopbackPort())}/hearthkit`,
    })

    const response = await postSignedDelivery({
      rawRequestBody: stripeEventBody({
        stripeEventType: 'checkout.session.completed',
        eventDataObject: paidCheckoutSessionObject('gate-webhook-no-database'),
      }),
      signingSecret: gateStripeWebhookSecret,
    })
    const responseBodyText = await response.text()

    expect(response.status, responseBodyText).toBe(503)
    expect(webhookResponseBodySchema.parse(JSON.parse(responseBodyText)).kind).toBe(
      'payments-database-unavailable',
    )
  })

  it('answers 200 for a validly signed event type the package does not handle, which is ordinary traffic', async () => {
    // Stripe delivers every event type an endpoint is subscribed to, and most are none of this
    // package's business. An implementation that answered 4xx here would fail on ordinary traffic
    // and Stripe would disable the endpoint — taking the handled events down with it.
    //
    // The database port is closed here too, which adds a second assertion for free: an ignored event
    // is decided from the event type alone, so a route that touched the database for one would
    // answer 503 instead.
    stubSupersetEnvironment({
      DATABASE_URL: `postgres://hearthkit:hearthkit@127.0.0.1:${String(await reserveDeadLoopbackPort())}/hearthkit`,
    })

    const response = await postSignedDelivery({
      rawRequestBody: stripeEventBody({
        stripeEventType: 'invoice.payment_succeeded',
        eventDataObject: { id: 'in_gate_ignored', object: 'invoice' },
      }),
      signingSecret: gateStripeWebhookSecret,
    })
    const responseBodyText = await response.text()

    expect(response.status, responseBodyText).toBe(200)

    const webhookResult = webhookResponseBodySchema.parse(JSON.parse(responseBodyText))
    expect(webhookResult.kind).toBe('payments-webhook-ignored')

    // The literal again rather than the wording of the message, for the same reason as above.
    if (webhookResult.ignoredReason !== undefined) {
      expect(webhookResult.ignoredReason).toBe('event-type-not-handled')
    }
  })
})
