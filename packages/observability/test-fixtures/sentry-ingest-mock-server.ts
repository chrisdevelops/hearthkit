import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { gunzipSync } from 'node:zlib'
import { glitchtipDsnSchema, type GlitchtipDsn } from '../src/observability-contract.ts'

/**
 * One request the SDK sent to the local ingest endpoint. GlitchTip cannot run in-process, so this
 * in-process Node HTTP server stands in for it; the contract names it as the sanctioned stand-in.
 */
export type ReceivedIngestRequest = {
  requestMethod: string
  requestPath: string
  requestBody: string
}

/** A started stand-in for GlitchTip's ingest endpoint, plus the DSN shapes the gates point at it. */
export type SentryIngestMockServer = {
  glitchtipDsn: GlitchtipDsn
  dsnWithoutPublicKey: GlitchtipDsn
  dsnWithoutProjectId: GlitchtipDsn
  envelopeIngestPath: string
  receivedRequests: ReceivedIngestRequest[]
  receivedEnvelopeRequests: () => ReceivedIngestRequest[]
  closeIngestMockServer: () => Promise<void>
}

/** A started server that accepts connections and never answers, so pending error reports can never drain. */
export type UnresponsiveIngestServer = {
  glitchtipDsn: GlitchtipDsn
  closeIngestMockServer: () => Promise<void>
}

const gatePublicKey = 'gatepublickey'
const gateProjectId = '1'

function serverPort(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('gate expected the ingest mock server to be listening on a TCP port')
  }
  return (address as AddressInfo).port
}

function listenOnEphemeralPort(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

function trackOpenSockets(server: Server): Set<Socket> {
  const openSockets = new Set<Socket>()
  server.on('connection', (socket: Socket) => {
    openSockets.add(socket)
    socket.on('close', () => openSockets.delete(socket))
    socket.on('error', () => undefined)
  })
  return openSockets
}

function closeServer(server: Server, openSockets: Set<Socket>): Promise<void> {
  for (const socket of openSockets) {
    socket.destroy()
  }
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('error', reject)
    request.on('end', () => {
      const raw = Buffer.concat(chunks)
      // Envelopes may arrive gzipped depending on the SDK's transport settings.
      if (request.headers['content-encoding'] === 'gzip') {
        try {
          resolve(gunzipSync(raw).toString('utf8'))
          return
        } catch {
          resolve(raw.toString('utf8'))
          return
        }
      }
      resolve(raw.toString('utf8'))
    })
  })
}

/**
 * Starts the local stand-in for GlitchTip's ingest endpoint on an ephemeral port and answers every
 * POST with 200, so the SDK counts the envelope as delivered and flush resolves.
 */
export async function startSentryIngestMockServer(): Promise<SentryIngestMockServer> {
  const receivedRequests: ReceivedIngestRequest[] = []

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void readRequestBody(request).then((requestBody) => {
      receivedRequests.push({
        requestMethod: request.method ?? '',
        requestPath: request.url ?? '',
        requestBody,
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ id: 'gate-accepted-envelope' }))
    })
  })
  const openSockets = trackOpenSockets(server)
  await listenOnEphemeralPort(server)

  const port = serverPort(server)
  const envelopeIngestPath = `/api/${gateProjectId}/envelope/`

  return {
    glitchtipDsn: glitchtipDsnSchema.parse(
      `http://${gatePublicKey}@127.0.0.1:${port}/${gateProjectId}`,
    ),
    // URL-valid but not DSN-shaped: no public key before the at-sign, and no project id segment.
    dsnWithoutPublicKey: glitchtipDsnSchema.parse(`http://127.0.0.1:${port}/${gateProjectId}`),
    dsnWithoutProjectId: glitchtipDsnSchema.parse(`http://${gatePublicKey}@127.0.0.1:${port}/`),
    envelopeIngestPath,
    receivedRequests,
    // Compared on the pathname only: the Sentry protocol appends its auth as query parameters
    // (sentry_version, sentry_key), and the contract asks only that a POST reaches the envelope path.
    receivedEnvelopeRequests: () =>
      receivedRequests.filter(
        (received) =>
          received.requestMethod === 'POST' &&
          new URL(received.requestPath, 'http://127.0.0.1').pathname === envelopeIngestPath,
      ),
    closeIngestMockServer: () => closeServer(server, openSockets),
  }
}

/**
 * Starts a server that accepts the connection, reads the envelope and never responds, so a flush
 * with a short timeout can never see delivery complete.
 */
export async function startUnresponsiveIngestServer(): Promise<UnresponsiveIngestServer> {
  const server = createServer((request: IncomingMessage) => {
    request.resume()
    // Deliberately no response: the socket stays open until the gate closes the server.
  })
  const openSockets = trackOpenSockets(server)
  await listenOnEphemeralPort(server)

  return {
    glitchtipDsn: glitchtipDsnSchema.parse(
      `http://${gatePublicKey}@127.0.0.1:${serverPort(server)}/${gateProjectId}`,
    ),
    closeIngestMockServer: () => closeServer(server, openSockets),
  }
}
