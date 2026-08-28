import type { GlitchtipDsn } from './observability-contract.ts'

/** The two DSN pieces the ingest endpoint needs, or the reason the DSN cannot be used at all. */
export type GlitchtipDsnParts =
  | { kind: 'glitchtip-dsn-parsed'; publicKey: string; projectId: string }
  | { kind: 'glitchtip-dsn-malformed'; malformedReason: string }

/** Reads the public key and project id out of a DSN; glitchtipDsnSchema already proved it is an http(s) URL. */
export function parseGlitchtipDsnParts(glitchtipDsn: GlitchtipDsn): GlitchtipDsnParts {
  let dsnUrl: URL
  try {
    dsnUrl = new URL(String(glitchtipDsn))
  } catch {
    return { kind: 'glitchtip-dsn-malformed', malformedReason: 'it is not a parseable URL' }
  }

  const publicKey = decodeURIComponent(dsnUrl.username)
  if (publicKey.length === 0) {
    return {
      kind: 'glitchtip-dsn-malformed',
      malformedReason: 'it has no public key before the at-sign',
    }
  }

  const projectId = dsnUrl.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .at(-1)
  if (projectId === undefined) {
    return {
      kind: 'glitchtip-dsn-malformed',
      malformedReason: 'it has no project id as the last path segment',
    }
  }

  return { kind: 'glitchtip-dsn-parsed', publicKey, projectId }
}
