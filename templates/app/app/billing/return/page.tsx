import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageContainer,
  PageHeader,
} from '@hearthkit/ui'
import Link from 'next/link'

/**
 * Where Stripe sends a buyer back to after a hosted Checkout Session.
 *
 * It deliberately reads nothing off the redirect and records nothing. A person landing here proves
 * only that their browser came back; the `checkout.session.completed` webhook is what proves the money
 * moved, and it is the only thing that writes a purchase row. Trusting this redirect instead is the
 * classic way to record an order nobody paid for.
 */

/** Never prerendered: the route segment config is stated for every section page and handler alike. */
export const dynamic = 'force-dynamic'

export default function BillingReturnPage() {
  return (
    <PageContainer>
      <PageHeader
        pageTitle="Thanks"
        pageDescription="Stripe has sent you back here. Recording the order is the webhook's job, not this page's."
      />
      <Card>
        <CardHeader>
          <CardTitle>Your checkout is on its way</CardTitle>
          <CardDescription>
            Stripe delivers `checkout.session.completed` to /api/payments/webhook, which writes the
            purchase. It usually lands within a second or two.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/billing" className="text-sm underline">
            Back to billing
          </Link>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
