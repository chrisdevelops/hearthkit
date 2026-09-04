import { Resend } from 'resend'
import { transportMessageIdSchema } from './email-contract.ts'
import { emailSendFailedFailure } from './email-failure-results.ts'
import { redactEmailSecrets } from './redact-email-secrets.ts'
import { mapResendErrorToFailure } from './resend-error-to-failure.ts'
import { describeThrownEmailError } from './thrown-email-error-details.ts'
import type {
  ResendEmailTransportConfig,
  TransactionalEmailMessage,
  TransportSendOutcome,
} from './transactional-email-dispatch.ts'

/**
 * Sends one message through a Resend client built for this call, with the API key passed to the
 * constructor explicitly so the SDK can never read an ambient RESEND_API_KEY and mask a
 * misconfiguration. Resend returns its errors rather than throwing them, so the response is inspected;
 * the catch is only there for the constructor and for anything the SDK does throw.
 */
export async function sendThroughResendTransport(
  resendTransport: ResendEmailTransportConfig,
  message: TransactionalEmailMessage,
): Promise<TransportSendOutcome> {
  const resendApiKey = String(resendTransport.resendApiKey)

  try {
    const resendClient = new Resend(resendApiKey, {
      baseUrl: String(resendTransport.resendBaseUrl),
    })
    const sendResponse = await resendClient.emails.send({
      from: String(message.emailFrom),
      to: String(message.to),
      subject: String(message.subject),
      html: message.htmlBody,
      text: message.textBody,
    })

    if (sendResponse.error !== null) {
      return {
        kind: 'transport-refused-message',
        failure: mapResendErrorToFailure(sendResponse.error, resendTransport),
      }
    }
    return {
      kind: 'transport-accepted-message',
      // Opaque and transport-shaped: a UUID here, an RFC Message-ID over SMTP.
      transportMessageId: transportMessageIdSchema.parse(sendResponse.data.id),
    }
  } catch (error) {
    // The constructor throws synchronously on a missing key. resolveEmailTransportConfig makes that
    // unreachable, but a caller may hand-build a transport config, so the promise has to hold anyway.
    return {
      kind: 'transport-refused-message',
      failure: emailSendFailedFailure(
        'resend',
        redactEmailSecrets(describeThrownEmailError(error), [resendApiKey]),
      ),
    }
  }
}
