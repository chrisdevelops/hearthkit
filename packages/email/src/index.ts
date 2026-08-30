/** Public entry point of @hearthkit/email: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Narrows the validated environment into the transport union at boot, naming every missing variable at once. */
export { resolveEmailTransportConfig } from './resolve-email-transport-config.ts'

/** Renders both parts of one message from one template; contacts nothing, so it needs no transport. */
export { renderTransactionalEmail } from './render-transactional-email.ts'

/** Renders then sends to exactly one recipient over a transport built and closed inside the call. */
export { sendTransactionalEmail } from './send-transactional-email.ts'

/** The shipped one-time sign-in link template, named magic-link-sign-in. */
export { magicLinkEmailTemplate } from './magic-link-email-template.tsx'

/** The shipped one-time password reset template, named password-reset. */
export { passwordResetEmailTemplate } from './password-reset-email-template.tsx'

/** Contract values: the unique literal prefix every returned failure message starts with. */
export {
  emailRecipientInvalidErrorPrefix,
  emailSendFailedErrorPrefix,
  emailTemplateRenderFailedErrorPrefix,
  emailTransportConfigIncompleteErrorPrefix,
  emailTransportRejectedErrorPrefix,
  emailTransportUnreachableErrorPrefix,
} from './email-contract.ts'

/** Contract values: this package's env fragment and the constants that decide every default, limit and timeout. */
export {
  defaultResendBaseUrl,
  emailEnvSchemaFragment,
  emailEnvVariableNameSchema,
  implicitTlsSmtpPort,
  magicLinkEmailTemplateName,
  maximumEmailLinkExpiryMinutes,
  maximumEmailSubjectLength,
  passwordResetEmailTemplateName,
  smtpConnectionTimeoutMs,
  smtpSocketTimeoutMs,
  unknownEmailTemplateName,
} from './email-contract.ts'

/** Contract values: the branded vocabulary schemas, so an app can parse a user-supplied address, link or subject before calling anything here. */
export {
  emailAddressSchema,
  emailLinkExpiryMinutesSchema,
  emailLinkUrlSchema,
  emailProductNameSchema,
  emailSenderSchema,
  emailSubjectSchema,
  emailTemplateNameSchema,
  emailTransportNameSchema,
  resendApiKeySchema,
  resendBaseUrlSchema,
  smtpCredentialsSchema,
  smtpHostNameSchema,
  smtpPasswordSchema,
  smtpPortNumberSchema,
  smtpUserNameSchema,
  transportMessageIdSchema,
} from './email-contract.ts'

/** Contract values: the transport union, the template shape and the two shipped templates' props, for runtime validation. */
export {
  emailTransportConfigSchema,
  magicLinkEmailPropsSchema,
  passwordResetEmailPropsSchema,
  resendEmailTransportSchema,
  smtpEmailTransportSchema,
  transactionalEmailTemplateSchema,
} from './email-contract.ts'

/** Contract values: each failure variant's schema and the union of all six. */
export {
  emailFailureSchema,
  emailRecipientInvalidFailureSchema,
  emailSendFailedFailureSchema,
  emailTemplateRenderFailedFailureSchema,
  emailTransportConfigIncompleteFailureSchema,
  emailTransportRejectedFailureSchema,
  emailTransportUnreachableFailureSchema,
} from './email-contract.ts'

/** Contract values: each function's options, success-only and full result schemas, so a narrowed result can be validated without rebuilding the schema. */
export {
  emailTransportConfigResolvedSchema,
  renderTransactionalEmailOptionsSchema,
  renderTransactionalEmailResultSchema,
  resolveEmailTransportConfigOptionsSchema,
  resolveEmailTransportConfigResultSchema,
  sendTransactionalEmailOptionsSchema,
  sendTransactionalEmailResultSchema,
  transactionalEmailRenderedSchema,
  transactionalEmailSentSchema,
} from './email-contract.ts'

/** Contract types: the branded vocabulary, the transport union, the env values and the failure union returned by all three functions. */
export type {
  EmailAddress,
  EmailEnvValues,
  EmailFailure,
  EmailLinkUrl,
  EmailProductName,
  EmailSender,
  EmailSubject,
  EmailTemplateName,
  EmailTransportConfig,
  EmailTransportName,
  ResendApiKey,
  ResendBaseUrl,
  SmtpCredentials,
  SmtpHostName,
  SmtpPassword,
  SmtpUserName,
  TransportMessageId,
} from './email-contract.ts'

/** Contract types: the template shape an app implements itself, and the props of the two shipped templates. */
export type {
  MagicLinkEmailProps,
  PasswordResetEmailProps,
  TransactionalEmailTemplate,
} from './email-contract.ts'

/** Contract types: the option, result and function shapes of every function above. */
export type {
  RenderTransactionalEmail,
  RenderTransactionalEmailOptions,
  RenderTransactionalEmailResult,
  ResolveEmailTransportConfig,
  ResolveEmailTransportConfigOptions,
  ResolveEmailTransportConfigResult,
  SendTransactionalEmail,
  SendTransactionalEmailOptions,
  SendTransactionalEmailResult,
} from './email-contract.ts'
