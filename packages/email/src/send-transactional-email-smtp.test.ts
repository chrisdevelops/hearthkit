import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  expectContractNumberExport,
  expectContractStringExport,
  expectEmailFailure,
  expectResultKind,
} from '../test-fixtures/email-gate-expectations.ts'
import {
  gateEmailExpiryMinutes,
  gateEmailProductName,
  gateEmailSenderAddress,
  gateMailpitSmtpHostName,
  gateMailpitSmtpPortNumber,
  gateMailpitTransportConfig,
  gateMailpitTransportConfigWithCredentials,
  gateSmtpTransportConfigForAddress,
  gateSmtpTransportTarget,
  nodemailerDefaultGreetingTimeoutMs,
  reserveDeadLoopbackPort,
  uniqueGatePasswordResetUrl,
  uniqueGateRecipientAddress,
  uniqueGateSignInUrl,
  uniqueGateSubject,
  unresolvableGateSmtpHostName,
} from '../test-fixtures/email-gate-transports.ts'
import { startGateSmtpImposterServer } from '../test-fixtures/gate-smtp-imposter-server.ts'
import { loadHearthkitEmailEntry } from '../test-fixtures/hearthkit-email-entry.ts'
import {
  clearMailpitInbox,
  findMailpitMessageBySubject,
  readMailpitMessageCount,
  rejectEveryMailpitRecipient,
  resetMailpitChaos,
  restoreMailpitToEmpty,
} from '../test-fixtures/mailpit-gate-inbox.ts'
import {
  emailTemplateNameSchema,
  magicLinkEmailPropsSchema,
  magicLinkEmailTemplateName,
  passwordResetEmailPropsSchema,
  sendTransactionalEmailResultSchema,
  smtpConnectionTimeoutMs,
  type MagicLinkEmailProps,
  type TransactionalEmailTemplate,
} from './email-contract.ts'

let deadPortNumber: number
let mailpitIsReachable = false

beforeAll(async () => {
  deadPortNumber = await reserveDeadLoopbackPort()
  await clearMailpitInbox()
  mailpitIsReachable = true
})

beforeEach(async () => {
  if (mailpitIsReachable) {
    await clearMailpitInbox()
  }
})

afterAll(async () => {
  // Skipped when setup never succeeded — Mailpit not running is the usual reason — so its own error
  // does not replace the one that explains the run.
  if (mailpitIsReachable) {
    await restoreMailpitToEmpty()
  }
})

