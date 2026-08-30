import type { EmailFailure } from './email-contract.ts'
import {
  emailSendFailedFailure,
  emailTransportRejectedFailure,
  emailTransportUnreachableFailure,
} from './email-failure-results.ts'
import { redactEmailSecrets } from './redact-email-secrets.ts'
import type { SmtpEmailTransportConfig } from './transactional-email-dispatch.ts'
import {
  describeThrownEmailError,
  readSmtpErrorCode,
  readSmtpResponseCode,
} from './thrown-email-error-details.ts'

// The transport was never usable and the server never saw a message. ETLS belongs here rather than
// with a rejection: requireTLS could not be satisfied, so nodemailer aborted before AUTH and the
// operator's fix is the same class of action as repairing a down relay.
const unreachableSmtpErrorCodes = new Set(['ESOCKET', 'ECONNREFUSED', 'ETIMEDOUT', 'EDNS', 'ETLS'])

// The server was reached, answered, and refused the session or the message.
const rejectedSmtpErrorCodes = new Set(['EAUTH', 'EENVELOPE'])

// The host:port an SMTP failure names. Neither half is a secret, so both are safe in a message, and
// together they are what an operator greps their own configuration for.
function smtpTransportTarget(smtpTransport: SmtpEmailTransportConfig): string {
  return `${String(smtpTransport.smtpHostName)}:${smtpTransport.smtpPortNumber}`
}

/**
 * Maps anything nodemailer threw onto the contract failure union, so no send ever throws. Any code the
 * contract's signal table does not list lands in the catch-all on purpose, EPROTOCOL included: a host
 * and port aimed at a web server is an ordinary misconfiguration and its own words are the diagnosis.
 */
export function mapSmtpErrorToFailure(
  error: unknown,
  smtpTransport: SmtpEmailTransportConfig,
): EmailFailure {
  const transportErrorCode = readSmtpErrorCode(error)
  const transportTarget = smtpTransportTarget(smtpTransport)
  // Nodemailer's own words are quoted, so the password configured for this transport is stripped out
  // of them first: a secret may never appear in a failure of any kind.
  const detail = redactEmailSecrets(describeThrownEmailError(error), [
    String(smtpTransport.smtpCredentials?.smtpPassword ?? ''),
  ])

  if (unreachableSmtpErrorCodes.has(transportErrorCode)) {
    return emailTransportUnreachableFailure('smtp', transportErrorCode, transportTarget, detail)
  }
  if (rejectedSmtpErrorCodes.has(transportErrorCode)) {
    return emailTransportRejectedFailure(
      'smtp',
      transportErrorCode,
      readSmtpResponseCode(error),
      detail,
    )
  }
  return emailSendFailedFailure('smtp', detail)
}
