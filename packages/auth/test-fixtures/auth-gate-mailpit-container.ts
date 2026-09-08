import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import { z } from 'zod'

const execFileAsync = promisify(execFile)

/**
 * A Mailpit of this gate suite's own, on ports it reserved, started and removed by the file that
 * needs it. It is deliberately NOT the Mailpit in the repo-root docker-compose.yml on 1025 and 8025.
 *
 * That is measured, not cautious. @hearthkit/email's gates call DELETE /api/v1/messages — which wipes
 * every message in the container, not only their own — in a beforeEach, and then assert on the exact
 * total message count nine times. With a second process sending one message into the shared Mailpit
 * every 250ms, which is what this suite looks like from outside, `pnpm --filter @hearthkit/email test`
 * went from 25/25 passing to 23/25 and exit 1; with that process stopped, 25/25 and exit 0. It breaks
 * the other way too: email's beforeEach would delete this suite's magic link message before the gate
 * could read the link out of it.
 *
 * The image is the same pin as localInfraServiceImageByName.mailpit, so this container and the repo's
 * own are the same Mailpit. No service is added to docker-compose.yml and no CI workflow is changed:
 * a suite that starts what it needs requires neither, which keeps the compose-service-CI-never-heard-of
 * trap that failed PR #10 out of this loop entirely.
 */

/** The Mailpit image, pinned to the same tag packages/cli/src/cli-contract.ts pins for local infra. */
export const gateMailpitImageName = 'axllent/mailpit:v1.31'

/** How long a gate waits for a freshly started Mailpit to answer its HTTP API, including a first-run image pull. */
const gateMailpitReadyTimeoutMs = 180_000

/** One running throwaway Mailpit: where to send, where to read, and the one call that removes it. */
export type GateMailpitContainer = {
  containerName: string
  smtpPortNumber: number
  apiBaseUrl: string
  stopGateMailpitContainer: () => Promise<void>
}

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
export type GateMailpitMessage = z.infer<typeof mailpitMessageSchema>

/** A host port nothing is listening on right now, taken by binding port 0 and releasing it, so two runs never collide. */
async function reserveFreeHostPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probeServer = createServer()
    probeServer.once('error', reject)
    probeServer.listen(0, '127.0.0.1', () => {
      const address = probeServer.address()
      if (address === null || typeof address === 'string') {
        probeServer.close(() =>
          reject(new Error('gate could not reserve a free host port for its Mailpit container')),
        )
        return
      }
      const { port } = address
      probeServer.close(() => resolve(port))
    })
  })
}

/** Force-removes a container by name, so cleanup never depends on the container having started cleanly. */
export async function removeGateMailpitContainer(containerName: string): Promise<void> {
  await execFileAsync('docker', ['rm', '--force', '--volumes', containerName]).catch(
    () => undefined,
  )
}

/** True when a container with exactly this name still exists in any state, so a gate can prove it cleaned up. */
export async function gateMailpitContainerExists(containerName: string): Promise<boolean> {
  const { stdout } = await execFileAsync('docker', [
    'ps',
    '--all',
    '--filter',
    `name=^${containerName}$`,
    '--format',
    '{{.Names}}',
  ]).catch(() => ({ stdout: '' }))
  return stdout.split('\n').includes(containerName)
}

/**
 * Starts one Mailpit with `docker run` rather than a compose project. A compose project also creates a
 * network, and packages/cli's fixtures show that network is the fiddly half of teardown: it survives
 * container removal and docker runs out of address pools after enough gate runs. One container on the
 * default bridge has nothing to clean up but itself.
 */
export async function startGateMailpitContainer(purpose: string): Promise<GateMailpitContainer> {
  const [smtpPortNumber, apiPortNumber] = await Promise.all([
    reserveFreeHostPort(),
    reserveFreeHostPort(),
  ])
  if (smtpPortNumber === apiPortNumber) {
    throw new Error('gate reserved the same host port twice for one Mailpit container')
  }
  const containerName = `hearthkit-auth-gate-mailpit-${purpose}-${process.pid}-${apiPortNumber}`
  const apiBaseUrl = `http://127.0.0.1:${apiPortNumber}`

  await removeGateMailpitContainer(containerName)
  try {
    await execFileAsync(
      'docker',
      [
        'run',
        '--detach',
        '--rm',
        '--name',
        containerName,
        '--publish',
        `127.0.0.1:${smtpPortNumber}:1025`,
        '--publish',
        `127.0.0.1:${apiPortNumber}:8025`,
        gateMailpitImageName,
      ],
      { timeout: gateMailpitReadyTimeoutMs },
    )
  } catch (error) {
    throw new Error(
      `gate could not start its own Mailpit container from ${gateMailpitImageName}: ${error instanceof Error ? error.message : String(error)}. Docker must be running for this gate file.`,
      { cause: error },
    )
  }

  const container: GateMailpitContainer = {
    containerName,
    smtpPortNumber,
    apiBaseUrl,
    stopGateMailpitContainer: () => removeGateMailpitContainer(containerName),
  }

  try {
    await waitForGateMailpitApi(apiBaseUrl)
  } catch (error) {
    await container.stopGateMailpitContainer()
    throw error
  }
  return container
}

