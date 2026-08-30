import type { ReactElement } from 'react'
import { z } from 'zod'

/** Unique literal prefix of the failure message when the selected transport's credentials are missing from the environment. */
export const emailTransportConfigIncompleteErrorPrefix =
  'hearthkit email transport config incomplete:'

/** Unique literal prefix of the failure message when the recipient address is not a valid single mailbox. */
export const emailRecipientInvalidErrorPrefix = 'hearthkit email recipient invalid:'

/** Unique literal prefix of the failure message when a template threw, or produced an unusable subject, while rendering. */
export const emailTemplateRenderFailedErrorPrefix = 'hearthkit email template render failed:'

/** Unique literal prefix of the failure message when the transport could not be reached, resolved, upgraded to TLS, or answered in time. */
export const emailTransportUnreachableErrorPrefix = 'hearthkit email transport unreachable:'

/** Unique literal prefix of the failure message when the transport was reached and refused the session or the message. */
export const emailTransportRejectedErrorPrefix = 'hearthkit email transport rejected:'

/** Unique literal prefix of the failure message when sending failed in a way this package does not name. */
export const emailSendFailedErrorPrefix = 'hearthkit email send failed:'

/** Resend API origin used when EMAIL_RESEND_BASE_URL is unset; overriding it is what lets gates run offline. */
export const defaultResendBaseUrl = 'https://api.resend.com'

/** SMTP port whose connection is encrypted from the first byte; every other port starts plain and may upgrade with STARTTLS. */
export const implicitTlsSmtpPort = 465

/** Longest subject this package will send; a longer subject is a template defect, not something to silently truncate. */
export const maximumEmailSubjectLength = 200

/** Longest link expiry a template will print, in minutes; seven days, matching the presigned-URL ceiling used elsewhere. */
export const maximumEmailLinkExpiryMinutes = 10080

/** Milliseconds allowed for the SMTP TCP connection and the server greeting; nodemailer's own defaults are minutes long. */
export const smtpConnectionTimeoutMs = 10000

/** Milliseconds allowed for an idle SMTP socket once connected, so a stalled relay cannot hold a web request open. */
export const smtpSocketTimeoutMs = 20000

/** Template name reported on a render failure when the template object did not carry a usable name of its own. */
export const unknownEmailTemplateName = 'unknown-email-template'

/** Name of the shipped template that carries a one-time sign-in link, used by Better Auth's magic link method. */
export const magicLinkEmailTemplateName = 'magic-link-sign-in'

/** Name of the shipped template that carries a one-time password reset link, used by Better Auth's password method. */
export const passwordResetEmailTemplateName = 'password-reset'

// Control characters are excluded from every header-bound value so a newline cannot inject an extra SMTP header.
const controlCharacterPattern = /\p{Cc}/u

// A sender may carry a display name: `Product Name <mail@example.com>`. Commas, angle brackets, quotes and
// newlines are excluded from the name so a second address or a header cannot be smuggled into the From line.
const emailDisplayNameSenderPattern =
  /^[^<>@,;"\r\n]{1,64} <[^\s<>@,;"]+@[^\s<>@,;".]+(?:\.[^\s<>@,;".]+)+>$/

// Hostname or dotted IPv4 literal. Shared so the env fragment and the transport config cannot drift apart.
const smtpHostNamePattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/

// Base URL rules for the Resend API, kept unbranded so the env fragment can apply a default before branding.
const resendBaseUrlBaseSchema = z
  .url({ protocol: /^https?$/ })
  .refine((baseUrl) => new URL(baseUrl).pathname === '/')

/** Recipient mailbox; a bare address with no display name, so one call sends to exactly one person. */
export const emailAddressSchema = z.email().brand<'EmailAddress'>()

/** Branded recipient address; produced by parsing an untrusted string, never by casting one. */
export type EmailAddress = z.infer<typeof emailAddressSchema>

/** Sender mailbox; either a bare address or `Display Name <address>`, with no newline that could inject a header. */
export const emailSenderSchema = z
  .union([z.email(), z.string().regex(emailDisplayNameSenderPattern)])
  .brand<'EmailSender'>()

