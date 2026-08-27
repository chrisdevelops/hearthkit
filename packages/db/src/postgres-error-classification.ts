/**
 * Errno strings Node puts on socket failures and SQLSTATEs Postgres returns while a session is
 * still being established. Either means the server was never reached on this connection string.
 */
const postgresConnectionFailureCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'EPROTO',
  'ETIMEDOUT',
  'EAI_AGAIN',
  '28000',
  '28P01',
  '3D000',
  '53300',
  '57P03',
])

/** SQLSTATE Postgres returns when the connected role lacks the privilege for the statement it was asked to run. */
const postgresInsufficientPrivilegeCode = '42501'

/** SQLSTATEs meaning the name is already taken: duplicate_database and duplicate_object (the same-named role). */
const postgresDuplicateNameCodes = new Set(['42P04', '42710'])

/** Reads the `code` node-postgres puts on driver errors: an errno such as ECONNREFUSED, or a SQLSTATE such as 42501. */
export function readPostgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/** Readable text for anything thrown, so a returned failure message never renders as [object Object]. */
export function describeCaughtError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** True when the error means the server could not be reached or refused the connection, rather than rejecting a statement. */
export function isPostgresConnectionFailure(error: unknown): boolean {
  const code = readPostgresErrorCode(error)
  if (code !== undefined && (postgresConnectionFailureCodes.has(code) || code.startsWith('08'))) {
    return true
  }
  const description = describeCaughtError(error).toLowerCase()
  return (
    description.includes('connection terminated') ||
    description.includes('timeout exceeded when trying to connect') ||
    description.includes('client has encountered a connection error')
  )
}

/** True when Postgres rejected the statement because the connected role lacks the privilege for it. */
export function isPostgresPrivilegeFailure(error: unknown): boolean {
  return readPostgresErrorCode(error) === postgresInsufficientPrivilegeCode
}

/** True when Postgres rejected the statement because a database or role of that name is already there. */
export function isPostgresDuplicateNameFailure(error: unknown): boolean {
  const code = readPostgresErrorCode(error)
  return code !== undefined && postgresDuplicateNameCodes.has(code)
}
