import { readAuthSession } from '@hearthkit/auth'
import { listPaymentsPurchases, syncPaymentsCatalog } from '@hearthkit/payments'
import type { PaymentsPurchase, PaymentsSyncedPrice } from '@hearthkit/payments'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageContainer,
  PageHeader,
} from '@hearthkit/ui'
import { headers } from 'next/headers'
import { requireAppAuthServerInstance } from '../../app-auth-server.ts'
import { requireAppPaymentsClient } from '../../app-payments-client.ts'

/**
 * The `@hearthkit/payments` section: what this app sells, what this person has bought, and the way to
 * both Stripe hosted pages.
 *
 * A Server Component, because everything it shows needs a secret: the session, the Stripe price ids
 * `syncPaymentsCatalog` reports, and the purchase rows. `@hearthkit/payments` requires
 * `@hearthkit/auth`, so this page can insist on a session and use the signed-in user's id as the
 * billing reference.
 *
 * `data-price-name` and `data-stripe-price-id` are contract, not styling. A `checkout.session.completed`
 * delivery carries no line items, so `@hearthkit/payments` resolves what was sold from three session
 * metadata keys, and anything reconstructing that event has to read the same values off this page.
 *
 * The one piece of browser code is an inline script rather than a Client Component, because the page
 * itself must stay server-rendered: a `'use client'` page cannot read a session and Next ignores the
 * route segment config on one. It posts to the section's own route handlers and follows the hosted
 * URL each answers with.
 */

/** Never prerendered: this page reads config and contacts Stripe, and `next build` runs with an empty environment. */
export const dynamic = 'force-dynamic'

/** Posts the chosen price or the portal request, then follows whichever hosted URL came back. */
const billingBrowserScript = `
document.addEventListener('click', function (event) {
  var target = event.target instanceof Element ? event.target : null;
  if (target === null) return;
  var checkoutButton = target.closest('[data-checkout-price-name]');
  if (checkoutButton !== null) {
    event.preventDefault();
    followHostedUrl('/api/payments/checkout', { priceName: checkoutButton.getAttribute('data-checkout-price-name') }, 'checkoutUrl');
    return;
  }
  if (target.closest('[data-billing-portal]') !== null) {
    event.preventDefault();
    followHostedUrl('/api/payments/portal', {}, 'portalUrl');
  }
});

function followHostedUrl(routePath, requestBody, hostedUrlField) {
  var message = document.querySelector('[data-testid="billing-message"]');
  fetch(routePath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
  })
    .then(function (response) { return response.json(); })
    .then(function (result) {
      if (typeof result[hostedUrlField] === 'string') {
        window.location.assign(result[hostedUrlField]);
        return;
      }
      if (message !== null) message.textContent = result.message || 'The request was refused.';
    })
    .catch(function (error) {
      if (message !== null) message.textContent = String(error);
    });
}
`.trim()

/** Money as a person reads it, from the minor units Stripe stores and the lowercase code it returns. */
function formatMinorUnits(amountTotalMinorUnits: number, currency: string): string {
  return `${(amountTotalMinorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`
}

/** One purchasable price, carrying the two attributes anything reconstructing a delivery has to read. */
function BillingPriceRow({ syncedPrice }: { syncedPrice: PaymentsSyncedPrice }) {
  return (
    <li
      data-testid="billing-price"
      data-price-name={String(syncedPrice.priceName)}
      data-stripe-price-id={String(syncedPrice.stripePriceId)}
      className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-b-0"
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium">{String(syncedPrice.priceName)}</span>
        <span className="text-xs text-muted-foreground">
          {String(syncedPrice.stripePriceId)} ({syncedPrice.syncAction})
        </span>
      </div>
      <button
        type="button"
        data-checkout-price-name={String(syncedPrice.priceName)}
        className="h-9 shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Checkout
      </button>
    </li>
  )
}

/** One recorded one-time purchase, named by the catalog price so it is recognisable without a Stripe id. */
function BillingPurchaseRow({ paymentsPurchase }: { paymentsPurchase: PaymentsPurchase }) {
  return (
    <li data-testid="billing-purchase" className="flex justify-between gap-4 py-2 text-sm">
      <span>{String(paymentsPurchase.priceName)}</span>
      <span className="text-muted-foreground">
        {formatMinorUnits(
          paymentsPurchase.amountTotalMinorUnits,
          String(paymentsPurchase.currency),
        )}{' '}
        on {paymentsPurchase.purchasedAt.toISOString().slice(0, 10)}
      </span>
    </li>
  )
}

export default async function BillingSectionPage() {
  const session = await readAuthSession({
    authServerInstance: requireAppAuthServerInstance(),
    requestHeaders: await headers(),
  })

  if (session.kind !== 'auth-session-active') {
    return (
      <PageContainer>
        <PageHeader
          pageTitle="Billing"
          pageDescription="Billing is keyed on who is signed in, so this page needs a session."
        />
        <Card>
          <CardHeader>
            <CardTitle>Sign in first</CardTitle>
            <CardDescription>Open /sign-in, then come back here.</CardDescription>
          </CardHeader>
        </Card>
      </PageContainer>
    )
  }

  const billingReferenceId = String(session.authUser.id)
  const paymentsClient = requireAppPaymentsClient()

  // Pushed on every visit rather than in a deploy step, because it is idempotent and because the
  // Stripe price ids only exist once it has run. A real product syncs from a deploy hook instead.
  const catalogSync = await syncPaymentsCatalog({ paymentsClient })
  const purchases = await listPaymentsPurchases({ paymentsClient, billingReferenceId })

  const syncedPrices: PaymentsSyncedPrice[] =
    catalogSync.kind === 'payments-catalog-synced' ? [...catalogSync.syncedPrices] : []
  const paymentsPurchases: PaymentsPurchase[] =
    purchases.kind === 'payments-purchases-listed' ? [...purchases.paymentsPurchases] : []
  const sectionMessage =
    catalogSync.kind === 'payments-catalog-synced'
      ? purchases.kind === 'payments-purchases-listed'
        ? ''
        : purchases.message
      : catalogSync.message

  return (
    <PageContainer>
      <PageHeader
        pageTitle="Billing"
        pageDescription="The catalog this app declares in code, synced to Stripe, plus what this account has bought."
      >
        <button
          type="button"
          data-billing-portal="true"
          className="h-9 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          Billing portal
        </button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Billing reference</CardTitle>
          <CardDescription>
            Every customer, subscription and purchase row is keyed on this value, which is the
            signed-in user id in user-scoped mode.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p data-testid="billing-reference" className="font-mono text-sm break-all">
            {billingReferenceId}
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Prices</CardTitle>
          <CardDescription>
            Declared in payments-catalog.ts and pushed to Stripe on this request.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul>
            {syncedPrices.map((syncedPrice) => (
              <BillingPriceRow key={String(syncedPrice.priceName)} syncedPrice={syncedPrice} />
            ))}
          </ul>
          <p data-testid="billing-message" className="pt-3 text-sm break-all text-muted-foreground">
            {sectionMessage}
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Purchases</CardTitle>
          <CardDescription>
            Written by the webhook route, which is the only thing that records a completed checkout.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul>
            {paymentsPurchases.map((paymentsPurchase) => (
              <BillingPurchaseRow
                key={String(paymentsPurchase.id)}
                paymentsPurchase={paymentsPurchase}
              />
            ))}
          </ul>
        </CardContent>
      </Card>

      <script dangerouslySetInnerHTML={{ __html: billingBrowserScript }} />
    </PageContainer>
  )
}
