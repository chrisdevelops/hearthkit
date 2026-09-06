import type { EmailFailure, TransportMessageId } from '@hearthkit/email/email-contract'
import type { AuthServerInstance } from './auth-contract.ts'

/**
 * How the outcome of the magic link mail reaches requestMagicLinkSignIn.
 *
 * Better Auth's plugin awaits `sendMagicLink` inside the endpoint and then answers `{ status: true }`
 * whatever the callback did, so the send result is not on the value the endpoint returns. The
 * callback records it here instead, against the instance createAuthServerInstance built, and
 * requestMagicLinkSignIn takes it back out. Without that, a request against a dead SMTP server would
 * report success and the user would wait for mail that never comes.
 *
 * Keyed by recipient rather than kept as one "last outcome", so two requests in flight at once cannot
 * hand each other's answer back.
 */

/** What became of one magic link message: delivered, refused by the transport, or never attempted. */
export type MagicLinkEmailSendOutcome =
  | { kind: 'magic-link-email-sent'; transportMessageId: TransportMessageId }
  | { kind: 'magic-link-email-failed'; emailFailure: EmailFailure }
  | { kind: 'magic-link-email-not-attempted'; notAttemptedDetail: string }

/** The per-instance record the magic link callback writes to and requestMagicLinkSignIn reads from. */
export type MagicLinkEmailSendRecorder = {
  recordMagicLinkEmailOutcome: (recipient: string, outcome: MagicLinkEmailSendOutcome) => void
  takeMagicLinkEmailOutcome: (recipient: string) => MagicLinkEmailSendOutcome | undefined
}

const magicLinkEmailSendRecorders = new WeakMap<object, MagicLinkEmailSendRecorder>()

/** A fresh record, created before the Better Auth instance so the callback can close over it. */
export function createMagicLinkEmailSendRecorder(): MagicLinkEmailSendRecorder {
  const outcomesByRecipient = new Map<string, MagicLinkEmailSendOutcome[]>()

  return {
    recordMagicLinkEmailOutcome: (recipient, outcome) => {
      const queued = outcomesByRecipient.get(recipient) ?? []
      queued.push(outcome)
      outcomesByRecipient.set(recipient, queued)
    },
    takeMagicLinkEmailOutcome: (recipient) => {
      const queued = outcomesByRecipient.get(recipient)
      const outcome = queued?.shift()
      if (queued !== undefined && queued.length === 0) {
        outcomesByRecipient.delete(recipient)
      }
      return outcome
    },
  }
}

/** Associates a record with the instance it belongs to; the instance itself gains no extra property. */
export function registerMagicLinkEmailSendRecorder(
  authServerInstance: AuthServerInstance,
  recorder: MagicLinkEmailSendRecorder,
): void {
  magicLinkEmailSendRecorders.set(authServerInstance, recorder)
}

/** The record for an instance, or undefined when the instance was not built by createAuthServerInstance. */
export function readMagicLinkEmailSendRecorder(
  authServerInstance: AuthServerInstance,
): MagicLinkEmailSendRecorder | undefined {
  return magicLinkEmailSendRecorders.get(authServerInstance)
}