async function waitForGateMailpitApi(apiBaseUrl: string): Promise<void> {
  const giveUpAt = Date.now() + gateMailpitReadyTimeoutMs
  let lastError = 'no attempt was made'
  for (;;) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/messages`)
      if (response.ok) {
        await response.text()
        return
      }
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    if (Date.now() >= giveUpAt) {
      throw new Error(`gate's own Mailpit never answered at ${apiBaseUrl}: ${lastError}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function requestGateMailpitJson(apiBaseUrl: string, requestPath: string): Promise<unknown> {
  const response = await fetch(`${apiBaseUrl}${requestPath}`)
  const bodyText = await response.text()
  if (!response.ok) {
    throw new Error(
      `gate could not read ${requestPath} from its own Mailpit at ${apiBaseUrl}: HTTP ${response.status} ${bodyText.slice(0, 200)}`,
    )
  }
  try {
    return JSON.parse(bodyText) as unknown
  } catch (error) {
    throw new Error(`gate expected JSON from ${requestPath}, received ${bodyText.slice(0, 200)}`, {
      cause: error,
    })
  }
}

/** How many messages this gate's own Mailpit holds; zero is how a gate proves nothing crossed the wire. */
export async function readGateMailpitMessageCount(apiBaseUrl: string): Promise<number> {
  return mailpitMessageListSchema.parse(
    await requestGateMailpitJson(apiBaseUrl, '/api/v1/messages'),
  ).messages_count
}

/**
 * Waits for a message with this subject and returns it in full. Polls because a 250 from the SMTP
 * session and the message becoming readable over the HTTP API are two different events, and throws
 * naming the subject rather than returning undefined, which a gate could silently assert against.
 */
export async function findGateMailpitMessageBySubject(
  apiBaseUrl: string,
  subject: string,
  waitMs = 10_000,
): Promise<GateMailpitMessage> {
  const giveUpAt = Date.now() + waitMs
  for (;;) {
    const list = mailpitMessageListSchema.parse(
      await requestGateMailpitJson(apiBaseUrl, '/api/v1/messages?limit=200'),
    )
    const summary = list.messages.find((message) => message.Subject === subject)
    if (summary !== undefined) {
      return mailpitMessageSchema.parse(
        await requestGateMailpitJson(apiBaseUrl, `/api/v1/message/${summary.ID}`),
      )
    }
    if (Date.now() >= giveUpAt) {
      throw new Error(
        `gate found no message in its own Mailpit with subject ${JSON.stringify(subject)}; it holds ${list.messages_count} message(s): ${JSON.stringify(list.messages.map((message) => message.Subject))}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

/**
 * The magic link taken out of the PLAIN TEXT part, which CONTRACT.md makes an unconditional rule: the
 * emailed link always carries both `token` and `callbackURL`, React Email escapes the `&` between them
 * to `&amp;` in the HTML part, so the link appears verbatim in the text part and nowhere else. Throws
 * naming what it saw instead, because returning undefined here would let the next assertion pass
 * against a value the gate never really read.
 */
export function readMagicLinkFromMailpitTextPart(message: GateMailpitMessage): string {
  const magicLinkUrl = message.Text.match(/https?:\/\/\S*magic-link\/verify\S*/u)?.[0]
  if (magicLinkUrl === undefined) {
    throw new Error(
      `gate found no magic link verify URL in the plain text part of the message subject ${JSON.stringify(message.Subject)}: ${message.Text.slice(0, 400)}`,
    )
  }
  // Trailing punctuation the plain text renderer may sit next to the URL is not part of the link.
  return magicLinkUrl.replace(/[.,)\]]+$/u, '')
}
