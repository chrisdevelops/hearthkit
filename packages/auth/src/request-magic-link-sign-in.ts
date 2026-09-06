import {
  authUserEmailSchema,
  requestMagicLinkSignInOptionsSchema,
  type RequestMagicLinkSignInOptions,
  type RequestMagicLinkSignInResult,
} from './auth-contract.ts'
import {
  authEmailSendFailedFailure,
  authInputInvalidFailure,
  authRequestFailedFailure,
} from './auth-failure-results.ts'
import { readAuthServerApiEndpoint } from './auth-server-api-endpoint.ts'
import { readMagicLinkEmailSendRecorder } from './magic-link-email-send-record.ts'
import { thrownAuthErrorToFailure } from './thrown-auth-error-failure.ts'

/**
 * Sends the one-time sign-in link through @hearthkit/email. The link itself is never returned: it is
 * a single-use sign-in credential and a result value gets logged.
 *
 * An address with no account is still reported as sent. Better Auth creates the user on
 * verification, so there is nothing to leak, and reporting "no such user" here would turn the
 * endpoint into a user-enumeration oracle.
 *
 * `headers` is passed even though nothing about this call is session-scoped: the endpoint is
 * declared `requireHeaders`, and omitting it throws APIError 400 VALIDATION_ERROR with the message
 * `Headers is required`.
 */
export async function requestMagicLinkSignIn(
  options: RequestMagicLinkSignInOptions,
): Promise<RequestMagicLinkSignInResult> {
  const parsedEmail = authUserEmailSchema.safeParse(options.email)
  if (!parsedEmail.success) {
    return authInputInvalidFailure('email')
  }
  // Parsed through the contract's own option schema rather than a second copy of the rule, so the
  // shape a callback URL must have is stated once.
  const parsedCallbackUrl = requestMagicLinkSignInOptionsSchema.shape.callbackUrl.safeParse(
    options.callbackUrl,
  )
  if (!parsedCallbackUrl.success) {
    return authInputInvalidFailure('callback-url')
  }

  const signInMagicLink = readAuthServerApiEndpoint(options.authServerInstance, 'signInMagicLink')
  if (signInMagicLink === undefined) {
    return authRequestFailedFailure({
      authFailureDetail: 'this auth server instance carries no signInMagicLink endpoint',
    })
  }
  const recorder = readMagicLinkEmailSendRecorder(options.authServerInstance)
  if (recorder === undefined) {
    return authRequestFailedFailure({
      authFailureDetail:
        'this auth server instance was not built by createAuthServerInstance, so no magic link mail is wired to it',
    })
  }

  const recipient = String(parsedEmail.data)
  try {
    await signInMagicLink({
      body: {
        email: recipient,
        ...(parsedCallbackUrl.data === undefined ? {} : { callbackURL: parsedCallbackUrl.data }),
      },
      headers: new Headers(),
    })
  } catch (thrownValue) {
    return thrownAuthErrorToFailure(thrownValue)
  }

  // The endpoint answers `{ status: true }` whatever the mail did, so the outcome has to come off the
  // record the callback wrote. Without this, a request against a dead SMTP server would report
  // success and the user would wait for mail that never comes.
  const outcome = recorder.takeMagicLinkEmailOutcome(recipient)
  if (outcome === undefined) {
    return authRequestFailedFailure({
      authFailureDetail: 'Better Auth accepted the magic link request without sending the message',
    })
  }
  if (outcome.kind === 'magic-link-email-failed') {
    return authEmailSendFailedFailure(outcome.emailFailure)
  }
  if (outcome.kind === 'magic-link-email-not-attempted') {
    return authRequestFailedFailure({ authFailureDetail: outcome.notAttemptedDetail })
  }

  return {
    kind: 'auth-magic-link-sent',
    to: parsedEmail.data,
    transportMessageId: outcome.transportMessageId,
  }
}
