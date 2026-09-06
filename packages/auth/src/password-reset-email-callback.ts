import {
  emailLinkUrlSchema,
  passwordResetEmailTemplate,
  sendTransactionalEmail,
} from '@hearthkit/email'
import type {
  EmailProductName,
  EmailTransportConfig,
  PasswordResetEmailProps,
} from '@hearthkit/email/email-contract'
import { authEmailSendFailedFailure } from './auth-failure-results.ts'

/**
 * The `sendResetPassword` callback. It is wired even though this package exports no reset wrapper,
 * because without it `email`'s password-reset template has no consumer anywhere and a user who
 * forgets a password is locked out permanently: an app reaches it through
 * `authBrowserClient.requestPasswordReset()`, which goes through the route handler.
 *
 * Unlike the magic link callback this one throws on an email failure, because no wrapper of this
 * package is waiting to turn a recorded outcome into a returned failure. The message starts with
 * this package's own send-failed prefix so the 500's log line is greppable.
 */

/** One password reset mail; Better Auth awaits this from POST /request-password-reset. */
export type PasswordResetEmailCallback = (data: {
  user: { email: string }
  url: string
}) => Promise<void>

/** Builds the callback for one server instance, closing over its transport and product name. */
export function createPasswordResetEmailCallback(options: {
  emailTransportConfig: EmailTransportConfig
  productName: EmailProductName | undefined
}): PasswordResetEmailCallback {
  return async ({ user, url }) => {
    const parsedResetUrl = emailLinkUrlSchema.safeParse(url)
    if (!parsedResetUrl.success) {
      throw new Error(
        'hearthkit auth email send failed: Better Auth built a password reset link that is not an http or https URL',
      )
    }

    const templateProps: PasswordResetEmailProps = {
      passwordResetUrl: parsedResetUrl.data,
      ...(options.productName === undefined ? {} : { productName: options.productName }),
    }

    const sent = await sendTransactionalEmail({
      emailTransportConfig: options.emailTransportConfig,
      emailTemplate: passwordResetEmailTemplate,
      templateProps,
      to: user.email,
    })
    if (sent.kind !== 'transactional-email-sent') {
      throw new Error(authEmailSendFailedFailure(sent).message)
    }
  }
}
