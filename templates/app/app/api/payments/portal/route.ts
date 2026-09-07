import { readAuthSession } from '@hearthkit/auth'
import { createCustomerPortalSession } from '@hearthkit/payments'
import { requireAppAuthServerInstance } from '../../../../app-auth-server.ts'
import {
  paymentsFailureHttpStatusByKind,
  requireAppPaymentsClient,
} from '../../../../app-payments-client.ts'
import { requireAppRuntimeConfig } from '../../../../app-runtime-config.ts'

/**
 * Opens Stripe's hosted billing portal for the signed-in person.
 *
 * This is the one call that never creates a customer, which makes it the only producer of
 * `payments-customer-not-found`: somebody who has never checked out has nothing to manage, and
 * answering 404 says so rather than silently creating an empty Stripe customer for them.
 */

/** Never prerendered: the route segment config is stated for every section page and handler alike. */
export const dynamic = 'force-dynamic'

/** Opens the portal session, or answers the owning package's own failure unchanged. */
export async function POST(request: Request): Promise<Response> {
  const session = await readAuthSession({
    authServerInstance: requireAppAuthServerInstance(),
    requestHeaders: request.headers,
  })
  if (session.kind !== 'auth-session-active') {
    return Response.json({ message: 'sign in before opening the billing portal' }, { status: 401 })
  }

  const result = await createCustomerPortalSession({
    paymentsClient: requireAppPaymentsClient(),
    billingReferenceId: String(session.authUser.id),
    returnUrl: `${String(requireAppRuntimeConfig().AUTH_BASE_URL).replace(/\/+$/, '')}/billing`,
  })

  if (result.kind !== 'payments-portal-session-created') {
    return Response.json(result, { status: paymentsFailureHttpStatusByKind[result.kind] ?? 500 })
  }
  return Response.json(result, { status: 200 })
}