/** Branded sender address taken from EMAIL_FROM; the same value is used for every message this package sends. */
export type EmailSender = z.infer<typeof emailSenderSchema>

/** Message subject; one to two hundred characters with no control characters, so CR and LF cannot inject a header. */
export const emailSubjectSchema = z
  .string()
  .min(1)
  .max(maximumEmailSubjectLength)
  .refine((subject) => !controlCharacterPattern.test(subject))
  .brand<'EmailSubject'>()

/** Branded subject line; a caller overriding a template's subject must parse its string through the schema first. */
export type EmailSubject = z.infer<typeof emailSubjectSchema>

/** Template name; lowercase kebab-case, at most 63 characters, echoed on every result so gates can identify the template. */
export const emailTemplateNameSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*$/)
  .max(63)
  .brand<'EmailTemplateName'>()

/** Branded template name carried by every render and send result and by the render failure. */
export type EmailTemplateName = z.infer<typeof emailTemplateNameSchema>

/** Action link placed in a template; http is allowed so a local development URL works unchanged. */
export const emailLinkUrlSchema = z.url({ protocol: /^https?$/ }).brand<'EmailLinkUrl'>()

/** Branded action link; the caller builds and signs it, this package only prints it in both message parts. */
export type EmailLinkUrl = z.infer<typeof emailLinkUrlSchema>

/** Product name printed in template copy; one to sixty-four characters with no control characters. */
export const emailProductNameSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((productName) => !controlCharacterPattern.test(productName))
  .brand<'EmailProductName'>()

/** Branded product name; optional on every shipped template, whose copy reads correctly without it. */
export type EmailProductName = z.infer<typeof emailProductNameSchema>

/** How long a link in a template stays usable, in whole minutes, from one minute to seven days. */
export const emailLinkExpiryMinutesSchema = z
  .number()
  .int()
  .min(1)
  .max(maximumEmailLinkExpiryMinutes)

/** Transport name as written in EMAIL_TRANSPORT; the value chooses which credentials the environment must supply. */
export const emailTransportNameSchema = z.enum(['smtp', 'resend'])

/** Transport name carried by every transport-related failure so a reader knows which backend answered. */
export type EmailTransportName = z.infer<typeof emailTransportNameSchema>

/** SMTP server hostname or dotted IPv4 literal; `localhost` for Mailpit, a relay hostname in production. */
export const smtpHostNameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(smtpHostNamePattern)
  .brand<'SmtpHostName'>()

/** Branded SMTP hostname; it may appear in a failure message because it is not a secret. */
export type SmtpHostName = z.infer<typeof smtpHostNameSchema>

/** SMTP port; a whole number from 1 to 65535, coerced from the environment's string value. */
export const smtpPortNumberSchema = z.coerce.number().int().min(1).max(65535)

/** SMTP user name; the public half of the credential pair, so it may appear in a failure message. */
export const smtpUserNameSchema = z.string().min(1).brand<'SmtpUserName'>()

/** Branded SMTP user name; present only when the relay requires authentication, absent for Mailpit. */
export type SmtpUserName = z.infer<typeof smtpUserNameSchema>

/** SMTP password; the private half of the pair, never placed in a failure message, log line or returned value. */
export const smtpPasswordSchema = z.string().min(1).brand<'SmtpPassword'>()

/** Branded SMTP password; treat every value of this type as a secret that must not be printed. */
export type SmtpPassword = z.infer<typeof smtpPasswordSchema>

/** SMTP credentials as one value, because a user name without a password is a misconfiguration, not a partial state. */
export const smtpCredentialsSchema = z.object({
  smtpUserName: smtpUserNameSchema,
  smtpPassword: smtpPasswordSchema,
})

/** Credential pair type; present or absent as a whole, never half-filled. */
export type SmtpCredentials = z.infer<typeof smtpCredentialsSchema>

/** Resend API key; a secret, never placed in a failure message, log line or returned value. */
export const resendApiKeySchema = z.string().min(1).brand<'ResendApiKey'>()

/** Branded Resend API key; the package always passes it explicitly and never lets the SDK read it from the environment. */
export type ResendApiKey = z.infer<typeof resendApiKeySchema>

