'use client'

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  PageContainer,
  PageHeader,
} from '@hearthkit/ui'
import { useCallback, useState, type ChangeEvent } from 'react'

/**
 * The `@hearthkit/email` section: send one templated message and see which subject went out.
 *
 * This section exists because `@hearthkit/email` depends only on `@hearthkit/config`, so a project may
 * select it without `@hearthkit/auth`. Covering email only through auth's magic link would leave such a
 * project with a section nothing exercises.
 *
 * The subject is read back off the route's answer rather than rebuilt here, so what this page shows is
 * the subject that was actually sent.
 */

/** Never prerendered: the route segment config is stated for every section page and handler alike. */
export const dynamic = 'force-dynamic'

/** True for a JSON object, which is the only shape this page reads the send route's answer as; only the subject is read. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export default function EmailSectionPage() {
  const [recipientEmailAddress, setRecipientEmailAddress] = useState('')
  const [sentSubject, setSentSubject] = useState('')
  const [sectionMessage, setSectionMessage] = useState('')
  const [isBusy, setIsBusy] = useState(false)

  const sendTestMessage = useCallback(async (): Promise<void> => {
    setIsBusy(true)
    setSentSubject('')
    setSectionMessage('')
    try {
      const response = await fetch('/api/email/test-message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipientEmailAddress }),
      })
      const bodyText = await response.text()

      if (!response.ok) {
        // The owning package's own message, shown unchanged: it names the cause, and rewording it
        // here would lose the prefix an operator greps for.
        setSectionMessage(bodyText)
        return
      }

      const sent: unknown = JSON.parse(bodyText)
      setSentSubject(isJsonObject(sent) && typeof sent.subject === 'string' ? sent.subject : '')
      setSectionMessage(`Sent to ${recipientEmailAddress}.`)
    } finally {
      setIsBusy(false)
    }
  }, [recipientEmailAddress])

  return (
    <PageContainer>
      <PageHeader
        pageTitle="Email"
        pageDescription="Send one templated message through whichever transport this app is configured with."
      />

      <Card>
        <CardHeader>
          <CardTitle>Send a test email</CardTitle>
          <CardDescription>
            Locally this goes to Mailpit, which `hearthkit dev infra up` publishes on 8025.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email-recipient">Recipient</Label>
            <Input
              id="email-recipient"
              type="email"
              data-testid="email-recipient-input"
              placeholder="somebody@example.com"
              value={recipientEmailAddress}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setRecipientEmailAddress(event.target.value)
              }}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              disabled={isBusy}
              onClick={() => {
                void sendTestMessage()
              }}
            >
              Send test email
            </Button>
          </div>
          <p data-testid="email-sent-subject" className="text-sm font-medium">
            {sentSubject}
          </p>
          <p data-testid="email-message" className="text-sm break-all text-muted-foreground">
            {sectionMessage}
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  )
}
