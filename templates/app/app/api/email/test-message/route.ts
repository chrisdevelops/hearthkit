import { sendTransactionalEmail } from '@hearthkit/email'
import { appEmailTestTemplate } from '../../../../app-email-test-template.tsx'
import { resolveAppEmailTransport } from '../../../../app-email-transport.ts'

/**
 * Sends one templated test message to one recipient.
 *
 * A non-2xx answer carries `@hearthkit/email`'s own message unchanged, because that message names the
 * cause — an unreachable SMTP port, a rejected credential, a half-configured transport — and rewording
 * it here would lose the prefix an operator greps for. Nothing about the app's own configuration is
 * echoed: the body is what somebody pastes into a ticket.
 */

/** Never prerendered: `next build` runs with an empty environment and this handler reads config. */
export const dynamic = 'force-dynamic'

/** True for a JSON object body, which is the only shape this route reads fields out of. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Every failure @hearthkit/email can return, mapped to what it means over HTTP. A missing or
// malformed variable is this server's fault, an unreachable or rejecting transport is the next hop's,
// and only the recipient is the caller's.
const testMessageStatusByFailureKind: Readonly<Record<string, number>> = {
  'email-recipient-invalid': 400,
  'email-transport-config-incomplete': 500,
  'email-template-render-failed': 500,
  'email-transport-unreachable': 502,
  'email-transport-rejected': 502,
  'email-send-failed': 502,
}

/** Sends the test message, or answers the owning package's own failure with its message unchanged. */
export async function POST(request: Request): Promise<Response> {
  let requestBody: unknown
  try {
    requestBody = await request.json()
  } catch {
    return Response.json({ message: 'the request body was not JSON' }, { status: 400 })
  }
  if (!isJsonObject(requestBody)) {
    return Response.json({ message: 'the request body was not a JSON object' }, { status: 400 })
  }

  const recipientEmailAddress = requestBody.recipientEmailAddress
  if (typeof recipientEmailAddress !== 'string' || recipientEmailAddress === '') {
    return Response.json({ message: 'recipientEmailAddress is required' }, { status: 400 })
  }

  const transport = resolveAppEmailTransport()
  if (transport.kind !== 'email-transport-config-resolved') {
    return Response.json(transport, {
      status: testMessageStatusByFailureKind[transport.kind] ?? 500,
    })
  }

  const result = await sendTransactionalEmail({
    emailTransportConfig: transport.emailTransportConfig,
    emailTemplate: appEmailTestTemplate,
    templateProps: { recipientEmailAddress, sentAtIso: new Date().toISOString() },
    to: recipientEmailAddress,
  })

  if (result.kind !== 'transactional-email-sent') {
    return Response.json(result, { status: testMessageStatusByFailureKind[result.kind] ?? 502 })
  }
  return Response.json(result, { status: 200 })
}
