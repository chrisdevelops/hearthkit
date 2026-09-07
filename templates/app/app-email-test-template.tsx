import { emailTemplateNameSchema } from '@hearthkit/email'
import type { TransactionalEmailTemplate } from '@hearthkit/email'
import type { ReactElement } from 'react'

/**
 * The one message this app owns.
 *
 * `@hearthkit/email` ships `magic-link-sign-in` and `password-reset` and nothing else, because every
 * other message an app sends is the app's own copy. This is the pattern for writing one: a name, a
 * subject built from the props, and an element built from the same props, so the HTML part and the
 * plain text part are rendered from one source and cannot disagree.
 *
 * Plain HTML elements rather than `react-email` components, so the app takes no dependency of its own
 * on that library: `@hearthkit/email` renders whatever element this builds. Style with inline
 * attributes only — mail clients strip stylesheets, and none of them can resolve the CSS variables
 * `@hearthkit/ui` themes the app with.
 */

/** Props of the test message; the address is echoed back so a person can see which inbox it went to. */
export type AppEmailTestMessageProps = {
  recipientEmailAddress: string
  sentAtIso: string
}

const bodyStyle = {
  backgroundColor: '#f4f4f5',
  color: '#3f3f46',
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  margin: '0',
  padding: '24px',
}

const cardStyle = {
  backgroundColor: '#ffffff',
  border: '1px solid #e4e4e7',
  borderRadius: '8px',
  margin: '0 auto',
  maxWidth: '560px',
  padding: '32px',
}

const headingStyle = { color: '#18181b', fontSize: '22px', margin: '0 0 16px' }

const paragraphStyle = { fontSize: '15px', lineHeight: '24px', margin: '0 0 16px' }

const footnoteStyle = { color: '#71717a', fontSize: '13px', lineHeight: '20px', margin: '0' }

/** The app's test message: one template, one subject, both parts of one body. */
export const appEmailTestTemplate: TransactionalEmailTemplate<AppEmailTestMessageProps> = {
  emailTemplateName: emailTemplateNameSchema.parse('app-test-message'),

  buildEmailSubject: (templateProps: AppEmailTestMessageProps): string =>
    `hearthkit test email for ${templateProps.recipientEmailAddress}`,

  buildEmailElement: (templateProps: AppEmailTestMessageProps): ReactElement => (
    <html lang="en">
      <body style={bodyStyle}>
        <div style={cardStyle}>
          <h1 style={headingStyle}>Your email transport works</h1>
          <p style={paragraphStyle}>
            This message was sent to {templateProps.recipientEmailAddress} at{' '}
            {templateProps.sentAtIso} by the email section of this app.
          </p>
          <p style={paragraphStyle}>
            If you can read this, the transport named by EMAIL_TRANSPORT accepted the message and
            delivered it. Replace this template with your own from app-email-test-template.tsx.
          </p>
          <p style={footnoteStyle}>Nobody needs to reply to this message.</p>
        </div>
      </body>
    </html>
  ),
}
