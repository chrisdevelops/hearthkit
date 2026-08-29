import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { storageEndpointUrlSchema, type StorageEndpointUrl } from '../src/storage-contract.ts'

/**
 * A stand-in object store that answers every request with 500. The contract names this in-process
 * node:http technique for the storage-request-failed gate, the same one the observability gates use,
 * because no container can be made to return a server error on demand.
 */
export type FailingStorageServer = {
  storageEndpointUrl: StorageEndpointUrl
  receivedRequestCount: () => number
  closeFailingStorageServer: () => Promise<void>
}

// An S3-shaped error body, so the SDK surfaces a real error code on the paths that parse one.
const forcedFailureBody =
  '<?xml version="1.0" encoding="UTF-8"?><Error><Code>InternalError</Code>' +
  '<Message>gate forced object store failure</Message></Error>'

/** Starts the failing stand-in on an ephemeral loopback port and answers everything with 500. */
export async function startFailingStorageServer(): Promise<FailingStorageServer> {
  let receivedRequests = 0
  const openSockets = new Set<Socket>()

  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    receivedRequests += 1
    request.resume()
    response.writeHead(500, { 'content-type': 'application/xml' })
    response.end(request.method === 'HEAD' ? undefined : forcedFailureBody)
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
    throw new Error('gate expected the failing storage server to be listening on a TCP port')
  }

  return {
    storageEndpointUrl: storageEndpointUrlSchema.parse(
      `http://127.0.0.1:${(address as AddressInfo).port}`,
    ),
    receivedRequestCount: () => receivedRequests,
    closeFailingStorageServer: () =>
      new Promise<void>((resolve) => {
        for (const socket of openSockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      }),
  }
}
