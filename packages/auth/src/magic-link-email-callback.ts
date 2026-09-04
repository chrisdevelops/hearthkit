import {
  emailLinkUrlSchema,
  magicLinkEmailTemplate,
  sendTransactionalEmail,
} from '@hearthkit/email'
import type {
  EmailProductName,
  EmailTransportConfig,
  MagicLinkEmailProps,
} from '@hearthkit/email/email-contract'
import type { MagicLinkEmailSendRecorder } from './magic-link-email-send-record.ts'

/**
 * The `sendMagicLink` callback Better Auth's plugin awaits. It sends email's shipped
 * `magic-link-sign-in` template and records what happened, rather than throwing: the endpoint would
 * turn a throw into an opaque 500, while the recorded outcome lets requestMagicLinkSignIn answer
 * auth-email-send-failed with the email package's own cause attached.
 *
 * No second, competing template is defined here.
 */

/** One magic link mail; the plugin awaits this, so the message is sent before the endpoint answers. */
export type MagicLinkEmailCallback = (data: { email: string; url: string }) => Promise<void>

/**
 * How many whole minutes to print, or nothing at all. email's expiry rule has a floor of one whole
 * minute, so an expiry under sixty seconds has no representable value and the prop is omitted, which
 * the template already handles by reading generically. Passing 0 would make every send of a
 * short-lived link fail as a render error instead.
 */
function magicLinkExpiryMinutes(magicLinkExpirySeconds: number): number | undefined {
  return magicLinkExpirySeconds >= 60 ? Math.floor(magicLinkExpirySeconds / 60) : undefined
}

/** Builds the callback for one server instance, closing over its transport, copy and send record. */
export function createMagicLinkEmailCallback(options: {
  emailTransportConfig: EmailTransportConfig
  productName: EmailProductName | undefined
  magicLinkExpirySeconds: number
  recorder: MagicLinkEmailSendRecorder
}): MagicLinkEmailCallback {
  const expiryMinutes = magicLinkExpiryMinutes(options.magicLinkExpirySeconds)

  return async ({ email, url }) => {
    const parsedSignInUrl = emailLinkUrlSchema.safeParse(url)
    if (!parsedSignInUrl.success) {
      options.recorder.recordMagicLinkEmailOutcome(email, {
        kind: 'magic-link-email-not-attempted',
        notAttemptedDetail: 'Better Auth built a sign-in link that is not an http or https URL',
      })
      return
    }

    const templateProps: MagicLinkEmailProps = {
      signInUrl: parsedSignInUrl.data,
      ...(options.productName === undefined ? {} : { productName: options.productName }),
      ...(expiryMinutes === undefined ? {} : { expiryMinutes }),
    }

    const sent = await sendTransactionalEmail({
      emailTransportConfig: options.emailTransportConfig,
      emailTemplate: magicLinkEmailTemplate,
      templateProps,
      to: email,
    })

    options.recorder.recordMagicLinkEmailOutcome(
      email,
      sent.kind === 'transactional-email-sent'
        ? { kind: 'magic-link-email-sent', transportMessageId: sent.transportMessageId }
        : { kind: 'magic-link-email-failed', emailFailure: sent },
    )
  }
}
