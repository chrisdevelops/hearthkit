import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

/**
 * The auth section, end to end: sign up with a password, see the session, sign out, then sign back in
 * through a magic link read out of the inbox.
 *
 * Needs Postgres and Mailpit, and it needs the auth tables to exist. The app owns its migration: the
 * template ships drizzle.config.ts and no generated SQL, so `pnpm db:generate` and `hearthkit db
 * migrate` are a precondition of this flow rather than something it can arrange for itself.
 *
 * The same Mailpit rule as the email flow applies, for the same measured reason: read only this run's
 * own recipient through the search endpoint, issue no removing request, and take the address from
 * MAILPIT_API_BASE_URL so this repo can point the flow at a Mailpit that @hearthkit/email's gates are
 * not clearing underneath it.
 */

/** Where this run reads mail; the default is the port `hearthkit dev infra up` publishes for a project. */
const mailpitApiBaseUrl = (process.env.MAILPIT_API_BASE_URL ?? '').trim() || 'http://127.0.0.1:8025'

/** One person, created by this run and by nothing else, so a scoped search finds exactly their mail. */
const signUpToken = randomUUID().replaceAll('-', '').slice(0, 12)
const signUpEmailAddress = `hearthkit-auth-flow-${signUpToken}@hearthkit.test`
const signUpPassword = `hearthkit-flow-password-${signUpToken}`
const signUpDisplayName = `Hearthkit Flow ${signUpToken}`

/** One message in full; the magic link is read out of the plain text part. */
type MailpitMessage = { Subject: string; Text: string }

/** True for a JSON object, which is what every Mailpit answer this flow reads is. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The JSON object Mailpit answered with, failing the flow when it is anything else. */
function jsonObjectOf(value: unknown, requestPath: string): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw new Error(`the flow expected a JSON object from Mailpit at ${requestPath}`)
  }
  return value
}

/** The id of the first message in a search answer, or undefined while the search finds nothing. */
function firstMessageIdOf(searched: Record<string, unknown>): string | undefined {
  const messages: readonly unknown[] = Array.isArray(searched.messages) ? searched.messages : []
  const [summary] = messages
  return isJsonObject(summary) && typeof summary.ID === 'string' ? summary.ID : undefined
}

/** One message read in full, failing the flow when a part this flow reads is missing. */
async function readMailpitMessage(messageId: string): Promise<MailpitMessage> {
  const requestPath = `/api/v1/message/${messageId}`
  const message = jsonObjectOf(await readMailpitJson(requestPath), requestPath)
  if (typeof message.Subject !== 'string' || typeof message.Text !== 'string') {
    throw new Error(`the flow expected Subject and Text on the message at ${requestPath}`)
  }
  return { Subject: message.Subject, Text: message.Text }
}

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

/** Waits for the sign-in mail addressed to this run, scoped so it can never read another suite's. */
async function waitForSignInMessage(waitMs = 20_000): Promise<MailpitMessage> {
  const searchPath = `/api/v1/search?query=${encodeURIComponent(`to:"${signUpEmailAddress}"`)}`
  const giveUpAt = Date.now() + waitMs

  for (;;) {
    const messageId = firstMessageIdOf(jsonObjectOf(await readMailpitJson(searchPath), searchPath))
    if (messageId !== undefined) {
      return readMailpitMessage(messageId)
    }
    if (Date.now() >= giveUpAt) {
      throw new Error(
        `the flow found no sign-in message to ${signUpEmailAddress} in Mailpit at ${mailpitApiBaseUrl} within ${String(waitMs)}ms`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * The link out of the PLAIN TEXT part. The emailed link always carries more than one query
 * parameter, and React Email escapes the `&` between them to `&amp;` in the html part, so the link
 * appears usable in the text part and nowhere else.
 */
function readSignInLinkFromTextPart(message: MailpitMessage): string {
  const signInUrl = /https?:\/\/\S*\/api\/auth\/\S+/u.exec(message.Text)?.[0]
  if (signInUrl === undefined) {
    throw new Error(
      `the flow found no sign-in URL in the text part of ${JSON.stringify(message.Subject)}: ${message.Text.slice(0, 400)}`,
    )
  }
  // Punctuation the text renderer may sit next to the URL is not part of the link.
  return signInUrl.replace(/[.,)\]]+$/u, '')
}

test('a person signs up with a password, signs out, and signs back in through a magic link', async ({
  page,
}) => {
  const response = await page.goto('/sign-in')
  expect(response?.status()).toBe(200)

  await page.getByTestId('auth-name-input').fill(signUpDisplayName)
  await page.getByTestId('auth-email-input').fill(signUpEmailAddress)
  await page.getByTestId('auth-password-input').fill(signUpPassword)
  await page.getByRole('button', { name: 'Create account' }).click()

  // The session is the thing being proved, so it is read off the page rather than off a cookie.
  await page.waitForURL('**/account', { timeout: 30_000 })
  await expect(page.getByTestId('account-session-email')).toHaveText(signUpEmailAddress)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByTestId('account-session-email')).toHaveCount(0)

  await page.goto('/sign-in')
  await page.getByTestId('auth-email-input').fill(signUpEmailAddress)
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()

  const signInLink = readSignInLinkFromTextPart(await waitForSignInMessage())
  await page.goto(signInLink)

  // The same person, not a second account created by the link: an implementation that signed the
  // visitor in as a fresh user would pass every assertion above this one.
  await page.waitForURL('**/account', { timeout: 30_000 })
  await expect(page.getByTestId('account-session-email')).toHaveText(signUpEmailAddress)
})
