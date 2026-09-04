import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  authBaseUrlSchema,
  type AuthBaseUrl,
  type AuthServerInstance,
} from '../src/auth-contract.ts'

/**
 * A loopback HTTP listener that hands every request to whichever auth server instance is currently
 * routed to it, so a browser client built by this package can reach a server instance built by it.
 *
 * CONTRACT.md leaves the arrangement to the gate: "the gate stubs global `fetch` to call
 * `authServerInstance.handler(request)` or puts the handler behind a real listener". This is the
 * listener half, and it was chosen over the fetch stub after measuring two things at
 * better-auth@1.7.2 that make the stub the more fragile of the two.
 *
 * First, `createAuthClient` captures the fetch implementation at CONSTRUCTION time, not per call:
 * `better-auth/dist/client/config.mjs` passes `customFetchImpl: fetch` into `createFetch`. A gate that
 * assigns `globalThis.fetch` after building its client silently keeps the real one, and the stub is
 * never called. Second, a client built against `http://localhost:3000` whose stub does not take then
 * makes a REAL request: on the machine this fixture was written on, something was listening on that
 * port and answered 307, so the gate would have been asserting against a stranger. A listener on an
 * ephemeral loopback port has neither problem — nothing else can be on the port, and the request
 * genuinely crosses a socket, which is what "at the network boundary" is supposed to mean.
 *
 * It contacts no service. The instance behind it may be built over a Drizzle client aimed at a dead
 * port, because route resolution and the session check both happen before any query.
 */

/** A running loopback listener, the base URL a browser client should be built with, and what it saw. */
export type GateAuthRouteHandlerListener = {
  baseUrl: AuthBaseUrl
  routeGateRequestsTo: (authServerInstance: AuthServerInstance) => void
  recordedGateRequests: () => GateHandledRequest[]
  closeGateAuthRouteHandlerListener: () => Promise<void>
}

/** One request the listener passed to a server instance, and the status that instance answered with. */
export type GateHandledRequest = {
  method: string
  pathname: string
  responseStatus: number
}

function readGateRequestHeaders(incoming: IncomingMessage): Headers {
  const headers = new Headers()
  for (const [headerName, headerValue] of Object.entries(incoming.headers)) {
    if (Array.isArray(headerValue)) {
      for (const value of headerValue) {
        headers.append(headerName, value)
      }
    } else if (headerValue !== undefined) {
      headers.set(headerName, headerValue)
    }
  }
  return headers
}

// Typed as BodyInit rather than Buffer or Uint8Array: both of those are generic over ArrayBufferLike
// at this TypeScript version and neither satisfies BodyInit under the workspace's strict settings,
// which is a compile error rather than anything a run would show.
async function readGateRequestBody(incoming: IncomingMessage): Promise<BodyInit | undefined> {
  if (incoming.method === 'GET' || incoming.method === 'HEAD') {
    return undefined
  }
  const chunks: Buffer[] = []
  for await (const chunk of incoming) {
    chunks.push(Buffer.from(chunk as Buffer))
  }
  return chunks.length === 0 ? undefined : new Uint8Array(Buffer.concat(chunks))
}

async function writeGateResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  const setCookieValues = response.headers.getSetCookie()
  const headerEntries: [string, string | string[]][] = []
  for (const [headerName, headerValue] of response.headers.entries()) {
    if (headerName.toLowerCase() !== 'set-cookie') {
      headerEntries.push([headerName, headerValue])
    }
  }
  if (setCookieValues.length > 0) {
    headerEntries.push(['set-cookie', setCookieValues])
  }
  outgoing.writeHead(response.status, Object.fromEntries(headerEntries))
  outgoing.end(Buffer.from(await response.arrayBuffer()))
}

/**
 * Starts the listener on an ephemeral loopback port. Nothing is routed to it yet, and a request that
 * arrives before `routeGateRequestsTo` is called is answered 500 rather than silently, so a gate that
 * forgot to route fails saying so instead of asserting on a status nobody chose.
 */
export async function startGateAuthRouteHandlerListener(): Promise<GateAuthRouteHandlerListener> {
  let routedAuthServerInstance: AuthServerInstance | undefined
  const handledRequests: GateHandledRequest[] = []

  const server: Server = createServer((incoming, outgoing) => {
    void (async () => {
      const listenerAddress = server.address()
      const listenerPort =
        listenerAddress !== null && typeof listenerAddress !== 'string' ? listenerAddress.port : 0
      const requestUrl = new URL(incoming.url ?? '/', `http://127.0.0.1:${listenerPort}`)

      if (routedAuthServerInstance === undefined) {
        outgoing.writeHead(500, { 'content-type': 'text/plain' })
        outgoing.end('gate listener has no auth server instance routed to it yet')
        return
      }

      const request = new Request(requestUrl, {
        method: incoming.method ?? 'GET',
        headers: readGateRequestHeaders(incoming),
        body: await readGateRequestBody(incoming),
      })
      const response = await routedAuthServerInstance.handler(request)
      handledRequests.push({
        method: request.method,
        pathname: requestUrl.pathname,
        responseStatus: response.status,
      })
      await writeGateResponse(outgoing, response)
    })().catch((error: unknown) => {
      outgoing.writeHead(500, { 'content-type': 'text/plain' })
      outgoing.end(
        `gate listener could not hand the request to the auth server instance: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
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
    throw new Error('gate expected its route handler listener to be bound to a TCP port')
  }

  return {
    // An empty path, which is what AUTH_BASE_URL is required to have.
    baseUrl: authBaseUrlSchema.parse(`http://127.0.0.1:${address.port}`),
    routeGateRequestsTo: (authServerInstance) => {
      routedAuthServerInstance = authServerInstance
    },
    recordedGateRequests: () => [...handledRequests],
    closeGateAuthRouteHandlerListener: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