/** Resend API origin; an http(s) URL with an empty path, so a full endpoint path pasted here is rejected at boot. */
export const resendBaseUrlSchema = resendBaseUrlBaseSchema.brand<'ResendBaseUrl'>()

/** Branded Resend API origin; pointing it at a local server is how the Resend transport is gated without network access. */
export type ResendBaseUrl = z.infer<typeof resendBaseUrlSchema>

/** Everything the SMTP transport needs for one send; built once from config and passed to every call. */
export const smtpEmailTransportSchema = z.object({
  kind: z.literal('smtp-email-transport'),
  emailFrom: emailSenderSchema,
  smtpHostName: smtpHostNameSchema,
  smtpPortNumber: smtpPortNumberSchema,
  smtpCredentials: smtpCredentialsSchema.optional(),
})

/** Everything the Resend transport needs for one send; built once from config and passed to every call. */
export const resendEmailTransportSchema = z.object({
  kind: z.literal('resend-email-transport'),
  emailFrom: emailSenderSchema,
  resendApiKey: resendApiKeySchema,
  resendBaseUrl: resendBaseUrlSchema,
})

/** The chosen transport and its credentials; one discriminated value replaces a cluster of maybe-set fields. */
export const emailTransportConfigSchema = z.discriminatedUnion('kind', [
  smtpEmailTransportSchema,
  resendEmailTransportSchema,
])

/** Transport config type accepted by sendTransactionalEmail; passed per call so nothing caches credentials between calls. */
export type EmailTransportConfig = z.infer<typeof emailTransportConfigSchema>

/** Env schema fragment this package contributes to config; per-transport variables are optional here and checked by the resolver. */
export const emailEnvSchemaFragment = z.object({
  EMAIL_TRANSPORT: emailTransportNameSchema,
  EMAIL_FROM: emailSenderSchema,
  EMAIL_SMTP_HOST: smtpHostNameSchema.optional(),
  EMAIL_SMTP_PORT: smtpPortNumberSchema.optional(),
  EMAIL_SMTP_USER: smtpUserNameSchema.optional(),
  EMAIL_SMTP_PASSWORD: smtpPasswordSchema.optional(),
  EMAIL_RESEND_API_KEY: resendApiKeySchema.optional(),
  EMAIL_RESEND_BASE_URL: resendBaseUrlBaseSchema
    .default(defaultResendBaseUrl)
    .brand<'ResendBaseUrl'>(),
})

/** Validated values of this package's variables, as config returns them; the input to resolveEmailTransportConfig. */
export type EmailEnvValues = z.output<typeof emailEnvSchemaFragment>

/** Environment variable name; a local restatement of config's rule so this file imports no hearthkit package. */
export const emailEnvVariableNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/)

/** Failure when EMAIL_TRANSPORT names a transport whose credentials are missing; names every missing variable at once. */
export const emailTransportConfigIncompleteFailureSchema = z.object({
  kind: z.literal('email-transport-config-incomplete'),
  emailTransportName: emailTransportNameSchema,
  missingVariableNames: z.array(emailEnvVariableNameSchema).min(1),
  message: z.string().startsWith(emailTransportConfigIncompleteErrorPrefix),
})

/** Failure when the recipient string is not a single valid mailbox; detected before any transport is contacted. */
export const emailRecipientInvalidFailureSchema = z.object({
  kind: z.literal('email-recipient-invalid'),
  recipientValue: z.string().max(320),
  message: z.string().startsWith(emailRecipientInvalidErrorPrefix),
})

/** Failure when building or rendering the template threw, or the template produced a subject the schema rejects. */
export const emailTemplateRenderFailedFailureSchema = z.object({
  kind: z.literal('email-template-render-failed'),
  emailTemplateName: emailTemplateNameSchema,
  renderFailureDetail: z.string().min(1),
  message: z.string().startsWith(emailTemplateRenderFailedErrorPrefix),
})

/** Failure when the transport refused the connection, did not resolve, would not upgrade to TLS, or did not answer in time. */
export const emailTransportUnreachableFailureSchema = z.object({
  kind: z.literal('email-transport-unreachable'),
  emailTransportName: emailTransportNameSchema,
  transportErrorCode: z.string().min(1),
  transportTarget: z.string().min(1),
  message: z.string().startsWith(emailTransportUnreachableErrorPrefix),
})

