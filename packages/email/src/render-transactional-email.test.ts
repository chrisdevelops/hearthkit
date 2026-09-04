import { describe, expect, it } from 'vitest'
import {
  countStringOccurrences,
  expectContractNumberExport,
  expectContractStringExport,
  expectEmailFailure,
  expectResultKind,
} from '../test-fixtures/email-gate-expectations.ts'
import {
  gateEmailExpiryMinutes,
  gateEmailProductName,
  uniqueGateMultiParameterSignInUrl,
  uniqueGatePasswordResetUrl,
  uniqueGateSignInUrl,
  uniqueGateSubject,
} from '../test-fixtures/email-gate-transports.ts'
import { loadHearthkitEmailEntry } from '../test-fixtures/hearthkit-email-entry.ts'
import {
  emailTemplateNameSchema,
  magicLinkEmailPropsSchema,
  magicLinkEmailTemplateName,
  maximumEmailSubjectLength,
  passwordResetEmailPropsSchema,
  passwordResetEmailTemplateName,
  renderTransactionalEmailResultSchema,
  unknownEmailTemplateName,
  type EmailTemplateName,
  type MagicLinkEmailProps,
  type TransactionalEmailTemplate,
} from './email-contract.ts'

describe('renderTransactionalEmail', () => {
  it('renders magicLinkEmailTemplate into an HTML document and readable text that both carry the sign-in URL verbatim', async () => {
    const { renderTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const signInUrl = uniqueGateSignInUrl()

    const genericResult = await renderTransactionalEmail({
      emailTemplate: magicLinkEmailTemplate,
      templateProps: magicLinkEmailPropsSchema.parse({ signInUrl }),
    })
    renderTransactionalEmailResultSchema.parse(genericResult)
    const generic = expectResultKind(genericResult, 'transactional-email-rendered')

    expect(String(generic.emailTemplateName)).toBe(
      expectContractStringExport(magicLinkEmailTemplateName, 'magicLinkEmailTemplateName'),
    )
    // A single-parameter URL has nothing to escape, so it is verbatim in both parts. That is exactly
    // what hides the multi-parameter defect, which the next gate pins; auth reads the text part.
    expect(generic.htmlBody).toContain(String(signInUrl))
    expect(generic.textBody).toContain(String(signInUrl))
    // Clickable as a button and readable as text, so a client that strips buttons still lets a person
    // copy the link: the URL is inside an href and appears at least once more outside it.
    expect(generic.htmlBody).toContain(`href="${String(signInUrl)}"`)
    expect(countStringOccurrences(generic.htmlBody, String(signInUrl))).toBeGreaterThanOrEqual(2)

    expect(generic.htmlBody).toContain('<!DOCTYPE html')
    expect(generic.htmlBody).toContain('XHTML')
    expect(generic.htmlBody).toContain('</html>')
    expect(generic.textBody).not.toContain('<!DOCTYPE')
    expect(generic.textBody).not.toContain('</html>')

    // Omitted, the copy and the subject read generically, so auth can send working mail without
    // hearthkit inventing a product-name environment variable for it.
    expect(String(generic.subject)).not.toContain(String(gateEmailProductName))
    expect(generic.textBody).not.toContain(String(gateEmailProductName))
    expect(generic.textBody).not.toContain(String(gateEmailExpiryMinutes))

    const specificResult = await renderTransactionalEmail({
      emailTemplate: magicLinkEmailTemplate,
      templateProps: magicLinkEmailPropsSchema.parse({
        signInUrl,
        productName: gateEmailProductName,
        expiryMinutes: gateEmailExpiryMinutes,
      }),
    })
    renderTransactionalEmailResultSchema.parse(specificResult)
    const specific = expectResultKind(specificResult, 'transactional-email-rendered')

    expect(String(specific.subject)).toContain(String(gateEmailProductName))
    expect(String(specific.subject)).not.toBe(String(generic.subject))
    expect(specific.htmlBody).toContain(String(gateEmailProductName))
    expect(specific.textBody).toContain(String(gateEmailProductName))
    expect(specific.textBody).toContain(String(gateEmailExpiryMinutes))
    expect(specific.htmlBody).toContain(String(signInUrl))
    expect(specific.textBody).toContain(String(signInUrl))
  })

  it('carries a two-parameter URL verbatim in the text part and HTML-escaped in the HTML part, with no other transformation', async () => {
    const { renderTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const signInUrl = uniqueGateMultiParameterSignInUrl()
    const signInUrlText = String(signInUrl)
    // The one transformation template promise 1 allows. Spelled out here rather than hidden in a
    // fixture, because the escaped form is the thing under test.
    const htmlEscapedSignInUrl = signInUrlText.replaceAll('&', '&amp;')

    const result = await renderTransactionalEmail({
      emailTemplate: magicLinkEmailTemplate,
      templateProps: magicLinkEmailPropsSchema.parse({ signInUrl }),
    })
    renderTransactionalEmailResultSchema.parse(result)
    const rendered = expectResultKind(result, 'transactional-email-rendered')

    // The reliable extraction point, and the one auth reads. Byte-identical and on one line, even
    // though this URL is longer than the plain text renderer's wrap width.
    expect(rendered.textBody).toContain(signInUrlText)
    expect(rendered.textBody).not.toContain('&amp;')

    // The negative half, which is what makes this gate load-bearing: a positive-only check is also
    // satisfied by an implementation that shortened the link or wrapped it in a tracking redirect,
    // because neither of those leaves the raw form in the HTML either.
    expect(rendered.htmlBody).not.toContain(signInUrlText)
    expect(rendered.htmlBody).toContain(`href="${htmlEscapedSignInUrl}"`)
    // Clickable button and visible text, both escaped the same way.
    expect(countStringOccurrences(rendered.htmlBody, htmlEscapedSignInUrl)).toBeGreaterThanOrEqual(
      2,
    )
    // A redirect wrapper would percent-encode the whole link into a query parameter instead.
    expect(rendered.htmlBody).not.toContain(encodeURIComponent(signInUrlText))
    // Escaping and nothing else: undoing it restores exactly the URL the caller passed in.
    expect(rendered.htmlBody.replaceAll('&amp;', '&')).toContain(signInUrlText)
  })

  it('renders passwordResetEmailTemplate into an HTML document and readable text that both carry the reset URL verbatim', async () => {
    const { renderTransactionalEmail, passwordResetEmailTemplate } = await loadHearthkitEmailEntry()
    const passwordResetUrl = uniqueGatePasswordResetUrl()

    const genericResult = await renderTransactionalEmail({
      emailTemplate: passwordResetEmailTemplate,
      templateProps: passwordResetEmailPropsSchema.parse({ passwordResetUrl }),
    })
    renderTransactionalEmailResultSchema.parse(genericResult)
    const generic = expectResultKind(genericResult, 'transactional-email-rendered')

    expect(String(generic.emailTemplateName)).toBe(
      expectContractStringExport(passwordResetEmailTemplateName, 'passwordResetEmailTemplateName'),
    )
    expect(generic.htmlBody).toContain(String(passwordResetUrl))
    expect(generic.textBody).toContain(String(passwordResetUrl))
    expect(generic.htmlBody).toContain(`href="${String(passwordResetUrl)}"`)
    expect(
      countStringOccurrences(generic.htmlBody, String(passwordResetUrl)),
    ).toBeGreaterThanOrEqual(2)
    expect(generic.htmlBody).toContain('<!DOCTYPE html')
    expect(String(generic.subject)).not.toContain(String(gateEmailProductName))
    expect(generic.textBody).not.toContain(String(gateEmailExpiryMinutes))

    const specificResult = await renderTransactionalEmail({
      emailTemplate: passwordResetEmailTemplate,
      templateProps: passwordResetEmailPropsSchema.parse({
        passwordResetUrl,
        productName: gateEmailProductName,
        expiryMinutes: gateEmailExpiryMinutes,
      }),
    })
    const specific = expectResultKind(specificResult, 'transactional-email-rendered')
    expect(String(specific.subject)).toContain(String(gateEmailProductName))
    expect(specific.textBody).toContain(String(gateEmailProductName))
    expect(specific.textBody).toContain(String(gateEmailExpiryMinutes))
    expect(specific.textBody).toContain(String(passwordResetUrl))
  })

  it('uses the subject option in place of the one the template builds from its props', async () => {
    const { renderTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const templateProps = magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() })
    const overrideSubject = uniqueGateSubject('subject override')

    const templateOwned = expectResultKind(
      await renderTransactionalEmail({ emailTemplate: magicLinkEmailTemplate, templateProps }),
      'transactional-email-rendered',
    )
    const overridden = expectResultKind(
      await renderTransactionalEmail({
        emailTemplate: magicLinkEmailTemplate,
        templateProps,
        subject: overrideSubject,
      }),
      'transactional-email-rendered',
    )

    expect(String(overridden.subject)).toBe(String(overrideSubject))
    expect(String(overridden.subject)).not.toBe(String(templateOwned.subject))
    // Only the subject is overridden; the rendered parts are still the template's own.
    expect(overridden.htmlBody).toBe(templateOwned.htmlBody)
    expect(overridden.textBody).toBe(templateOwned.textBody)
  })

  it('returns email-template-render-failed when a template throws, naming the template or the unknown-template constant', async () => {
    const { renderTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const templateProps = magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() })

    // A throwing React Email template throws a plain Error with no distinctive type at both
    // element-construction and subject-building time, so both steps have to be wrapped.
    const elementThrows: TransactionalEmailTemplate<MagicLinkEmailProps> = {
      ...magicLinkEmailTemplate,
      emailTemplateName: emailTemplateNameSchema.parse('gate-element-throwing-template'),
      buildEmailElement: () => {
        throw new Error('gate template exploded while building its element')
      },
    }
    const elementFailure = expectEmailFailure(
      await renderTransactionalEmail({ emailTemplate: elementThrows, templateProps }),
      'email-template-render-failed',
    )
    expect(String(elementFailure.emailTemplateName)).toBe('gate-element-throwing-template')
    expect(elementFailure.renderFailureDetail).toContain('gate template exploded')

    const subjectThrows: TransactionalEmailTemplate<MagicLinkEmailProps> = {
      ...magicLinkEmailTemplate,
      emailTemplateName: emailTemplateNameSchema.parse('gate-subject-throwing-template'),
      buildEmailSubject: () => {
        throw new Error('gate template exploded while building its subject')
      },
    }
    const subjectFailure = expectEmailFailure(
      await renderTransactionalEmail({ emailTemplate: subjectThrows, templateProps }),
      'email-template-render-failed',
    )
    expect(String(subjectFailure.emailTemplateName)).toBe('gate-subject-throwing-template')
    expect(subjectFailure.renderFailureDetail).toContain('gate template exploded')

    // A malformed template an app supplied: the cast is the point, since no legal value can carry a
    // name this shape, and the never-throws promise still has to hold for it.
    const unusableName: TransactionalEmailTemplate<MagicLinkEmailProps> = {
      ...magicLinkEmailTemplate,
      emailTemplateName: 'Gate Template With No Usable Name' as unknown as EmailTemplateName,
      buildEmailElement: () => {
        throw new Error('gate template exploded while building its element')
      },
    }
    const unusableNameFailure = expectEmailFailure(
      await renderTransactionalEmail({ emailTemplate: unusableName, templateProps }),
      'email-template-render-failed',
    )
    expect(String(unusableNameFailure.emailTemplateName)).toBe(
      expectContractStringExport(unknownEmailTemplateName, 'unknownEmailTemplateName'),
    )
  })

  it('returns email-template-render-failed when a template builds a subject emailSubjectSchema rejects', async () => {
    const { renderTransactionalEmail, magicLinkEmailTemplate } = await loadHearthkitEmailEntry()
    const templateProps = magicLinkEmailPropsSchema.parse({ signInUrl: uniqueGateSignInUrl() })
    const subjectLimit = expectContractNumberExport(
      maximumEmailSubjectLength,
      'maximumEmailSubjectLength',
    )

    const unusableSubjects = [
      { label: 'empty', subject: '' },
      { label: 'over the length limit', subject: 'g'.repeat(subjectLimit + 1) },
      // The classic header-injection vector, which is why this check is load-bearing.
      {
        label: 'carrying a control character',
        subject: 'Gate subject\r\nBcc: attacker@example.test',
      },
    ] as const

    for (const unusableSubject of unusableSubjects) {
      const badSubjectTemplate: TransactionalEmailTemplate<MagicLinkEmailProps> = {
        ...magicLinkEmailTemplate,
        emailTemplateName: emailTemplateNameSchema.parse('gate-unusable-subject-template'),
        buildEmailSubject: () => unusableSubject.subject,
      }
      const result = await renderTransactionalEmail({
        emailTemplate: badSubjectTemplate,
        templateProps,
      })
      renderTransactionalEmailResultSchema.parse(result)
      const failure = expectEmailFailure(result, 'email-template-render-failed')

      expect(String(failure.emailTemplateName), unusableSubject.label).toBe(
        'gate-unusable-subject-template',
      )
      expect(failure.renderFailureDetail.length, unusableSubject.label).toBeGreaterThan(0)
    }
  })
})
