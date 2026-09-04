import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import {
  emailAddressSchema,
  emailLinkUrlSchema,
  emailProductNameSchema,
  emailSenderSchema,
  emailSubjectSchema,
  emailTransportConfigSchema,
  resendApiKeySchema,
  resendBaseUrlSchema,
  smtpHostNameSchema,
  smtpPasswordSchema,
  smtpUserNameSchema,
  type EmailAddress,
  type EmailLinkUrl,
  type EmailProductName,
  type EmailSender,
  type EmailSubject,
  type EmailTransportConfig,
  type ResendApiKey,
  type ResendBaseUrl,
  type SmtpHostName,
} from '../src/email-contract.ts'

/**
 * Builds EmailTransportConfig values and the one-off addresses, links and subjects the gates send.
 * Opens no socket of its own beyond reserving a dead port, so the render and resolve gates can use it
 * with nothing running anywhere.
 */

/** Mailpit's SMTP host from the repo-root docker-compose.yml; the literal address, so no dual-stack lookup is involved. */
export const gateMailpitSmtpHostName: SmtpHostName = smtpHostNameSchema.parse(
  process.env.HEARTHKIT_GATE_MAILPIT_SMTP_HOST ?? '127.0.0.1',
)

/** Mailpit's SMTP port from the repo-root docker-compose.yml; plain, so nodemailer starts the session unencrypted. */
export const gateMailpitSmtpPortNumber = Number(
  process.env.HEARTHKIT_GATE_MAILPIT_SMTP_PORT ?? '1025',
)

/** A hostname reserved by RFC 2606 that can never resolve, which is what makes nodemailer report EDNS. */
export const unresolvableGateSmtpHostName: SmtpHostName = smtpHostNameSchema.parse(
  'gate-mail-host-that-never-resolves.invalid',
)

/** EMAIL_FROM for every gate send; a display-name sender, which is the harder half of emailSenderSchema. */
export const gateEmailSender: EmailSender = emailSenderSchema.parse(
  'Hearthkit Gate <gate@hearthkit.test>',
)

/** The bare mailbox inside gateEmailSender, so a gate can compare it against what Mailpit parsed out of the From header. */
export const gateEmailSenderAddress = 'gate@hearthkit.test'

/** A product name no template's own copy could contain by accident, so its presence proves the prop was used. */
export const gateEmailProductName: EmailProductName =
  emailProductNameSchema.parse('Gate Product Zephyrine')

/** The expiry the contract's own example uses; asserted as plain text, so gate tokens are letters-only to avoid a collision. */
export const gateEmailExpiryMinutes = 15

// Handed to the SMTP transport wherever credentials are configured. Finding this string in anything
// the package returns proves a secret leaked out of a value or a message.
const gateSmtpPassword = smtpPasswordSchema.parse('gate-smtp-password-that-must-never-be-echoed')

/** The SMTP user name the gates configure; not a secret, so the contract allows it in a message. */
export const gateSmtpUserName = smtpUserNameSchema.parse('gate-smtp-user')

/** The Resend key the gates hand the package; finding it in a returned value or message proves a leak. */
export const gateResendApiKey: ResendApiKey = resendApiKeySchema.parse(
  're_gate_key_that_must_never_be_echoed',
)

/** The secret strings a returned value or a failure message may never contain, per the contract's secret rule. */
export const gateSecretsThatMustNeverLeak: readonly string[] = [
  String(gateSmtpPassword),
  String(gateResendApiKey),
]

/** Nodemailer's own greeting timeout default, which the contract replaces; a gate uses it as the ceiling to beat. */
export const nodemailerDefaultGreetingTimeoutMs = 30_000

/**
 * A run-unique id made of letters only. Hex would let a random token contain the digits a render gate
 * asserts are absent when expiryMinutes is omitted, which would make that gate flaky.
 */
export function uniqueGateToken(): string {
  return randomUUID()
    .replaceAll('-', '')
    .slice(0, 12)
    .replaceAll(/[0-9]/g, (digit) => String.fromCharCode(103 + Number(digit)))
}

/** A magic link URL unique to this call, short enough that no plain text wrapper could split it. */
export function uniqueGateSignInUrl(): EmailLinkUrl {
  return emailLinkUrlSchema.parse(`https://gate.hearthkit.test/sign-in?token=${uniqueGateToken()}`)
}