/** Failure when the transport was reached and refused the session or the message; carries the code and status it reported. */
export const emailTransportRejectedFailureSchema = z.object({
  kind: z.literal('email-transport-rejected'),
  emailTransportName: emailTransportNameSchema,
  transportErrorCode: z.string().min(1),
  transportStatusCode: z.number().int().optional(),
  message: z.string().startsWith(emailTransportRejectedErrorPrefix),
})

/** Catch-all failure for anything this package cannot classify; it exists so no call ever throws instead of returning. */
export const emailSendFailedFailureSchema = z.object({
  kind: z.literal('email-send-failed'),
  emailTransportName: emailTransportNameSchema,
  sendFailureDetail: z.string().min(1),
  message: z.string().startsWith(emailSendFailedErrorPrefix),
})

/** Every way an email call can fail; each variant's message starts with its unique prefix and names the value at fault. */
export const emailFailureSchema = z.discriminatedUnion('kind', [
  emailTransportConfigIncompleteFailureSchema,
  emailRecipientInvalidFailureSchema,
  emailTemplateRenderFailedFailureSchema,
  emailTransportUnreachableFailureSchema,
  emailTransportRejectedFailureSchema,
  emailSendFailedFailureSchema,
])

/** Discriminated failure union returned, never thrown, by all three public functions of this package. */
export type EmailFailure = z.infer<typeof emailFailureSchema>

/** A sendable template: its name, the subject it builds from its props, and the React element it builds from them. */
export type TransactionalEmailTemplate<TTemplateProps> = {
  emailTemplateName: EmailTemplateName
  buildEmailSubject: (templateProps: TTemplateProps) => string
  buildEmailElement: (templateProps: TTemplateProps) => ReactElement
}

/** Runtime check that a template object has the three required members; the precise props type lives on the generic type. */
export const transactionalEmailTemplateSchema = z.custom<TransactionalEmailTemplate<never>>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { emailTemplateName?: unknown }).emailTemplateName === 'string' &&
    typeof (value as { buildEmailSubject?: unknown }).buildEmailSubject === 'function' &&
    typeof (value as { buildEmailElement?: unknown }).buildEmailElement === 'function',
)

/** Props of the shipped magic link template; the URL is printed verbatim in both the HTML and the plain text part. */
export const magicLinkEmailPropsSchema = z.object({
  signInUrl: emailLinkUrlSchema,
  productName: emailProductNameSchema.optional(),
  expiryMinutes: emailLinkExpiryMinutesSchema.optional(),
})

/** Props type of magicLinkEmailTemplate; omit productName and expiryMinutes for generic copy. */
export type MagicLinkEmailProps = z.infer<typeof magicLinkEmailPropsSchema>

/** Props of the shipped password reset template; the URL is printed verbatim in both the HTML and the plain text part. */
export const passwordResetEmailPropsSchema = z.object({
  passwordResetUrl: emailLinkUrlSchema,
  productName: emailProductNameSchema.optional(),
  expiryMinutes: emailLinkExpiryMinutesSchema.optional(),
})

/** Props type of passwordResetEmailTemplate; omit productName and expiryMinutes for generic copy. */
export type PasswordResetEmailProps = z.infer<typeof passwordResetEmailPropsSchema>

/** Runtime shape of resolveEmailTransportConfig options; emailEnv is the slice of config this package's fragment produced. */
export const resolveEmailTransportConfigOptionsSchema = z.object({
  emailEnv: emailEnvSchemaFragment,
})

/** Options type for resolveEmailTransportConfig; pass the whole config object, extra keys are ignored. */
export type ResolveEmailTransportConfigOptions = {
  emailEnv: EmailEnvValues
}

/** Success shape of resolveEmailTransportConfig; the transport named by EMAIL_TRANSPORT had every variable it needs. */
export const emailTransportConfigResolvedSchema = z.object({
  kind: z.literal('email-transport-config-resolved'),
  emailTransportConfig: emailTransportConfigSchema,
})

/** Full result union of resolveEmailTransportConfig for runtime validation in gates. */
export const resolveEmailTransportConfigResultSchema = z.union([
  emailTransportConfigResolvedSchema,
  emailFailureSchema,
])

