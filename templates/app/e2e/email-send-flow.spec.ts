import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

/**
 * The email section, end to end: trigger the "send a test email" action and read the message out of
 * the inbox it landed in.
 *
 * This section exists because @hearthkit/email depends only on @hearthkit/config, so a project may
 * select it without @hearthkit/auth. Covering email only through auth's magic link would leave such a
 * project with a section nothing exercises.
 *
 * Needs Mailpit. `hearthkit dev infra up` publishes its API on 8025, which is the default below; set
 * MAILPIT_API_BASE_URL to point at another one. Inside the hearthkit workspace that variable is not
 * optional in practice: @hearthkit/email's own gates clear the repo's shared Mailpit wholesale and
 * assert exact message counts, so this flow must be pointed at a Mailpit of its own or the two suites
 * break each other. This flow reads only its own run-unique recipient and issues no removing request
 * of any kind, which is the other half of that isolation.
 */

/** Where this run reads mail; the default is the port `hearthkit dev infra up` publishes for a project. */
const mailpitApiBaseUrl = (process.env.MAILPIT_API_BASE_URL ?? '').trim() || 'http://127.0.0.1:8025'

/** A recipient nothing else can be sending to, which is what makes a scoped search sound. */
const recipientEmailAddress = `hearthkit-email-flow-${randomUUID().replaceAll('-', '').slice(0, 12)}@hearthkit.test`

/** One message as Mailpit's list endpoints summarise it. */
type MailpitMessageSummary = { ID: string; Subject: string }

/** One message in full: both body parts, which is what the section's template has to produce. */
type MailpitMessage = { Subject: string; Text: string; HTML: string }

/** Reads JSON from Mailpit, failing with the body rather than with a parse error. */
async function readMailpitJson(requestPath: string): Promise<unknown> {
  const response = await fetch(`${mailpitApiBaseUrl}${requestPath}`)
  const bodyText = await response.text()
  if (!response.ok) {
    throw new Error(
      `the flow could not read ${requestPath} from Mailpit at ${mailpitApiBaseUrl}: HTTP ${String(response.status)} ${bodyText.slice(0, 200)}`,
    )
  }
  return JSON.parse(bodyText) as unknown
}

/**
 * Waits for the one message addressed to this run and returns it in full.
 *
 * Scoped with the search endpoint's `to:` filter rather than listing the inbox: an unscoped read sees
 * every other suite's mail, and this flow shares a Mailpit with anything else pointed at the same
 * URL. Polls because a 250 from the SMTP session and the message becoming readable over the HTTP API
 * are two different events.
 */
async function waitForMessageToThisRun(waitMs = 20_000): Promise<MailpitMessage> {
  const searchPath = `/api/v1/search?query=${encodeURIComponent(`to:"${recipientEmailAddress}"`)}`
  const giveUpAt = Date.now() + waitMs

  for (;;) {
    const searched = (await readMailpitJson(searchPath)) as { messages?: MailpitMessageSummary[] }
    const [summary] = searched.messages ?? []
    if (summary !== undefined) {
      return (await readMailpitJson(`/api/v1/message/${summary.ID}`)) as MailpitMessage
    }
    if (Date.now() >= giveUpAt) {
      throw new Error(
        `the flow found no message to ${recipientEmailAddress} in Mailpit at ${mailpitApiBaseUrl} within ${String(waitMs)}ms`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

test('the test email action sends one message with both body parts', async ({ page }) => {
  const response = await page.goto('/email')
  expect(response?.status()).toBe(200)

  await page.getByTestId('email-recipient-input').fill(recipientEmailAddress)
  await page.getByRole('button', { name: 'Send test email' }).click()

  // The section reports the subject it sent, which is what ties the message in the inbox to this
  // click rather than to any other message that happens to be addressed the same way.
  const sentSubject = await page.getByTestId('email-sent-subject').innerText({ timeout: 30_000 })
  expect(sentSubject.trim()).not.toBe('')

  const message = await waitForMessageToThisRun()
  expect(message.Subject).toBe(sentSubject.trim())

  // Both parts, and they are genuinely two parts: a transactional message with an empty text part
  // renders as an attachment in some clients, and one whose html part is a copy of the text part is
  // not rendered at all.
  expect(message.Text.trim()).not.toBe('')
  expect(message.HTML.trim()).not.toBe('')
  expect(message.HTML).toContain('<')
  expect(message.HTML).not.toBe(message.Text)
})
