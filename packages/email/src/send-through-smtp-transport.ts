import { createTransport } from 'nodemailer'
import {
  implicitTlsSmtpPort,
  smtpConnectionTimeoutMs,
  smtpSocketTimeoutMs,
  transportMessageIdSchema,
} from './email-contract.ts'
import { mapSmtpErrorToFailure } from './smtp-error-to-failure.ts'
import type {
  SmtpEmailTransportConfig,
  TransactionalEmailMessage,
  TransportSendOutcome,
} from './transactional-email-dispatch.ts'

/**
 * Sends one message over one SMTP connection built for this call and closed before it returns, so no
 * credential outlives the call and no pool holds a Vitest run or a CLI process open. `secure` is
 * derived from the port and never configured; `requireTLS` is set whenever a password would otherwise
 * cross a connection that did not start encrypted.
 */
export async function sendThroughSmtpTransport(
  smtpTransport: SmtpEmailTransportConfig,
  message: TransactionalEmailMessage,
): Promise<TransportSendOutcome> {
  const startsEncrypted = smtpTransport.smtpPortNumber === implicitTlsSmtpPort
  const smtpCredentials = smtpTransport.smtpCredentials
  const smtpTransporter = createTransport({
    host: String(smtpTransport.smtpHostName),
    port: smtpTransport.smtpPortNumber,
    secure: startsEncrypted,
    requireTLS: smtpCredentials !== undefined && !startsEncrypted,
    auth:
      smtpCredentials === undefined
        ? undefined
        : {
            user: String(smtpCredentials.smtpUserName),
            pass: String(smtpCredentials.smtpPassword),
          },
    // Nodemailer's own defaults are 120s, 30s and 600s, which would let one stalled relay hold a web
    // request open for two minutes.
    connectionTimeout: smtpConnectionTimeoutMs,
    greetingTimeout: smtpConnectionTimeoutMs,
    socketTimeout: smtpSocketTimeoutMs,
  })

  try {
    const sentMessageInfo = await smtpTransporter.sendMail({
      from: String(message.emailFrom),
      to: String(message.to),
      subject: String(message.subject),
      html: message.htmlBody,
      text: message.textBody,
    })
    return {
      kind: 'transport-accepted-message',
      // The RFC Message-ID nodemailer assigned, not the queue id inside the 250 response: that id is
      // a server implementation detail and nothing here may depend on it.
      transportMessageId: transportMessageIdSchema.parse(sentMessageInfo.messageId),
    }
  } catch (error) {
    return {
      kind: 'transport-refused-message',
      failure: mapSmtpErrorToFailure(error, smtpTransport),
    }
  } finally {
    smtpTransporter.close()
  }
}
