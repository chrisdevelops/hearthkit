import { render } from '@react-email/render'
import type { ReactElement } from 'react'
import {
  emailSubjectSchema,
  emailTemplateNameSchema,
  unknownEmailTemplateName,
  type EmailTemplateName,
  type RenderTransactionalEmailOptions,
  type RenderTransactionalEmailResult,
} from './email-contract.ts'
import { emailTemplateRenderFailedFailure } from './email-failure-results.ts'
import { describeThrownEmailError } from './thrown-email-error-details.ts'

// Parsed once, so the never-throws promise does not depend on the constant still matching the schema.
const unknownEmailTemplateNameValue: EmailTemplateName =
  emailTemplateNameSchema.parse(unknownEmailTemplateName)

// A template an app hand-built may carry a name no legal value could have, and the failure still has
// to name something, so an unusable name becomes the exported unknown-template constant.
function reportedEmailTemplateName(emailTemplate: unknown): EmailTemplateName {
  if (typeof emailTemplate !== 'object' || emailTemplate === null) {
    return unknownEmailTemplateNameValue
  }
  const parsedName = emailTemplateNameSchema.safeParse(
    (emailTemplate as { emailTemplateName?: unknown }).emailTemplateName,
  )
  return parsedName.success ? parsedName.data : unknownEmailTemplateNameValue
}

/**
 * Renders both parts of one message from one element, so the HTML and the plain text can never
 * disagree. Contacts nothing and needs no transport, so the only failure it can return is the render
 * failure — including a template that built a subject emailSubjectSchema rejects, which is the check
 * that stops a control character reaching an SMTP header.
 */
export async function renderTransactionalEmail<TTemplateProps>(
  options: RenderTransactionalEmailOptions<TTemplateProps>,
): Promise<RenderTransactionalEmailResult> {
  const emailTemplateName = reportedEmailTemplateName(options.emailTemplate)

  let emailElement: ReactElement
  let subjectText: string
  try {
    emailElement = options.emailTemplate.buildEmailElement(options.templateProps)
    subjectText =
      options.subject === undefined
        ? options.emailTemplate.buildEmailSubject(options.templateProps)
        : String(options.subject)
  } catch (error) {
    return emailTemplateRenderFailedFailure(emailTemplateName, describeThrownEmailError(error))
  }

  // Checked even when the caller supplied the subject, because a hand-cast branded value would
  // otherwise carry a newline straight into the message headers.
  const parsedSubject = emailSubjectSchema.safeParse(subjectText)
  if (!parsedSubject.success) {
    const subjectIssueDetail = parsedSubject.error.issues.map((issue) => issue.message).join('; ')
    return emailTemplateRenderFailedFailure(
      emailTemplateName,
      `the subject is not one to two hundred characters free of control characters: ${subjectIssueDetail.length > 0 ? subjectIssueDetail : 'invalid subject'}`,
    )
  }

  try {
    // One element, rendered twice: React escapes & to &amp; in the HTML part, so a multi-parameter
    // action URL is byte-identical only in the plain text part. That is the part a consumer reads.
    const htmlBody = await render(emailElement)
    const textBody = await render(emailElement, { plainText: true })
    return {
      kind: 'transactional-email-rendered',
      emailTemplateName,
      subject: parsedSubject.data,
      htmlBody,
      textBody,
    }
  } catch (error) {
    return emailTemplateRenderFailedFailure(emailTemplateName, describeThrownEmailError(error))
  }
}
