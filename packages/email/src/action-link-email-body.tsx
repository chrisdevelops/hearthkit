import type { ReactElement } from 'react'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from 'react-email'

// Plain, legible chrome with no theme system behind it: mail clients strip most CSS, and this package
// deliberately shares nothing with @hearthkit/ui's CSS-variable tokens, which mail cannot resolve.
const pageStyle = {
  backgroundColor: '#f4f4f5',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif, 'Apple Color Emoji'",
  margin: '0',
  padding: '24px 0',
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

const paragraphStyle = {
  color: '#3f3f46',
  fontSize: '15px',
  lineHeight: '24px',
  margin: '0 0 16px',
}

const buttonSectionStyle = { margin: '24px 0' }

const buttonStyle = {
  backgroundColor: '#18181b',
  borderRadius: '6px',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '15px',
  fontWeight: 600,
  padding: '12px 20px',
  textDecoration: 'none',
}

// The copyable link is deliberately allowed to overflow rather than being shortened, wrapped or
// redirected: template promise 1 says the action URL is printed as given.
const actionLinkStyle = { color: '#2563eb', fontSize: '14px', wordBreak: 'break-all' as const }

const footnoteStyle = { color: '#71717a', fontSize: '13px', lineHeight: '20px', margin: '16px 0 0' }

/** Everything the shipped templates differ by; the chrome around it is identical, so the two cannot drift apart. */
export type ActionLinkEmailBodyProps = {
  previewText: string
  headingText: string
  leadText: string
  actionLabel: string
  actionUrl: string
  expiryText?: string
  closingText: string
}

/**
 * The one message shape this package ships: a heading, a sentence, a clickable button and the same URL
 * again as visible text, so a client that strips buttons still lets a person copy the link.
 */
export function ActionLinkEmailBody(props: ActionLinkEmailBodyProps): ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>{props.previewText}</Preview>
      <Body style={pageStyle}>
        <Container style={cardStyle}>
          <Heading as="h1" style={headingStyle}>
            {props.headingText}
          </Heading>
          <Text style={paragraphStyle}>{props.leadText}</Text>
          <Section style={buttonSectionStyle}>
            <Button href={props.actionUrl} style={buttonStyle}>
              {props.actionLabel}
            </Button>
          </Section>
          <Text style={paragraphStyle}>Or copy and paste this link into your browser:</Text>
          <Text style={actionLinkStyle}>
            <Link href={props.actionUrl} style={actionLinkStyle}>
              {props.actionUrl}
            </Link>
          </Text>
          {props.expiryText === undefined ? null : (
            <Text style={footnoteStyle}>{props.expiryText}</Text>
          )}
          <Text style={footnoteStyle}>{props.closingText}</Text>
        </Container>
      </Body>
    </Html>
  )
}
