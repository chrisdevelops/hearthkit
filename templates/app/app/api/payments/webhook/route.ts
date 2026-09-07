import { handleStripeWebhook } from '@hearthkit/payments'
import { requireAppPaymentsClient } from '../../../../app-payments-client.ts'

/**
 * Stripe's webhook endpoint.
 *
 * The body is read with `await request.text()` and handed on as `rawRequestBody`. It is never parsed
 * first, here or by a body middleware: the signature is an HMAC over exactly the bytes Stripe sent,
 * so re-serialising them makes every delivery verify as a signature mismatch — which reads like a
 * wrong secret rather than like the body-handling mistake it is.
 */

/** Never prerendered: the route segment config is stated for every section page and handler alike. */
export const dynamic = 'force-dynamic'

// THE STATUS FOLLOWS THE RESULT KIND AND IS NOT ONE NUMBER. Both halves are load-bearing.
//
// The two 200s keep ordinary traffic quiet. Stripe delivers every event type an endpoint is
// subscribed to and most are none of this package's business, so `payments-webhook-ignored` is a
// RESULT, not a failure; answering 4xx for it would fail on an ordinary Tuesday until Stripe disabled
// the endpoint, taking the handled events down with it.
//
// The 5xx pair is what makes an unrecordable checkout visible. @hearthkit/payments chose
// `payments-database-unavailable` and `payments-request-failed` so that a completed checkout it could
// not record does not vanish quietly: Stripe's bounded retry is the operator's only signal, and it
// only happens on a non-2xx. Answering 200 there deletes the mechanism those variants exist for, and
// the loss would only be noticed in production.
//
// The 400s are Stripe's own guidance: a bad signature means the request did not come from Stripe, so
// the answer is 400 and nothing is written. Stripe does not retry a 4xx — it marks the endpoint as
// rejecting, which is the right signal for a request that was never Stripe's.
/** HTTP status for each result kind handleStripeWebhook can answer with. */
const webhookHttpStatusByResultKind: Readonly<Record<string, number>> = {
  'payments-webhook-processed': 200,
  'payments-webhook-ignored': 200,
  'payments-webhook-signature-invalid': 400,
  'payments-input-invalid': 400,
  'payments-database-unavailable': 503,
  'payments-request-failed': 500,
}

/** Verifies and records one delivery, answering the package's own result with the status its kind maps to. */
export async function POST(request: Request): Promise<Response> {
  const rawRequestBody = await request.text()

  const result = await handleStripeWebhook({
    paymentsClient: requireAppPaymentsClient(),
    rawRequestBody,
    requestHeaders: request.headers,
  })

  return Response.json(result, { status: webhookHttpStatusByResultKind[result.kind] ?? 500 })
}
