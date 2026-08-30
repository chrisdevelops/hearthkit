import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { resendBaseUrlSchema, type ResendBaseUrl } from '../src/email-contract.ts'

/**
 * A stand-in for Resend's HTTP API, reached by pointing EMAIL_RESEND_BASE_URL at it. The real Resend
 * SDK talks to this over a real socket and is never mocked, which is the whole reason the base URL is
 * in the contract: without it the Resend transport could only be proved against a fake of itself.
 */
export type GateResendApiServer = {
  resendBaseUrl: ResendBaseUrl
  setGateResendResponse: (response: GateResendResponse) => void
  takeGateResendRequests: () => GateResendRequest[]
  closeGateResendApiServer: () => Promise<void>
}

/** What the stand-in answers with next; switched per gate so one server covers acceptance and refusal. */
export type GateResendResponse =
  | { kind: 'gate-resend-accepts'; emailId: string }
  | {
      kind: 'gate-resend-rejects'
      httpStatusCode: number
      errorName: string
      errorMessage: string
    }

/** One request the package's Resend client actually made, recorded so a gate can read the wire, not a spy. */
export type GateResendRequest = {
  method: string
  requestPath: string
  authorizationHeader: string | undefined
  userAgentHeader: string | undefined
  jsonBody: Record<string, unknown>
}

function readJsonBody(bodyText: string): Record<string, unknown> {
  if (bodyText.length === 0) {
    return {}
  }
  const parsed: unknown = JSON.parse(bodyText)
  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
}

/** Starts the stand-in on an ephemeral loopback port, accepting every request until told to reject. */
export async function startGateResendApiServer(): Promise<GateResendApiServer> {
  const receivedRequests: GateResendRequest[] = []
  const openSockets = new Set<Socket>()
  let nextResponse: GateResendResponse = {
    kind: 'gate-resend-accepts',
    emailId: '00000000-0000-4000-8000-000000000000',
  }

  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      receivedRequests.push({
        method: request.method ?? '',
        requestPath: request.url ?? '',
        authorizationHeader: request.headers.authorization,
        userAgentHeader: request.headers['user-agent'],
        jsonBody: readJsonBody(Buffer.concat(chunks).toString('utf8')),
      })

      if (nextResponse.kind === 'gate-resend-accepts') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ id: nextResponse.emailId }))
        return
      }
      response.writeHead(nextResponse.httpStatusCode, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          statusCode: nextResponse.httpStatusCode,
          name: nextResponse.errorName,
          message: nextResponse.errorMessage,
        }),
      )
    })
  })
  server.on('connection', (socket: Socket) => {
    openSockets.add(socket)
    socket.on('close', () => openSockets.delete(socket))
    socket.on('error', () => undefined)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('gate expected the Resend stand-in server to be listening on a TCP port')
  }

  return {
    resendBaseUrl: resendBaseUrlSchema.parse(`http://127.0.0.1:${address.port}`),
    setGateResendResponse: (response) => {
      nextResponse = response
    },
    takeGateResendRequests: () => receivedRequests.splice(0, receivedRequests.length),
    closeGateResendApiServer: () =>
      new Promise<void>((resolve) => {
        for (const socket of openSockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      }),
  }
}
