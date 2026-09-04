import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import {
  emailTransportConfigSchema,
  type EmailTransportConfig,
} from '@hearthkit/email/email-contract'
import {
  authBaseUrlSchema,
  authRuntimeConfigSchema,
  authSecretSchema,
  minimumAuthPasswordLength,
  oauthClientIdSchema,
  oauthClientSecretSchema,
  type AuthBaseUrl,
  type AuthRuntimeConfig,
  type SocialAuthProviderName,
} from '../src/auth-contract.ts'

/**
 * The values every gate hands @hearthkit/auth: the runtime config, the email transport, and the
 * one-off addresses, names and slugs a run makes up. Opens no socket of its own beyond reserving a
 * dead port, so the gates that contact nothing can use it with no service running anywhere.
 */

/** A signing secret of the contract's minimum length; a secret, so finding it in a returned value proves a leak. */
export const gateAuthSecret = authSecretSchema.parse(
  'gate-auth-secret-that-must-never-be-echoed-0123456789',
)

/** The application origin every gate builds links against; nothing listens on it, because no gate makes an HTTP request to it. */
export const gateAuthBaseUrl: AuthBaseUrl = authBaseUrlSchema.parse('http://localhost:3000')

/** An OAuth client id; public by design, so the contract allows it to appear in a failure message. */
export const gateOauthClientId = oauthClientIdSchema.parse('gate-oauth-client-id')

/** An OAuth client secret; finding it in a returned value or a message proves a leak. */
export const gateOauthClientSecret = oauthClientSecretSchema.parse(
  'gate-oauth-client-secret-that-must-never-be-echoed',
)

/** The password every gate signs up with; a secret under the contract's rule, and never echoed in a failure reason. */
export const gateAuthPassword = 'gate-auth-password-that-must-never-be-echoed'

/** A password of the wrong value but a legal length, so a sign in gets past input validation and reaches Better Auth. */
export const gateWrongAuthPassword = 'gate-auth-wrong-password-9999'

/** The secret strings a returned value or a failure message may never contain, per the contract's secret rule. */
export const gateSecretsThatMustNeverLeak: readonly string[] = [
  String(gateAuthSecret),
  String(gateOauthClientSecret),
  gateAuthPassword,
]

/** EMAIL_FROM for every message a gate causes to be sent; a display-name sender, which is the harder half of email's rule. */
export const gateAuthEmailSender = 'Hearthkit Auth Gate <auth-gate@hearthkit.test>'

/** The bare mailbox inside gateAuthEmailSender, so a gate can compare it against what Mailpit parsed out of the From header. */
export const gateAuthEmailSenderAddress = 'auth-gate@hearthkit.test'

/** A run-unique id of lowercase letters and digits, short enough to fit inside a slug and a database name. */
export function uniqueGateAuthToken(): string {
  return randomUUID().replaceAll('-', '').slice(0, 10)
}

/** A recipient unique to this call, so a delivered message and a user row can only have come from this gate. */
export function uniqueGateAuthEmail(purpose: string): string {
  return `gate-${purpose}-${uniqueGateAuthToken()}@hearthkit.test`
}

/** A display name unique to this call, asserted back off the user record a sign up returns. */
export function uniqueGateAuthUserName(purpose: string): string {
  return `Gate ${purpose} ${uniqueGateAuthToken()}`
}

/** An organization display name unique to this call. */
export function uniqueGateOrganizationName(purpose: string): string {
  return `Gate Org ${purpose} ${uniqueGateAuthToken()}`
}

/** An organization slug unique to this call, in the lowercase kebab-case shape the contract's schema requires. */
export function uniqueGateOrganizationSlug(purpose: string): string {
  return `gate-${purpose}-${uniqueGateAuthToken()}`
}

/**
 * A product name unique to this call. It is what makes the magic link message findable: email's
 * magicLinkEmailTemplate builds the subject as "Sign in to {productName}", so a unique product name
 * gives the gate a subject no other message in the inbox can share.
 */
export function uniqueGateProductName(purpose: string): string {
  return `Gate ${purpose} ${uniqueGateAuthToken()}`
}

/** The subject email's shipped magic link template builds for a product name; restated here so the gate can look the message up. */
export function magicLinkSubjectForProductName(productName: string): string {
  return `Sign in to ${productName}`
}

/** A complete runtime config with no social providers, which is the ordinary local development case. */
export function gateAuthRuntimeConfig(): AuthRuntimeConfig {
  return authRuntimeConfigSchema.parse({
    authSecret: gateAuthSecret,
    authBaseUrl: gateAuthBaseUrl,
    socialAuthProviders: [],
  })
}

/** A complete runtime config carrying one social provider, for the gate that proves a provider is registered. */
export function gateAuthRuntimeConfigWithProvider(
  socialProviderName: SocialAuthProviderName,
): AuthRuntimeConfig {
  return authRuntimeConfigSchema.parse({
    authSecret: gateAuthSecret,
    authBaseUrl: gateAuthBaseUrl,
    socialAuthProviders: [
      {
        socialProviderName,
        oauthClientId: gateOauthClientId,
        oauthClientSecret: gateOauthClientSecret,
      },
    ],
  })
}

/** An SMTP transport aimed at whichever port the gate reserved: the throwaway Mailpit, or a dead port. */
export function gateAuthSmtpTransportConfig(smtpPortNumber: number): EmailTransportConfig {
  return emailTransportConfigSchema.parse({
    kind: 'smtp-email-transport',
    emailFrom: gateAuthEmailSender,
    smtpHostName: '127.0.0.1',
    smtpPortNumber,
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

/** A password one character shorter than the contract accepts, for the input validation gate. */
export const gateTooShortAuthPassword = 'x'.repeat(minimumAuthPasswordLength - 1)
