import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { expectPaymentsFailure } from '../test-fixtures/payments-gate-expectations.ts'
import { defineGateFileContext } from '../test-fixtures/payments-gate-file-context.ts'
import {
  createGateDrizzleClientForUrl,
  unreachableGateDatabaseUrl,
} from '../test-fixtures/payments-gate-postgres-database.ts'
import {
  deadStripeApiBaseUrl,
  gateCancelUrl,
  gatePaymentsCatalog,
  gateRelativeRedirectUrl,
  gateReturnUrl,
  gateSuccessUrl,
  reserveDeadLoopbackPort,
  uniqueGateBillingContactEmail,
  uniqueGateBillingReferenceId,
  uniqueGatePaymentsCatalogNames,
} from '../test-fixtures/payments-gate-values.ts'
import {
  createGatePaymentsClient,
  loadHearthkitPaymentsEntry,
  type HearthkitPaymentsEntry,
} from '../test-fixtures/hearthkit-payments-entry.ts'
import type {
  CreateCheckoutSessionOptions,
  PaymentsClient,
  PaymentsInvalidFieldName,
} from './payments-contract.ts'

/**
 * Every caller-supplied value is a plain string or number on the options object and is validated at
 * runtime before any service is contacted, which is the same deliberate departure email made for `to`
 * and auth made for `email`: these values always originate from user input or from an HTTP request.
 *
 * That "before any service is contacted" is what this file proves rather than assumes. The client is
 * built with its Stripe API base URL on a closed local port and its Drizzle client on another, so a
 * call that reached either service would come back payments-stripe-unreachable or
 * payments-database-unavailable instead of the input failure each case asserts.
 */

type InvalidInputCase = {
  caseName: string
  invalidFieldName: PaymentsInvalidFieldName
  overrides: Partial<CreateCheckoutSessionOptions>
}

const gateFile = defineGateFileContext<{
  paymentsEntry: HearthkitPaymentsEntry
  paymentsClient: PaymentsClient
  subscriptionPriceName: string
  closeDatabaseClient: () => Promise<void>
}>(async () => {
  const paymentsEntry = await loadHearthkitPaymentsEntry()
  const { drizzleClient, closeDatabaseClient } = createGateDrizzleClientForUrl(
    unreachableGateDatabaseUrl,
    paymentsEntry.hearthkitPaymentsDrizzleSchema,
  )
  const catalogNames = uniqueGatePaymentsCatalogNames('input')
  const paymentsClient = createGatePaymentsClient({
    paymentsEntry,
    drizzleClient: drizzleClient as NodePgDatabase<Record<string, unknown>>,
    paymentsCatalog: gatePaymentsCatalog(catalogNames),
    stripeApiBaseUrl: deadStripeApiBaseUrl(await reserveDeadLoopbackPort()),
  })
  return {
    paymentsEntry,
    paymentsClient,
    subscriptionPriceName: catalogNames.subscriptionPriceName,
    closeDatabaseClient,
  }
})

afterAll(async () => {
  await gateFile.releaseIfCreated(({ closeDatabaseClient }) => closeDatabaseClient())
})

