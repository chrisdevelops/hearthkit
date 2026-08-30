import {
  emailAddressSchema,
  type EmailTransportConfig,
  type SendTransactionalEmailOptions,
  type SendTransactionalEmailResult,
} from './email-contract.ts'
import { emailRecipientInvalidFailure } from './email-failure-results.ts'
import { renderTransactionalEmail } from './render-transactional-email.ts'
import { sendThroughResendTransport } from './send-through-resend-transport.ts'
import { sendThroughSmtpTransport } from './send-through-smtp-transport.ts'
import type {
  TransactionalEmailMessage,
  TransportSendOutcome,
} from './transactional-email-dispatch.ts'

// The only place the transport union is switched on, so adding a transport is one arm here and one
// module beside it rather than a condition scattered through the send path.
function dispatchTransactionalEmail(
  emailTransportConfig: EmailTransportConfig,
  message: TransactionalEmailMessage,
): Promise<TransportSendOutcome> {
  if (emailTransportConfig.kind === 'smtp-email-transport') {
    return sendThroughSmtpTransport(emailTransportConfig, message)
  }
  return sendThroughResendTransport(emailTransportConfig, message)
}

/**
 * Renders one template and sends it to exactly one recipient, returning every failure as a value. The
 * recipient is parsed before any transport is contacted, because nodemailer silently drops a bad
 * address and then reports "No recipients defined", which points at the wrong cause.
 */
export async function sendTransactionalEmail<TTemplateProps>(
  options: SendTransactionalEmailOptions<TTemplateProps>,
): Promise<SendTransactionalEmailResult> {
  const parsedRecipient = emailAddressSchema.safeParse(options.to)
  if (!parsedRecipient.success) {
    return emailRecipientInvalidFailure(options.to)
  }

  // The same function the caller can call directly, so a sent message and a rendered one can never
  // differ, and so the send result never has to carry the bodies that hold the single-use link.
  const rendered = await renderTransactionalEmail({
    emailTemplate: options.emailTemplate,
    templateProps: options.templateProps,
    subject: options.subject,
  })
  if (rendered.kind !== 'transactional-email-rendered') {
    return rendered
  }

  const outcome = await dispatchTransactionalEmail(options.emailTransportConfig, {
    emailFrom: options.emailTransportConfig.emailFrom,
    to: parsedRecipient.data,
    subject: rendered.subject,
    htmlBody: rendered.htmlBody,
    textBody: rendered.textBody,
  })
  if (outcome.kind === 'transport-refused-message') {
    return outcome.failure
  }

  return {
    kind: 'transactional-email-sent',
    emailTemplateName: rendered.emailTemplateName,
    to: parsedRecipient.data,
    subject: rendered.subject,
    transportMessageId: outcome.transportMessageId,
  }
}
