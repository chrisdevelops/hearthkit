import { redactPaymentsClientSecrets } from './payments-client-secrets.ts'
import {
  paymentsDatabaseUnavailableFailure,
  paymentsRequestFailedFailure,
  paymentsStripeUnauthorizedFailure,
  paymentsStripeUnreachableFailure,
} from './payments-failure-results.ts'
import {
  stripeForbiddenHttpStatus,
  stripeUnauthorizedHttpStatus,
  type PaymentsClient,
  type PaymentsFailure,
} from './payments-contract.ts'
import {
  readThrownPaymentsErrorDetails,
  stripeConnectionErrorTypeName,
} from './thrown-payments-error-details.ts'

/**
 * Turns any thrown value into the failure CONTRACT.md maps it to, so no public function of this
 * package ever throws. The mapping is fixed there rather than chosen here: a database cause code from
 * the four-code allowlist wins first, then Stripe's 401 or 403, then a connection failure, and
 * everything else lands in the catch-all carrying whatever Stripe supplied.
 *
 * Every quoted detail passes through the client's secret redaction first, because the words are the
 * SDK's and the rule that neither secret leaves this package has no exceptions.
 */
export function thrownPaymentsErrorToFailure(
  thrownValue: unknown,
  paymentsClient: PaymentsClient | undefined,
): PaymentsFailure {
  const details = readThrownPaymentsErrorDetails(thrownValue)

  if (details.databaseFailureDetail !== undefined) {
    return paymentsDatabaseUnavailableFailure(
      redactPaymentsClientSecrets(details.databaseFailureDetail, paymentsClient),
    )
  }

  const paymentsFailureDetail = redactPaymentsClientSecrets(
    details.paymentsFailureDetail,
    paymentsClient,
  )
  // Redaction can only shorten text, and a variant carrying an empty detail would fail its own
  // schema, so a detail that was nothing but a secret still has to say something.
  const safeDetail =
    paymentsFailureDetail.length > 0 ? paymentsFailureDetail : 'no detail available'

  if (
    details.stripeErrorStatus === stripeUnauthorizedHttpStatus ||
    details.stripeErrorStatus === stripeForbiddenHttpStatus
  ) {
    return paymentsStripeUnauthorizedFailure(details.stripeErrorStatus, safeDetail)
  }

  if (details.stripeErrorTypeName === stripeConnectionErrorTypeName) {
    return paymentsStripeUnreachableFailure(safeDetail)
  }

  return paymentsRequestFailedFailure({
    paymentsFailureDetail: safeDetail,
    ...(details.stripeErrorCode === undefined
      ? {}
      : { stripeErrorCode: redactPaymentsClientSecrets(details.stripeErrorCode, paymentsClient) }),
    ...(details.stripeErrorStatus === undefined
      ? {}
      : { stripeErrorStatus: details.stripeErrorStatus }),
    ...(details.stripeErrorParam === undefined
      ? {}
      : {
          stripeErrorParam: redactPaymentsClientSecrets(details.stripeErrorParam, paymentsClient),
        }),
  })
}