describe('payments-input-invalid', () => {
  it('rejects every caller-supplied value createCheckoutSession takes, naming the field and contacting no service', async () => {
    const { paymentsEntry, paymentsClient, subscriptionPriceName } = await gateFile.read()
    const validOptions: CreateCheckoutSessionOptions = {
      paymentsClient,
      billingReferenceId: uniqueGateBillingReferenceId('input'),
      billingContactEmail: uniqueGateBillingContactEmail('input'),
      priceName: subscriptionPriceName,
      successUrl: gateSuccessUrl,
      cancelUrl: gateCancelUrl,
    }

    const invalidInputCases: readonly InvalidInputCase[] = [
      {
        caseName: 'an empty billing reference',
        invalidFieldName: 'billing-reference-id',
        overrides: { billingReferenceId: '' },
      },
      {
        caseName: 'an address that is not one',
        invalidFieldName: 'billing-contact-email',
        overrides: { billingContactEmail: 'gate-not-an-address' },
      },
      {
        // A well-formed name the catalog does not have is payments-price-not-found, not this: a name
        // that is not lowercase kebab-case could never be a Stripe lookup_key in the first place.
        caseName: 'a price name that is not lowercase kebab-case',
        invalidFieldName: 'price-name',
        overrides: { priceName: 'Gate Not Kebab Case' },
      },
      {
        caseName: 'a quantity of zero',
        invalidFieldName: 'quantity',
        overrides: { quantity: 0 },
      },
      {
        caseName: 'a fractional quantity',
        invalidFieldName: 'quantity',
        overrides: { quantity: 1.5 },
      },
      {
        caseName: 'a relative success URL',
        invalidFieldName: 'success-url',
        overrides: { successUrl: gateRelativeRedirectUrl },
      },
      {
        caseName: 'a relative cancel URL',
        invalidFieldName: 'cancel-url',
        overrides: { cancelUrl: gateRelativeRedirectUrl },
      },
    ]

    const wrongAnswers: string[] = []
    for (const invalidInputCase of invalidInputCases) {
      const result = await paymentsEntry.createCheckoutSession({
        ...validOptions,
        ...invalidInputCase.overrides,
      })
      const failure = expectPaymentsFailure(result, 'payments-input-invalid')
      if (failure.invalidFieldName !== invalidInputCase.invalidFieldName) {
        wrongAnswers.push(
          `${invalidInputCase.caseName} was named ${failure.invalidFieldName}, expected ${invalidInputCase.invalidFieldName}`,
        )
      }
      // The reason states the rule; it never echoes the rejected value back at a caller who may log it.
      expect(failure.invalidFieldReason.length).toBeGreaterThan(0)
    }
    expect(
      wrongAnswers,
      'invalidFieldName is an enum so a gate asserts on it, not on message text',
    ).toEqual([])

    // The control that keeps every case above non-vacuous: the same options with nothing wrong get
    // past validation and fail on a service instead, so each failure is attributable to its field.
    const nothingWrong = await paymentsEntry.createCheckoutSession(validOptions)
    expect(nothingWrong.kind).not.toBe('payments-input-invalid')
  })

  it('rejects the values createCustomerPortalSession and handleStripeWebhook take, naming the field', async () => {
    const { paymentsEntry, paymentsClient } = await gateFile.read()

    const emptyReference = await paymentsEntry.createCustomerPortalSession({
      paymentsClient,
      billingReferenceId: '',
      returnUrl: gateReturnUrl,
    })
    expect(expectPaymentsFailure(emptyReference, 'payments-input-invalid').invalidFieldName).toBe(
      'billing-reference-id',
    )

    const relativeReturnUrl = await paymentsEntry.createCustomerPortalSession({
      paymentsClient,
      billingReferenceId: uniqueGateBillingReferenceId('input-portal'),
      returnUrl: gateRelativeRedirectUrl,
    })
    expect(
      expectPaymentsFailure(relativeReturnUrl, 'payments-input-invalid').invalidFieldName,
    ).toBe('return-url')

    // rawRequestBody must be the exact bytes Stripe sent. A parsed object is the mistake a Next route
    // handler makes by calling request.json() instead of request.text(), and stripe@22.6.1 throws
    // rather than returning for it, so this package rejects it as input before verification.
    const parsedBody = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: { id: 'evt_gate_parsed_object' } as unknown as string,
      requestHeaders: new Headers(),
    })
    expect(expectPaymentsFailure(parsedBody, 'payments-input-invalid').invalidFieldName).toBe(
      'raw-request-body',
    )

    // Headers are duck-typed on .get exactly as readAuthSession does it, so Next's read-only headers
    // pass; an object carrying no .get at all cannot be read and is named rather than thrown on.
    const headersWithoutGet = await paymentsEntry.handleStripeWebhook({
      paymentsClient,
      rawRequestBody: '{"id":"evt_gate_no_headers"}',
      requestHeaders: { keys: () => [] } as unknown as Headers,
    })
    expect(
      expectPaymentsFailure(headersWithoutGet, 'payments-input-invalid').invalidFieldName,
    ).toBe('request-headers')
  })
})
