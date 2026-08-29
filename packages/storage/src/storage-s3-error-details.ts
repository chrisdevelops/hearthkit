// Node socket and DNS failures that all mean the same thing to a caller: the endpoint answered
// nothing at all, so there is no HTTP status and no S3 error code to report.
const unreachableSystemErrorCodes = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
])

// Reads one string property off a value of unknown shape without asserting anything about it.
function readSystemErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' ? error.code : undefined
  }
  return undefined
}

function readErrorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return typeof error.name === 'string' ? error.name : undefined
  }
  return undefined
}

function readErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return typeof error.message === 'string' ? error.message : undefined
  }
  return undefined
}

function readS3ErrorBodyCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'Code' in error) {
    return typeof error.Code === 'string' ? error.Code : undefined
  }
  return undefined
}

// An AggregateError's `errors` array, widened to unknown so nothing here ever touches `any`.
function readAggregatedErrors(error: unknown): readonly unknown[] {
  if (typeof error === 'object' && error !== null && 'errors' in error) {
    const aggregated = error.errors
    return Array.isArray(aggregated) ? Array.from<unknown>(aggregated) : []
  }
  return []
}

function readErrorCause(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    return error.cause
  }
  return undefined
}

/**
 * Whether the endpoint was never reached. Walks aggregated errors and causes because Node reports a
 * host with two addresses as an AggregateError whose own message is empty.
 */
export function isStorageEndpointUnreachableError(error: unknown): boolean {
  const pending: unknown[] = [error]
  const visited = new Set<unknown>()

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || current === null || visited.has(current)) {
      continue
    }
    visited.add(current)

    const systemErrorCode = readSystemErrorCode(current)
    if (systemErrorCode !== undefined && unreachableSystemErrorCodes.has(systemErrorCode)) {
      return true
    }
    pending.push(...readAggregatedErrors(current), readErrorCause(current))
  }
  return false
}

/** The HTTP status the object store answered with, or undefined when the request never got a response. */
export function readStorageErrorStatusCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && '$metadata' in error) {
    const metadata = error.$metadata
    if (typeof metadata === 'object' && metadata !== null && 'httpStatusCode' in metadata) {
      return typeof metadata.httpStatusCode === 'number' ? metadata.httpStatusCode : undefined
    }
  }
  return undefined
}

/**
 * The S3 error code, falling back to the SDK error name and then to a literal, because a HEAD
 * response has no XML body and so carries no code at all. Never empty.
 */
export function readStorageErrorCode(error: unknown): string {
  const bodyCode = readS3ErrorBodyCode(error)
  if (bodyCode !== undefined && bodyCode.length > 0) {
    return bodyCode
  }
  const errorName = readErrorName(error)
  if (errorName !== undefined && errorName.length > 0) {
    return errorName
  }
  return 'UnknownStorageError'
}

/** Human-readable words for a caught value, falling back to the error name when the message is empty. */
export function describeStorageError(error: unknown): string {
  const message = readErrorMessage(error)
  if (message !== undefined && message.length > 0) {
    return message
  }
  const errorName = readErrorName(error) ?? String(error)
  const systemErrorCode = readSystemErrorCode(error)
  return systemErrorCode === undefined ? errorName : `${errorName} (${systemErrorCode})`
}
