import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  expectEmailFailure,
  expectResultKind,
  expectValueCarriesNoSecret,
} from '../test-fixtures/email-gate-expectations.ts'
import {
  gateEmailProductName,
  gateEmailSender,
  gateResendApiKey,
  gateResendTransportConfig,
  unreachableGateResendBaseUrl,
  uniqueGateRecipientAddress,
  uniqueGateSignInUrl,
} from '../test-fixtures/email-gate-transports.ts'
import {
  startGateResendApiServer,
  type GateResendApiServer,
  type GateResendRequest,
} from '../test-fixtures/gate-resend-api-server.ts'
import { loadHearthkitEmailEntry } from '../test-fixtures/hearthkit-email-entry.ts'
import { magicLinkEmailPropsSchema, sendTransactionalEmailResultSchema } from './email-contract.ts'

let resendApiServer: GateResendApiServer

beforeAll(async () => {
  resendApiServer = await startGateResendApiServer()
})

afterAll(async () => {
  await resendApiServer?.closeGateResendApiServer()
})

// Resend accepts one recipient as a bare string or as a one-element array; the contract cares only
// that exactly one address is on the wire, so both shapes are read the same way.
function recipientsInResendRequest(request: GateResendRequest): string[] {
  const recipients = request.jsonBody.to
  if (typeof recipients === 'string') {
    return [recipients]
  }
  return Array.isArray(recipients) ? recipients.map((recipient) => String(recipient)) : []
}

function onlyResendRequest(requests: GateResendRequest[]): GateResendRequest {
  const [request] = requests
  if (requests.length !== 1 || request === undefined) {
    throw new Error(`gate expected exactly one request to the Resend API, saw ${requests.length}`)
  }
  return request
}

describe('sendTransactionalEmail over Resend', () => {
  it('posts both body parts to the Resend API with the configured key and returns the id it answered with', async () => {
    const { sendTransactionalEmail, renderTransactionalEmail, magicLinkEmailTemplate } =
      await loadHearthkitEmailEntry()
    const acceptedEmailId = '3d1a4e8c-7f0b-4c21-9a55-6b0f2c9d84ae'
    resendApiServer.setGateResendResponse({ kind: 'gate-resend-accepts', emailId: acceptedEmailId })

    const signInUrl = uniqueGateSignInUrl()
    const to = String(uniqueGateRecipientAddress())
    const templateProps = magicLinkEmailPropsSchema.parse({
      signInUrl,
      productName: gateEmailProductName,
    })
    const rendered = expectResultKind(
      await renderTransactionalEmail({ emailTemplate: magicLinkEmailTemplate, templateProps }),
      'transactional-email-rendered',
    )

    const result = await sendTransactionalEmail({
      emailTransportConfig: gateResendTransportConfig(resendApiServer.resendBaseUrl),
      emailTemplate: magicLinkEmailTemplate,
      templateProps,
      to,
    })
    sendTransactionalEmailResultSchema.parse(result)
    expectValueCarriesNoSecret(result)
    const sent = expectResultKind(result, 'transactional-email-sent')

    expect(String(sent.to)).toBe(to)
    expect(String(sent.subject)).toBe(String(rendered.subject))
    // Opaque and transport-shaped: a UUID here, an RFC Message-ID over SMTP.
    expect(String(sent.transportMessageId)).toBe(acceptedEmailId)

    const request = onlyResendRequest(resendApiServer.takeGateResendRequests())
    expect(request.method).toBe('POST')
    expect(request.requestPath).toBe('/emails')
    // The key is passed to the constructor explicitly, never read from the ambient environment.
    expect(request.authorizationHeader).toBe(`Bearer ${String(gateResendApiKey)}`)
    // Proves the real SDK made the call rather than a hand-rolled fetch standing in for it.
    expect(request.userAgentHeader).toContain('resend-node')

    for (const requiredField of ['from', 'to', 'subject', 'html', 'text']) {
      expect(Object.keys(request.jsonBody), requiredField).toContain(requiredField)
    }
    expect(recipientsInResendRequest(request)).toEqual([to])
    expect(request.jsonBody.from).toBe(String(gateEmailSender))
    expect(request.jsonBody.subject).toBe(String(rendered.subject))
    expect(String(request.jsonBody.html)).toContain(String(signInUrl))
    expect(String(request.jsonBody.text)).toContain(String(signInUrl))
    expect(String(request.jsonBody.text)).not.toContain('<!DOCTYPE')
  })

  it('returns email-transport-rejected carrying Resend own error name and status when the API refuses the message', async () => {
    const { sendTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    resendApiServer.setGateResendResponse({
      kind: 'gate-resend-rejects',
      httpStatusCode: 422,
      errorName: 'validation_error',
      errorMessage: 'gate forced a validation error',
    })

    // The SDK returns this as { data: null, error } rather than throwing it, so an implementation that
    // only wraps the call in a catch never sees it and returns a success instead.
    const result = await sendTransactionalEmail({
      emailTransportConfig: gateResendTransportConfig(resendApiServer.resendBaseUrl),
      emailTemplate: magicLinkEmailTemplate,
      templateProps: magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() }),
      to: String(uniqueGateRecipientAddress()),
    })
    sendTransactionalEmailResultSchema.parse(result)
    const failure = expectEmailFailure(result, 'email-transport-rejected')

    expect(failure.emailTransportName).toBe('resend')
    expect(failure.transportErrorCode).toBe('validation_error')
    expect(failure.transportStatusCode).toBe(422)
    expect(onlyResendRequest(resendApiServer.takeGateResendRequests()).requestPath).toBe('/emails')
  })

  it('returns email-transport-unreachable naming the base URL when nothing answers at the Resend origin', async () => {
    const { sendTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const unreachableBaseUrl = await unreachableGateResendBaseUrl()

    const result = await sendTransactionalEmail({
      emailTransportConfig: gateResendTransportConfig(unreachableBaseUrl),
      emailTemplate: magicLinkEmailTemplate,
      templateProps: magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() }),
      to: String(uniqueGateRecipientAddress()),
    })
    sendTransactionalEmailResultSchema.parse(result)
    const failure = expectEmailFailure(result, 'email-transport-unreachable')

    expect(failure.emailTransportName).toBe('resend')
    // application_error with a null status code is the one Resend error that means "never arrived".
    expect(failure.transportErrorCode).toBe('application_error')
    expect(failure.transportTarget).toContain(String(unreachableBaseUrl))
    expect(resendApiServer.takeGateResendRequests()).toEqual([])
  })
})
