/**
 * The ./email-contract subpath of @hearthkit/email: a JSX-free named re-export of the ten contract
 * values and every public type, and nothing that reaches a template. It exists because the `.` entry
 * transitively imports the `.tsx` template modules, which a bare `node` process refuses to load,
 * while this file and email-contract.ts import only zod plus a type-only react specifier that is
 * erased. That is the subpath @hearthkit/auth imports and a bare node process can load.
 */

/** Contract values: the env fragment config composes, the failure union schema, and the transport input every send takes. */
export {
  emailEnvSchemaFragment,
  emailFailureSchema,
  emailTransportConfigSchema,
} from './email-contract.ts'

/** Contract values: the full result schema of each function, for validating a value that crossed a process or network boundary. */
export {
  renderTransactionalEmailResultSchema,
  resolveEmailTransportConfigResultSchema,
  sendTransactionalEmailResultSchema,
} from './email-contract.ts'

/** Contract values: the branded schemas an app must parse user-supplied text through before calling anything here. */
export {
  emailLinkUrlSchema,
  emailProductNameSchema,
  emailSubjectSchema,
  emailTemplateNameSchema,
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

/** Contract types: the option, result and function shapes of the three functions the `.` entry exports. */
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