describe('sendTransactionalEmail over SMTP', () => {
  it('delivers the magic link to Mailpit with the same subject and both body parts renderTransactionalEmail produced', async () => {
    const { sendTransactionalEmail, renderTransactionalEmail, magicLinkEmailTemplate } =
      await loadHearthkitEmailEntry()
    const signInUrl = uniqueGateSignInUrl()
    const to = String(uniqueGateRecipientAddress())
    const templateProps = magicLinkEmailPropsSchema.parse({
      signInUrl,
      productName: gateEmailProductName,
      expiryMinutes: gateEmailExpiryMinutes,
    })

    const rendered = expectResultKind(
      await renderTransactionalEmail({ emailTemplate: magicLinkEmailTemplate, templateProps }),
      'transactional-email-rendered',
    )

    const result = await sendTransactionalEmail({
      emailTransportConfig: gateMailpitTransportConfig(),
      emailTemplate: magicLinkEmailTemplate,
      templateProps,
      to,
    })
    sendTransactionalEmailResultSchema.parse(result)
    const sent = expectResultKind(result, 'transactional-email-sent')

    expect(String(sent.emailTemplateName)).toBe(
      expectContractStringExport(magicLinkEmailTemplateName, 'magicLinkEmailTemplateName'),
    )
    expect(String(sent.to)).toBe(to)
    // Sending renders through the same function, so the two can never disagree.
    expect(String(sent.subject)).toBe(String(rendered.subject))

    const delivered = await findMailpitMessageBySubject(String(rendered.subject))
    expect(delivered.To.map((address) => address.Address)).toEqual([to])
    expect(delivered.From.Address).toBe(gateEmailSenderAddress)
    // Every message is multipart: an HTML part and a readable text part, always both.
    expect(delivered.HTML).toContain(String(signInUrl))
    expect(delivered.HTML).toContain(`href="${String(signInUrl)}"`)
    expect(delivered.Text).toContain(String(signInUrl))
    expect(delivered.Text).toContain(String(gateEmailProductName))
    expect(delivered.Text).toContain(String(gateEmailExpiryMinutes))
    // transportMessageId is nodemailer's RFC Message-ID, which Mailpit reports without its angle
    // brackets. Correlating on it proves the returned id names the message that arrived.
    expect(String(sent.transportMessageId)).toContain(delivered.MessageID)
    expect(await readMailpitMessageCount()).toBe(1)
  })

  it('delivers the password reset with the subject the caller supplied instead of the template default', async () => {
    const { sendTransactionalEmail, passwordResetEmailTemplate } = await loadHearthkitEmailEntry()
    const passwordResetUrl = uniqueGatePasswordResetUrl()
    const to = String(uniqueGateRecipientAddress())
    const overrideSubject = uniqueGateSubject('password reset override')

    const result = await sendTransactionalEmail({
      emailTransportConfig: gateMailpitTransportConfig(),
      emailTemplate: passwordResetEmailTemplate,
      templateProps: passwordResetEmailPropsSchema.parse({ passwordResetUrl }),
      to,
      subject: overrideSubject,
    })
    sendTransactionalEmailResultSchema.parse(result)
    const sent = expectResultKind(result, 'transactional-email-sent')
    expect(String(sent.subject)).toBe(String(overrideSubject))

    const delivered = await findMailpitMessageBySubject(String(overrideSubject))
    expect(delivered.Subject).toBe(String(overrideSubject))
    expect(delivered.HTML).toContain(String(passwordResetUrl))
    expect(delivered.Text).toContain(String(passwordResetUrl))
  })

  it('returns email-recipient-invalid before the transport is contacted, truncating a hostile value to 320 characters', async () => {
    const { sendTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const templateProps = magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() })
    // Aimed at a port nothing answers on: an implementation that validated after connecting would
    // return email-transport-unreachable here instead, which is the wrong diagnosis for a bad address.
    const deadPortTransport = gateSmtpTransportConfigForAddress(
      gateMailpitSmtpHostName,
      deadPortNumber,
    )

    const invalidRecipients = [
      'not-an-email',
      '',
      // A display name is a sender shape, not a recipient shape.
      'Gate Person <gate@hearthkit.test>',
      // Two addresses in one string: one call sends to exactly one person.
      'one@hearthkit.test, two@hearthkit.test',
    ]
    for (const invalidRecipient of invalidRecipients) {
      const result = await sendTransactionalEmail({
        emailTransportConfig: deadPortTransport,
        emailTemplate: magicLinkEmailTemplate,
        templateProps,
        to: invalidRecipient,
      })
      sendTransactionalEmailResultSchema.parse(result)
      const failure = expectEmailFailure(result, 'email-recipient-invalid')
      expect(failure.recipientValue, invalidRecipient).toBe(invalidRecipient)
    }

    const hostileRecipient = 'g'.repeat(400)
    const hostileFailure = expectEmailFailure(
      await sendTransactionalEmail({
        emailTransportConfig: deadPortTransport,
        emailTemplate: magicLinkEmailTemplate,
        templateProps,
        to: hostileRecipient,
      }),
      'email-recipient-invalid',
    )
    expect(hostileFailure.recipientValue).toHaveLength(320)
    expect(hostileFailure.recipientValue).toBe(hostileRecipient.slice(0, 320))

    // The same refusal against a server that is up, proving nothing was handed to it.
    expectEmailFailure(
      await sendTransactionalEmail({
        emailTransportConfig: gateMailpitTransportConfig(),
        emailTemplate: magicLinkEmailTemplate,
        templateProps,
        to: 'not-an-email',
      }),
      'email-recipient-invalid',
    )
    expect(await readMailpitMessageCount()).toBe(0)
  })

  it('returns email-template-render-failed from a send, before the transport is contacted', async () => {
    const { sendTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const throwingTemplate: TransactionalEmailTemplate<MagicLinkEmailProps> = {
      ...magicLinkEmailTemplate,
      emailTemplateName: emailTemplateNameSchema.parse('gate-throwing-send-template'),
      buildEmailElement: () => {
        throw new Error('gate template exploded while building its element')
      },
    }
    const templateProps = magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() })
    const to = String(uniqueGateRecipientAddress())

    const deadPortFailure = expectEmailFailure(
      await sendTransactionalEmail({
        emailTransportConfig: gateSmtpTransportConfigForAddress(
          gateMailpitSmtpHostName,
          deadPortNumber,
        ),
        emailTemplate: throwingTemplate,
        templateProps,
        to,
      }),
      'email-template-render-failed',
    )
    expect(String(deadPortFailure.emailTemplateName)).toBe('gate-throwing-send-template')

    expectEmailFailure(
      await sendTransactionalEmail({
        emailTransportConfig: gateMailpitTransportConfig(),
        emailTemplate: throwingTemplate,
        templateProps,
        to,
      }),
      'email-template-render-failed',
    )
    expect(await readMailpitMessageCount()).toBe(0)
  })

  it('returns email-transport-unreachable naming host:port when the connection is refused and when the name does not resolve', async () => {
    const { sendTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const templateProps = magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() })
    const to = String(uniqueGateRecipientAddress())

    const unreachableCases = [
      {
        smtpHostName: gateMailpitSmtpHostName,
        smtpPortNumber: deadPortNumber,
        transportErrorCode: 'ESOCKET',
      },
      {
        smtpHostName: unresolvableGateSmtpHostName,
        smtpPortNumber: gateMailpitSmtpPortNumber,
        transportErrorCode: 'EDNS',
      },
    ] as const

    for (const unreachableCase of unreachableCases) {
      const result = await sendTransactionalEmail({
        emailTransportConfig: gateSmtpTransportConfigForAddress(
          unreachableCase.smtpHostName,
          unreachableCase.smtpPortNumber,
        ),
        emailTemplate: magicLinkEmailTemplate,
        templateProps,
        to,
      })
      sendTransactionalEmailResultSchema.parse(result)
      const failure = expectEmailFailure(result, 'email-transport-unreachable')

      expect(failure.emailTransportName).toBe('smtp')
      expect(failure.transportErrorCode).toBe(unreachableCase.transportErrorCode)
      expect(failure.transportTarget).toBe(
        gateSmtpTransportTarget(unreachableCase.smtpHostName, unreachableCase.smtpPortNumber),
      )
    }
  })

  it('gives up on a server that accepts the connection and never greets, well before nodemailer default of thirty seconds', async () => {
    const { sendTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const silentServer = await startGateSmtpImposterServer('never-greets')
    const greetingTimeoutMs = expectContractNumberExport(
      smtpConnectionTimeoutMs,
      'smtpConnectionTimeoutMs',
    )

    try {
      const startedAt = Date.now()
      const failure = expectEmailFailure(
        await sendTransactionalEmail({
          emailTransportConfig: gateSmtpTransportConfigForAddress(
            silentServer.smtpHostName,
            silentServer.smtpPortNumber,
          ),
          emailTemplate: magicLinkEmailTemplate,
          templateProps: magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() }),
          to: String(uniqueGateRecipientAddress()),
        }),
        'email-transport-unreachable',
      )
      const elapsedMs = Date.now() - startedAt

      expect(failure.transportErrorCode).toBe('ETIMEDOUT')
      // A stalled relay must not hold a web request open for two minutes, which is what nodemailer's
      // own defaults would allow. Leaving the default in place fails on the upper bound.
      expect(elapsedMs).toBeLessThan(nodemailerDefaultGreetingTimeoutMs)
      expect(elapsedMs).toBeGreaterThanOrEqual(greetingTimeoutMs - 2_000)
    } finally {
      await silentServer.closeGateSmtpImposterServer()
    }
  })

  it('refuses to send a password over a connection that offers no STARTTLS, while the same send without credentials is delivered', async () => {
    const { sendTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const templateProps = magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() })
    const to = String(uniqueGateRecipientAddress())

    // Mailpit advertises no STARTTLS capability, so requireTLS cannot be satisfied and nodemailer
    // aborts the session before AUTH. expectEmailFailure also proves the password did not travel
    // back inside the failure.
    const refused = await sendTransactionalEmail({
      emailTransportConfig: gateMailpitTransportConfigWithCredentials(),
      emailTemplate: magicLinkEmailTemplate,
      templateProps,
      to,
    })
    sendTransactionalEmailResultSchema.parse(refused)
    const failure = expectEmailFailure(refused, 'email-transport-unreachable')
    expect(failure.emailTransportName).toBe('smtp')
    expect(failure.transportErrorCode).toBe('ETLS')
    expect(failure.transportTarget).toBe(
      gateSmtpTransportTarget(gateMailpitSmtpHostName, gateMailpitSmtpPortNumber),
    )
    expect(await readMailpitMessageCount()).toBe(0)

    // The negative control, and the reason the gate above is load-bearing: the identical send with no
    // credentials configured reaches the same server and is accepted. An implementation that drops
    // requireTLS makes the first send succeed too, and fails on the kind assertion.
    const delivered = await sendTransactionalEmail({
      emailTransportConfig: gateMailpitTransportConfig(),
      emailTemplate: magicLinkEmailTemplate,
      templateProps,
      to,
    })
    const sent = expectResultKind(delivered, 'transactional-email-sent')
    expect(await readMailpitMessageCount()).toBe(1)
    const inbox = await findMailpitMessageBySubject(String(sent.subject))
    expect(inbox.To.map((address) => address.Address)).toEqual([to])
  })

  it('returns email-transport-rejected with the SMTP status when the server refuses the recipient', async () => {
    const { sendTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const templateProps = magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() })
    const to = String(uniqueGateRecipientAddress())

    await rejectEveryMailpitRecipient()
    try {
      const result = await sendTransactionalEmail({
        emailTransportConfig: gateMailpitTransportConfig(),
        emailTemplate: magicLinkEmailTemplate,
        templateProps,
        to,
      })
      sendTransactionalEmailResultSchema.parse(result)
      const failure = expectEmailFailure(result, 'email-transport-rejected')

      expect(failure.emailTransportName).toBe('smtp')
      expect(failure.transportErrorCode).toBe('EENVELOPE')
      expect(failure.transportStatusCode).toBe(451)
      expect(await readMailpitMessageCount()).toBe(0)
    } finally {
      await resetMailpitChaos()
    }

    // The control: with the server no longer refusing, the identical send is accepted, so the gate
    // above measured a rejection rather than a transport that never worked.
    expectResultKind(
      await sendTransactionalEmail({
        emailTransportConfig: gateMailpitTransportConfig(),
        emailTemplate: magicLinkEmailTemplate,
        templateProps,
        to,
      }),
      'transactional-email-sent',
    )
    expect(await readMailpitMessageCount()).toBe(1)
  })

  it('maps a transport error the contract does not name to email-send-failed, and returns every failure as a value rather than throwing', async () => {
    const { sendTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const templateProps = magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() })
    const to = String(uniqueGateRecipientAddress())
    // An HTTP status line is a valid TCP answer and an invalid SMTP greeting, which nodemailer reports
    // as EPROTOCOL — a code the contract's signal table does not list, so it belongs in the catch-all.
    const imposterServer = await startGateSmtpImposterServer('garbage-greeting')
    const imposterTransport = gateSmtpTransportConfigForAddress(
      imposterServer.smtpHostName,
      imposterServer.smtpPortNumber,
    )
    const throwingTemplate: TransactionalEmailTemplate<MagicLinkEmailProps> = {
      ...magicLinkEmailTemplate,
      emailTemplateName: emailTemplateNameSchema.parse('gate-never-throws-template'),
      buildEmailElement: () => {
        throw new Error('gate template exploded while building its element')
      },
    }

    try {
      const result = await sendTransactionalEmail({
        emailTransportConfig: imposterTransport,
        emailTemplate: magicLinkEmailTemplate,
        templateProps,
        to,
      })
      sendTransactionalEmailResultSchema.parse(result)
      const failure = expectEmailFailure(result, 'email-send-failed')
      expect(failure.emailTransportName).toBe('smtp')
      expect(failure.sendFailureDetail.length).toBeGreaterThan(0)

      // One producer for each of the four failure modes a send can reach without Chaos. Fulfilling
      // with anything at all is not enough: each value must also be the right failure, so this cannot
      // go green against a function that resolves with a stub.
      const settled = await Promise.allSettled([
        sendTransactionalEmail({
          emailTransportConfig: gateMailpitTransportConfig(),
          emailTemplate: throwingTemplate,
          templateProps,
          to,
        }),
        sendTransactionalEmail({
          emailTransportConfig: gateMailpitTransportConfig(),
          emailTemplate: magicLinkEmailTemplate,
          templateProps,
          to: 'not-an-email',
        }),
        sendTransactionalEmail({
          emailTransportConfig: gateSmtpTransportConfigForAddress(
            gateMailpitSmtpHostName,
            deadPortNumber,
          ),
          emailTemplate: magicLinkEmailTemplate,
          templateProps,
          to,
        }),
        sendTransactionalEmail({
          emailTransportConfig: imposterTransport,
          emailTemplate: magicLinkEmailTemplate,
          templateProps,
          to,
        }),
      ])
      const expectedKinds = [
        'email-template-render-failed',
        'email-recipient-invalid',
        'email-transport-unreachable',
        'email-send-failed',
      ] as const

      for (const [index, outcome] of settled.entries()) {
        expect(
          outcome.status,
          `a send rejected instead of returning a failure: ${outcome.status === 'rejected' ? String(outcome.reason) : ''}`,
        ).toBe('fulfilled')
        if (outcome.status === 'fulfilled') {
          expectEmailFailure(outcome.value, expectedKinds[index] ?? 'email-send-failed')
        }
      }
      expect(await readMailpitMessageCount()).toBe(0)
    } finally {
      await imposterServer.closeGateSmtpImposterServer()
    }
  })
})
