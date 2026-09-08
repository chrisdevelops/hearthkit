import { readAuthSession } from '@hearthkit/auth'
import { createCheckoutSession } from '@hearthkit/payments'
import { requireAppAuthServerInstance } from '../../../../app-auth-server.ts'
import {
  paymentsFailureHttpStatusByKind,
  requireAppPaymentsClient,
} from '../../../../app-payments-client.ts'
import { requireAppRuntimeConfig } from '../../../../app-runtime-config.ts'

/**
 * Opens a hosted Stripe Checkout Session for the signed-in person and answers `createCheckoutSession`'s
 * own result as JSON, so the browser can follow `checkoutUrl`.
 *
 * `@hearthkit/payments` requires `@hearthkit/auth`, so this route can insist on a session: the billing
 * reference is the signed-in user's id in user-scoped mode, and creating a session for an anonymous
 * visitor would put a purchase somewhere nothing could ever read it back from.
 */

/** Never prerendered: the route segment config is stated for every section page and handler alike. */
export const dynamic = 'force-dynamic'

/** True for a JSON object body, which is the only shape this route reads fields out of. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Stripe rejects a relative redirect, and success_url carries the {CHECKOUT_SESSION_ID} placeholder
// Stripe substitutes. It is built by concatenation rather than through `new URL`, because normalising
// percent-encodes the braces and turns the placeholder into literal text.
/** An absolute URL on this app, built from the base URL every emailed link already uses. */
function appAbsoluteUrl(routePath: string): string {
  return `${String(requireAppRuntimeConfig().AUTH_BASE_URL).replace(/\/+$/, '')}${routePath}`
}

/** Creates the Checkout Session, or answers the owning package's own failure unchanged. */
export async function POST(request: Request): Promise<Response> {
  let requestBody: unknown
  try {
    requestBody = await request.json()
  } catch {
    return Response.json({ message: 'the request body was not JSON' }, { status: 400 })
  }
  if (!isJsonObject(requestBody)) {
    return Response.json({ message: 'the request body was not a JSON object' }, { status: 400 })
  }

  const priceName = requestBody.priceName
  if (typeof priceName !== 'string' || priceName === '') {
    return Response.json({ message: 'priceName is required' }, { status: 400 })
  }

  const session = await readAuthSession({
    authServerInstance: requireAppAuthServerInstance(),
    requestHeaders: request.headers,
  })
  if (session.kind !== 'auth-session-active') {
    return Response.json({ message: 'sign in before starting a checkout' }, { status: 401 })
  }

  const result = await createCheckoutSession({
    paymentsClient: requireAppPaymentsClient(),
    billingReferenceId: String(session.authUser.id),
    billingContactEmail: String(session.authUser.email),
    priceName,
    successUrl: appAbsoluteUrl('/billing/return?checkout_session_id={CHECKOUT_SESSION_ID}'),
    cancelUrl: appAbsoluteUrl('/billing'),
  })

  if (result.kind !== 'payments-checkout-session-created') {
    return Response.json(result, { status: paymentsFailureHttpStatusByKind[result.kind] ?? 500 })
  }
  return Response.json(result, { status: 200 })
}