/** Result type of resolveEmailTransportConfig. */
export type ResolveEmailTransportConfigResult = z.infer<
  typeof resolveEmailTransportConfigResultSchema
>

/** Signature of resolveEmailTransportConfig: synchronous, contacts nothing, never throws, run once at boot. */
export type ResolveEmailTransportConfig = (
  options: ResolveEmailTransportConfigOptions,
) => ResolveEmailTransportConfigResult

/** Runtime shape of renderTransactionalEmail options; templateProps is checked by the template, not by this schema. */
export const renderTransactionalEmailOptionsSchema = z.object({
  emailTemplate: transactionalEmailTemplateSchema,
  templateProps: z.unknown(),
  subject: emailSubjectSchema.optional(),
})

/** Options type for renderTransactionalEmail; omit subject to use the one the template builds from its props. */
export type RenderTransactionalEmailOptions<TTemplateProps> = {
  emailTemplate: TransactionalEmailTemplate<TTemplateProps>
  templateProps: TTemplateProps
  subject?: EmailSubject
}

/** Success shape of renderTransactionalEmail; both message parts come from one template, so they cannot disagree. */
export const transactionalEmailRenderedSchema = z.object({
  kind: z.literal('transactional-email-rendered'),
  emailTemplateName: emailTemplateNameSchema,
  subject: emailSubjectSchema,
  htmlBody: z.string().min(1),
  textBody: z.string().min(1),
})

/** Full result union of renderTransactionalEmail for runtime validation in gates. */
export const renderTransactionalEmailResultSchema = z.union([
  transactionalEmailRenderedSchema,
  emailFailureSchema,
])

/** Result type of renderTransactionalEmail. */
export type RenderTransactionalEmailResult = z.infer<typeof renderTransactionalEmailResultSchema>

/** Signature of renderTransactionalEmail: contacts nothing, so only the render failure can come back from it. */
export type RenderTransactionalEmail = <TTemplateProps>(
  options: RenderTransactionalEmailOptions<TTemplateProps>,
) => Promise<RenderTransactionalEmailResult>

/** Message id the transport assigned; opaque, its shape differs per transport, so never parse or construct one. */
export const transportMessageIdSchema = z.string().min(1).brand<'TransportMessageId'>()

/** Branded transport message id returned after a successful send. */
export type TransportMessageId = z.infer<typeof transportMessageIdSchema>

/** Runtime shape of sendTransactionalEmail options; `to` is a plain string on purpose and is validated at send time. */
export const sendTransactionalEmailOptionsSchema = z.object({
  emailTransportConfig: emailTransportConfigSchema,
  emailTemplate: transactionalEmailTemplateSchema,
  templateProps: z.unknown(),
  to: z.string(),
  subject: emailSubjectSchema.optional(),
})

/** Options type for sendTransactionalEmail; exactly one recipient per call, and the sender comes from the transport config. */
export type SendTransactionalEmailOptions<TTemplateProps> = {
  emailTransportConfig: EmailTransportConfig
  emailTemplate: TransactionalEmailTemplate<TTemplateProps>
  templateProps: TTemplateProps
  to: string
  subject?: EmailSubject
}

/** Success shape of sendTransactionalEmail; the rendered bodies are deliberately not returned, because they carry the link. */
export const transactionalEmailSentSchema = z.object({
  kind: z.literal('transactional-email-sent'),
  emailTemplateName: emailTemplateNameSchema,
  to: emailAddressSchema,
  subject: emailSubjectSchema,
  transportMessageId: transportMessageIdSchema,
})

/** Full result union of sendTransactionalEmail for runtime validation in gates. */
export const sendTransactionalEmailResultSchema = z.union([
  transactionalEmailSentSchema,
  emailFailureSchema,
])

/** Result type of sendTransactionalEmail. */
export type SendTransactionalEmailResult = z.infer<typeof sendTransactionalEmailResultSchema>

/** Signature of sendTransactionalEmail: renders then sends, never throws, and opens no connection it does not close. */
export type SendTransactionalEmail = <TTemplateProps>(
  options: SendTransactionalEmailOptions<TTemplateProps>,
) => Promise<SendTransactionalEmailResult>
