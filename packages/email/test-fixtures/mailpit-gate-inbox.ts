import { z } from 'zod'

/**
 * Mailpit's HTTP API, driven by the gates directly. The package under test never talks to this API —
 * it only speaks SMTP — so reading a delivered message here never goes through the code being gated.
 */

/** Mailpit's HTTP API from the repo-root docker-compose.yml; override when the service is not on the default port. */
export const mailpitGateApiBaseUrl =
  process.env.HEARTHKIT_GATE_MAILPIT_API ?? 'http://127.0.0.1:8025'

const mailpitAddressSchema = z.object({ Name: z.string(), Address: z.string() })

const mailpitMessageListSchema = z.object({
  messages_count: z.number(),
  messages: z.array(
    z.object({
      ID: z.string(),
      MessageID: z.string(),
      Subject: z.string(),
      To: z.array(mailpitAddressSchema),
    }),
  ),
})

const mailpitMessageSchema = z.object({
  ID: z.string(),
  MessageID: z.string(),
  Subject: z.string(),
  From: mailpitAddressSchema,
  To: z.array(mailpitAddressSchema),
  Text: z.string(),
  HTML: z.string(),
})

/** One delivered message as Mailpit parsed it: both body parts, the envelope addresses and the RFC Message-ID. */
export type MailpitMessage = z.infer<typeof mailpitMessageSchema>

const mailpitChaosTriggerSchema = z.object({ ErrorCode: z.number(), Probability: z.number() })

const mailpitChaosTriggersSchema = z.object({
  Sender: mailpitChaosTriggerSchema,
  Recipient: mailpitChaosTriggerSchema,
  Authentication: mailpitChaosTriggerSchema,
})

/** Mailpit's three failure-injection triggers, exactly as GET /api/v1/chaos reports them. */
export type MailpitChaosTriggers = z.infer<typeof mailpitChaosTriggersSchema>

/**
 * Mailpit's own defaults for the three triggers, restored after any gate that switched one on. The
 * authentication trigger's default code is 535, not 451: overwriting it would leave the container in a
 * state the next run did not choose.
 */
export const inertMailpitChaosTriggers: MailpitChaosTriggers = {
  Sender: { ErrorCode: 451, Probability: 0 },
  Recipient: { ErrorCode: 451, Probability: 0 },
  Authentication: { ErrorCode: 535, Probability: 0 },
}

/**
 * Turns a Mailpit API failure into words a contributor can act on. A refused connection is the common
 * case — the container simply is not running — and gets its own sentence naming the command that
 * starts it, so a missing service is never reported as a package defect.
 */
function mailpitGateError(requestPath: string, error: unknown): Error {
  const description = error instanceof Error ? error.message : String(error)
  return new Error(
    `gate cannot reach Mailpit at ${mailpitGateApiBaseUrl}${requestPath}: ${description}. Start it from the repo root with "docker compose up -d --wait mailpit".`,
  )
}

// Mailpit answers a mutation with the plain word "ok" and a query with JSON, so the two cannot share
// one parse step: JSON.parse('ok') throws, and a fixture error would replace the gate's own result.
async function requestMailpitText(
  requestPath: string,
  requestInit?: { method: string; body?: string },
): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${mailpitGateApiBaseUrl}${requestPath}`, {
      method: requestInit?.method ?? 'GET',
      headers: requestInit?.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: requestInit?.body,
    })
  } catch (error) {
    throw mailpitGateError(requestPath, error)
  }
  const bodyText = await response.text()
  if (!response.ok) {
    throw mailpitGateError(requestPath, new Error(`${response.status} ${bodyText.slice(0, 200)}`))
  }
  return bodyText
}

async function requestMailpitJson(requestPath: string): Promise<unknown> {
  const bodyText = await requestMailpitText(requestPath)
  try {
    return JSON.parse(bodyText) as unknown
  } catch (error) {
    throw mailpitGateError(
      requestPath,
      new Error(`expected JSON, received ${bodyText.slice(0, 200)}`, { cause: error }),
    )
  }
}

/** Deletes every message Mailpit holds, so one gate never reads mail another gate sent. */
export async function clearMailpitInbox(): Promise<void> {
  await requestMailpitText('/api/v1/messages', { method: 'DELETE' })
}

/** How many messages Mailpit holds right now; zero is how a gate proves nothing crossed the wire. */
export async function readMailpitMessageCount(): Promise<number> {
  return mailpitMessageListSchema.parse(await requestMailpitJson('/api/v1/messages')).messages_count
}

/**
 * Waits for a message with this subject and returns it in full. Polls because a 250 from the SMTP
 * session and the message becoming readable over the HTTP API are two different events, and throws
 * naming the subject rather than returning undefined, which a gate could silently assert against.
 */
export async function findMailpitMessageBySubject(
  subject: string,
  waitMs = 5_000,
): Promise<MailpitMessage> {
  const giveUpAt = Date.now() + waitMs
  for (;;) {
    const list = mailpitMessageListSchema.parse(
      await requestMailpitJson('/api/v1/messages?limit=200'),
    )
    const summary = list.messages.find((message) => message.Subject === subject)
    if (summary !== undefined) {
      return mailpitMessageSchema.parse(await requestMailpitJson(`/api/v1/message/${summary.ID}`))
    }
    if (Date.now() >= giveUpAt) {
      throw new Error(
        `gate found no message in Mailpit with subject ${JSON.stringify(subject)}; it holds ${list.messages_count} message(s): ${JSON.stringify(list.messages.map((message) => message.Subject))}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** Reads all three Chaos triggers, so a gate can prove it left the container as it found it. */
export async function readMailpitChaosTriggers(): Promise<MailpitChaosTriggers> {
  return mailpitChaosTriggersSchema.parse(await requestMailpitJson('/api/v1/chaos'))
}

/**
 * Makes Mailpit refuse every recipient with 451 at RCPT TO. This is the only way to get a real SMTP
 * server to reject a real message on demand; the package never touches this endpoint.
 */
export async function rejectEveryMailpitRecipient(): Promise<void> {
  await requestMailpitText('/api/v1/chaos', {
    method: 'PUT',
    body: JSON.stringify({ Recipient: { ErrorCode: 451, Probability: 100 } }),
  })
}

/** Puts all three Chaos triggers back to inert, and fails loudly if Mailpit did not accept the reset. */
export async function resetMailpitChaos(): Promise<void> {
  await requestMailpitText('/api/v1/chaos', {
    method: 'PUT',
    body: JSON.stringify(inertMailpitChaosTriggers),
  })
  const triggers = await readMailpitChaosTriggers()
  const stillArmed = Object.entries(triggers).filter(([, trigger]) => trigger.Probability !== 0)
  if (stillArmed.length > 0) {
    throw new Error(
      `gate could not disarm Mailpit chaos, still armed: ${JSON.stringify(Object.fromEntries(stillArmed))}`,
    )
  }
}

/** Clears the inbox, disarms chaos and proves both, so a gate file leaves Mailpit exactly as it found it. */
export async function restoreMailpitToEmpty(): Promise<void> {
  await resetMailpitChaos()
  await clearMailpitInbox()
  const remaining = await readMailpitMessageCount()
  if (remaining !== 0) {
    throw new Error(`gate left ${remaining} message(s) behind in Mailpit`)
  }
}
