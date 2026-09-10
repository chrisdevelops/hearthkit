import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, describe, expect, it } from 'vitest'
import {
  expectContractStringExport,
  expectPaymentsFailure,
} from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  createGateDrizzleClientForUrl,
  unreachableGateDatabaseUrl,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  buildGateCheckoutSessionObject,
  buildGateStripeWebhookDelivery,
  gateBillingReferenceMetadata,
  uniqueGateStripeId,
} from '../test-fixtures/payments-gate-stripe-events.ts'
import {
  gatePaymentsCatalog,
  gateWrongStripeWebhookSecret,
  stripeWrongSchemeSignatureMessage,
  stripeWrongSecretSignatureMessagePrefix,
  uniqueGateBillingContactEmail,
  uniqueGateBillingReferenceId,
  uniqueGatePaymentsCatalogNames,
} from '../test-fixtures/payments-gate-values.ts'
import {
  createGatePaymentsClient,
  loadHearthkitPaymentsEntry,
  type HearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import {
  handleStripeWebhookResultSchema,
  stripeSignatureHeaderName,
  type PaymentsClient,
} from './payments-contract.ts'

/**
 * Both halves of payments-webhook-signature-invalid, with no Stripe key, no network and no database:
 * verification is a local HMAC, and the Drizzle client here points at a closed port on purpose, so a
 * handler that queried before verifying would answer payments-database-unavailable and fail these
 * gates rather than pass them.
 */

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  paymentsClient: PaymentsClient
  closeDatabaseClient: () => Promise<void>
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const { drizzleClient, closeDatabaseClient } = createGateDrizzleClientForUrl(
    unreachableGateDatabaseUrl,
    paymentsEntry.hearthkitPaymentsDrizzleSchema,
  )
  const paymentsClient = createGatePaymentsClient({
    paymentsEntry,
    drizzleClient: drizzleClient as NodePgDatabase<Record<string, unknown>>,
    paymentsCatalog: gatePaymentsCatalog(uniqueGatePaymentsCatalogNames('signature')),
  })
  return { paymentsEntry, paymentsClient, closeDatabaseClient }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ closeDatabaseClient }) => closeDatabaseClient())
})

function buildGateSignedSubscriptionCheckout(
  paymentsClient: PaymentsClient,
  billingReferenceId: string,
  billingContactEmail: string,
  signingSecret?: string,
) {
  return buildGateStripeWebhookDelivery(
    paymentsClient,
    {
      stripeEventType: 'checkout.session.completed',
      eventDataObject: buildGateCheckoutSessionObject({
        stripeCheckoutSessionId: uniqueGateStripeId('cs'),
        stripeCustomerId: uniqueGateStripeId('cus'),
        checkoutMode: 'subscription',
        paymentStatus: 'paid',
        billingContactEmail,
        stripeSubscriptionId: uniqueGateStripeId('sub'),
        metadata: gateBillingReferenceMetadata(billingReferenceId),
      }),
    },
    signingSecret,
  )
}

describe('payments-webhook-signature-invalid', () => {
  it('reports signature-header-missing when the request carries no stripe-signature header at all', async () => {
    const { paymentsEntry, paymentsClient } = await gateFile.read()
    const delivery = buildGateSignedSubscriptionCheckout(
      paymentsClient,
      uniqueGateBillingReferenceId('sig-missing'),
      uniqueGateBillingContactEmail('sig-missing'),
    )

    const result = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: delivery.rawRequestBody,
      // Everything else about this request is right, including a body that would verify. The header
      // is read off the request by the one name this package spells once, so a request without it
      // did not come from Stripe whatever the body says.
      requestHeaders: new Headers({ 'content-type': 'application/json' }),
    })
    handleStripeWebhookResultSchema.parse(result)
    const failure = expectPaymentsFailure(result, 'payments-webhook-signature-invalid')
    expect(failure.signatureFailureReason).toBe('signature-header-missing')
    expect(expectContractStringExport(stripeSignatureHeaderName, 'stripeSignatureHeaderName')).toBe(
      'stripe-signature',
    )
  })

  it('reports signature-verification-failed when the header was signed with a different secret, and the detail is the wrong-secret message rather than its one-line-away decoy', async () => {
    const { paymentsEntry, paymentsClient } = await gateFile.read()
    const billingReferenceId = uniqueGateBillingReferenceId('sig-wrong')
    const billingContactEmail = uniqueGateBillingContactEmail('sig-wrong')
    const delivery = buildGateSignedSubscriptionCheckout(
      paymentsClient,
      billingReferenceId,
      billingContactEmail,
      gateWrongStripeWebhookSecret,
    )

    const result = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: delivery.rawRequestBody,
      requestHeaders: delivery.requestHeaders,
    })
    handleStripeWebhookResultSchema.parse(result)
    const failure = expectPaymentsFailure(result, 'payments-webhook-signature-invalid')
    expect(failure.signatureFailureReason).toBe('signature-verification-failed')

    // The trap this assertion exists to avoid: `No signatures found matching the expected signature
    // for payload.` is the wrong-secret message, and `No signatures found with expected scheme` is
    // thrown one line away for a header carrying no v1 entry, which is a different cause. A
    // substring test on `No signatures found` would satisfy both, so this matches the whole prefix
    // and then proves the decoy is not what came back. Both strings are read off stripe@22.6.1 and
    // live in the fixtures: their only reader is this gate, so they are not public surface.
    const stripeFailureDetail = failure.stripeFailureDetail ?? ''
    expect(stripeFailureDetail).toContain(stripeWrongSecretSignatureMessagePrefix)
    expect(stripeFailureDetail).not.toContain(stripeWrongSchemeSignatureMessage)

    // StripeSignatureVerificationError carries the raw webhook body on `.payload`, so it holds
    // whatever customer data the event held. The detail quotes the message and never the payload.
    const serializedFailure = JSON.stringify(failure)
    expect(serializedFailure).not.toContain(billingContactEmail)
    expect(serializedFailure).not.toContain(billingReferenceId)
  })

  it('reports signature-verification-failed for a body that was parsed and re-serialised, because that changes the bytes the HMAC covers', async () => {
    const { paymentsEntry, paymentsClient } = await gateFile.read()
    const delivery = buildGateSignedSubscriptionCheckout(
      paymentsClient,
      uniqueGateBillingReferenceId('sig-reserialised'),
      uniqueGateBillingContactEmail('sig-reserialised'),
    )
    // The same event, byte for byte different. This is what framework middleware does when it parses
    // a JSON body and hands the route a re-encoded copy, and the symptom names the wrong cause: it
    // arrives as a signature mismatch rather than as the body-handling mistake it is.
    const reserializedRequestBody = JSON.stringify(JSON.parse(delivery.rawRequestBody))
    expect(reserializedRequestBody).not.toBe(delivery.rawRequestBody)

    const result = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: reserializedRequestBody,
      requestHeaders: delivery.requestHeaders,
    })
    handleStripeWebhookResultSchema.parse(result)
    expect(
      expectPaymentsFailure(result, 'payments-webhook-signature-invalid').signatureFailureReason,
    ).toBe('signature-verification-failed')

    // And the same bytes it signed still verify, so the gate above failed for the re-encoding and
    // not because nothing this fixture signs can ever verify.
    const untouched = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: delivery.rawRequestBody,
      requestHeaders: delivery.requestHeaders,
    })
    expect(untouched.kind).not.toBe('payments-webhook-signature-invalid')
  })
})