/**
 * A magic link URL carrying two query parameters, in the shape Better Auth callbacks actually take.
 * Ninety characters, deliberately longer than the plain text renderer's eighty-column wrap width, so
 * the gate that asserts the text part carries it verbatim is exercising the wrap risk rather than
 * dodging it. This is the shape template promise 1 was corrected for.
 */
export function uniqueGateMultiParameterSignInUrl(): EmailLinkUrl {
  return emailLinkUrlSchema.parse(
    `https://gate.hearthkit.test/sign-in?token=${uniqueGateToken()}&callbackURL=%2Fdashboard%2Fprojects`,
  )
}

/** A password reset URL unique to this call, in the same single-parameter shape as the sign-in link. */
export function uniqueGatePasswordResetUrl(): EmailLinkUrl {
  return emailLinkUrlSchema.parse(`https://gate.hearthkit.test/reset?token=${uniqueGateToken()}`)
}

/** A recipient unique to this call, so a delivered message can only have come from this gate run. */
export function uniqueGateRecipientAddress(): EmailAddress {
  return emailAddressSchema.parse(`gate-${uniqueGateToken()}@hearthkit.test`)
}

/** A subject unique to this call, used where a gate overrides the template's own subject and looks the message up by it. */
export function uniqueGateSubject(label: string): EmailSubject {
  return emailSubjectSchema.parse(`Gate ${label} ${uniqueGateToken()}`)
}

/** Mailpit over plain SMTP with no credentials, which is the ordinary local development transport. */
export function gateMailpitTransportConfig(): EmailTransportConfig {
  return emailTransportConfigSchema.parse({
    kind: 'smtp-email-transport',
    emailFrom: gateEmailSender,
    smtpHostName: gateMailpitSmtpHostName,
    smtpPortNumber: gateMailpitSmtpPortNumber,
  })
}

/**
 * The same Mailpit transport with credentials configured. Mailpit advertises no STARTTLS capability,
 * so this is the transport the contract's requireTLS rule must refuse rather than send a password over.
 */
export function gateMailpitTransportConfigWithCredentials(): EmailTransportConfig {
  return emailTransportConfigSchema.parse({
    kind: 'smtp-email-transport',
    emailFrom: gateEmailSender,
    smtpHostName: gateMailpitSmtpHostName,
    smtpPortNumber: gateMailpitSmtpPortNumber,
    smtpCredentials: { smtpUserName: gateSmtpUserName, smtpPassword: gateSmtpPassword },
  })
}

/** An SMTP transport aimed anywhere: a dead port, a name that never resolves, or one of the imposter servers. */
export function gateSmtpTransportConfigForAddress(
  smtpHostName: SmtpHostName,
  smtpPortNumber: number,
): EmailTransportConfig {
  return emailTransportConfigSchema.parse({
    kind: 'smtp-email-transport',
    emailFrom: gateEmailSender,
    smtpHostName,
    smtpPortNumber,
  })
}

/** The host:port string the contract says an SMTP unreachable failure must report as its transportTarget. */
export function gateSmtpTransportTarget(
  smtpHostName: SmtpHostName,
  smtpPortNumber: number,
): string {
  return `${String(smtpHostName)}:${smtpPortNumber}`
}

/** The Resend transport aimed at whichever base URL the gate supplies, which is how it is reached without network access. */
export function gateResendTransportConfig(resendBaseUrl: ResendBaseUrl): EmailTransportConfig {
  return emailTransportConfigSchema.parse({
    kind: 'resend-email-transport',
    emailFrom: gateEmailSender,
    resendApiKey: gateResendApiKey,
    resendBaseUrl,
  })
}

/**
 * A loopback port nothing is listening on, found by binding an ephemeral port and closing it again.
 * Reserving rather than hardcoding is what keeps the refused-connection gates from depending on which
 * high ports happen to be free on the machine running them.
 */
export async function reserveDeadLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('gate expected the reserved dead port server to be listening on a TCP port')
  }
  const reservedPort = address.port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return reservedPort
}

/** A Resend base URL nothing answers on, so the SDK reports application_error with a null status code. */
export async function unreachableGateResendBaseUrl(): Promise<ResendBaseUrl> {
  return resendBaseUrlSchema.parse(`http://127.0.0.1:${await reserveDeadLoopbackPort()}`)
}
