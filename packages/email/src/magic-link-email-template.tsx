import type { ReactElement } from 'react'
import { ActionLinkEmailBody } from './action-link-email-body.tsx'
import {
  emailTemplateNameSchema,
  magicLinkEmailTemplateName,
  type MagicLinkEmailProps,
  type TransactionalEmailTemplate,
} from './email-contract.ts'
import { buildEmailExpirySentence } from './email-link-expiry-sentence.ts'

// Copy is English and deliberately plain. Omitting productName must leave generic wording rather than
// an empty gap, so @hearthkit/auth can send working mail with no product-name variable of its own.
function buildMagicLinkHeading(productName: string | undefined): string {
  return productName === undefined ? 'Your sign-in link' : `Sign in to ${productName}`
}

/** The magic link template: name, subject and element for the one-time sign-in link Better Auth sends. */
export const magicLinkEmailTemplate: TransactionalEmailTemplate<MagicLinkEmailProps> = {
  emailTemplateName: emailTemplateNameSchema.parse(magicLinkEmailTemplateName),

  buildEmailSubject: (templateProps: MagicLinkEmailProps): string =>
    buildMagicLinkHeading(
      templateProps.productName === undefined ? undefined : String(templateProps.productName),
    ),

  buildEmailElement: (templateProps: MagicLinkEmailProps): ReactElement => {
    const productName =
      templateProps.productName === undefined ? undefined : String(templateProps.productName)
    const headingText = buildMagicLinkHeading(productName)
    return (
      <ActionLinkEmailBody
        previewText={headingText}
        headingText={headingText}
        leadText={
          productName === undefined
            ? 'Use the button below to sign in. If you did not ask for this email, you can safely ignore it.'
            : `Use the button below to sign in to ${productName}. If you did not ask for this email, you can safely ignore it.`
        }
        actionLabel="Sign in"
        actionUrl={String(templateProps.signInUrl)}
        expiryText={buildEmailExpirySentence(templateProps.expiryMinutes)}
        closingText="This link can only be used once."
      />
    )
  },
}
