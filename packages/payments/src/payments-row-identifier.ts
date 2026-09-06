import { randomUUID } from 'node:crypto'

/**
 * Row ids this package generates. They are ours, not Stripe's and not Better Auth's, and nothing
 * outside this package may construct one: every table also carries the Stripe id it upserts on, which
 * is what makes a replayed delivery write the same row rather than a second one.
 */
export function generatePaymentsRowId(rowKindPrefix: string): string {
  return `${rowKindPrefix}_${randomUUID()}`
}
