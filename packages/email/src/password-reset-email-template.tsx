import type { ReactElement } from 'react'
import { ActionLinkEmailBody } from './action-link-email-body.tsx'
import {
  emailTemplateNameSchema,
  passwordResetEmailTemplateName,
  type PasswordResetEmailProps,
  type TransactionalEmailTemplate,
} from './email-contract.ts'
import { buildEmailExpirySentence } from './email-link-expiry-sentence.ts'

// Copy is English and deliberately plain. Without this mail a user who forgets a password is locked
// out permanently, so the generic wording has to stand on its own with no product name supplied.
function buildPasswordResetHeading(productName: string | undefined): string {
  return productName === undefined ? 'Reset your password' : `Reset your ${productName} password`
}

/** The password reset template: name, subject and element for the one-time reset link Better Auth sends. */
export const passwordResetEmailTemplate: TransactionalEmailTemplate<PasswordResetEmailProps> = {
  emailTemplateName: emailTemplateNameSchema.parse(passwordResetEmailTemplateName),

  buildEmailSubject: (templateProps: PasswordResetEmailProps): string =>
    buildPasswordResetHeading(
      templateProps.productName === undefined ? undefined : String(templateProps.productName),
    ),

  buildEmailElement: (templateProps: PasswordResetEmailProps): ReactElement => {
    const productName =
      templateProps.productName === undefined ? undefined : String(templateProps.productName)
    const headingText = buildPasswordResetHeading(productName)
    return (
      <ActionLinkEmailBody
        previewText={headingText}
        headingText={headingText}
        leadText={
          productName === undefined
            ? 'Use the button below to choose a new password. If you did not ask to reset it, you can safely ignore this email and your password stays as it is.'
            : `Use the button below to choose a new password for ${productName}. If you did not ask to reset it, you can safely ignore this email and your password stays as it is.`
        }
        actionLabel="Reset password"
        actionUrl={String(templateProps.passwordResetUrl)}
        expiryText={buildEmailExpirySentence(templateProps.expiryMinutes)}
        closingText="This link can only be used once."
      />
    )
  },
}
