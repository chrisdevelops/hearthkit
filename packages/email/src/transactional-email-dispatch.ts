import type {
  EmailAddress,
  EmailFailure,
  EmailSender,
  EmailSubject,
  EmailTransportConfig,
  TransportMessageId,
} from './email-contract.ts'

/**
 * The rendered message handed to a transport. Every message is multipart: an HTML part and a readable
 * text part, always both, on both transports, so neither transport can send half a message.
 */
export type TransactionalEmailMessage = {
  emailFrom: EmailSender
  to: EmailAddress
  subject: EmailSubject
  htmlBody: string
  textBody: string
}

/**
 * What one transport attempt produced. A discriminated value rather than a thrown error, so the
 * orchestrating send never has to catch anything a transport module already classified.
 */
export type TransportSendOutcome =
  | { kind: 'transport-accepted-message'; transportMessageId: TransportMessageId }
  | { kind: 'transport-refused-message'; failure: EmailFailure }

/** The SMTP arm of the transport union, so the SMTP module cannot be handed a Resend config by mistake. */
export type SmtpEmailTransportConfig = Extract<
  EmailTransportConfig,
  { kind: 'smtp-email-transport' }
>

/** The Resend arm of the transport union, so the Resend module cannot be handed an SMTP config by mistake. */
export type ResendEmailTransportConfig = Extract<
  EmailTransportConfig,
  { kind: 'resend-email-transport' }
>
