import type { ErrorResponse } from 'resend'
import type { EmailFailure } from './email-contract.ts'
import {
  emailTransportRejectedFailure,
  emailTransportUnreachableFailure,
} from './email-failure-results.ts'
import { redactEmailSecrets } from './redact-email-secrets.ts'
import type { ResendEmailTransportConfig } from './transactional-email-dispatch.ts'

// The one Resend error name that means the request never arrived; every other name means the API was
// reached and answered. Resend reports it with a null status code, which is why the rejected variant's
// status is optional in the contract.
const resendUnreachableErrorName = 'application_error'

/**
 * Maps a Resend error object onto the contract failure union. Resend returns its errors rather than
 * throwing them, so this is reached by inspecting the response, never from a catch block.
 */
export function mapResendErrorToFailure(
  errorResponse: ErrorResponse,
  resendTransport: ResendEmailTransportConfig,
): EmailFailure {
  const transportTarget = String(resendTransport.resendBaseUrl)
  // Resend's own words are quoted, so the API key configured for this transport is stripped out of
  // them first: a secret may never appear in a failure of any kind.
  const detail = redactEmailSecrets(errorResponse.message, [String(resendTransport.resendApiKey)])

  if (errorResponse.name === resendUnreachableErrorName && errorResponse.statusCode === null) {
    return emailTransportUnreachableFailure(
      'resend',
      errorResponse.name,
      transportTarget,
      detail.length > 0 ? detail : 'the Resend API answered nothing',
    )
  }
  return emailTransportRejectedFailure(
    'resend',
    errorResponse.name,
    errorResponse.statusCode ?? undefined,
    detail.length > 0 ? detail : 'the Resend API refused the message',
  )
}
