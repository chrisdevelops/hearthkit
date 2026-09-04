import { createServer, type Server, type Socket } from 'node:net'
import { smtpHostNameSchema, type SmtpHostName } from '../src/email-contract.ts'

/**
 * A TCP listener that answers on the SMTP port but is not an SMTP server. Two transport signals in the
 * contract's mapping table have no other producer: a server that accepts and never greets (the
 * greeting timeout the contract sets explicitly) and a server whose greeting is not SMTP at all (the
 * unnamed error that must land in the catch-all). Neither can be asked of Mailpit.
 */
export type GateSmtpImposterServer = {
  smtpHostName: SmtpHostName
  smtpPortNumber: number
  closeGateSmtpImposterServer: () => Promise<void>
}

/** What the imposter says when a client connects. */
export type GateSmtpImposterBehaviour =
  /** Accepts the connection and stays silent forever, so only the greeting timeout ends the attempt. */
  | 'never-greets'
  /** Answers with an HTTP status line, which is a valid TCP answer and an invalid SMTP greeting. */
  | 'garbage-greeting'

const garbageGreetingLine = 'HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'

/** Starts the imposter on an ephemeral loopback port; every socket it opened is destroyed when it closes. */
export async function startGateSmtpImposterServer(
  behaviour: GateSmtpImposterBehaviour,
): Promise<GateSmtpImposterServer> {
  const openSockets = new Set<Socket>()

  const server: Server = createServer((socket: Socket) => {
    openSockets.add(socket)
    socket.on('error', () => undefined)
    socket.on('close', () => openSockets.delete(socket))
    socket.resume()
    if (behaviour === 'garbage-greeting') {
      socket.write(garbageGreetingLine)
    }
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
    throw new Error('gate expected the SMTP imposter server to be listening on a TCP port')
  }

  return {
    smtpHostName: smtpHostNameSchema.parse('127.0.0.1'),
    smtpPortNumber: address.port,
    closeGateSmtpImposterServer: () =>
      new Promise<void>((resolve) => {
        for (const socket of openSockets) {
          socket.destroy()
        }
        server.close(() => resolve())
      }),
  }
}
