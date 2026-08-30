// Reads fields off a value of unknown shape without asserting anything about it. Nodemailer throws a
// plain Error decorated with `code`, `command` and `responseCode`, and a throwing React Email template
// throws a plain Error with no distinctive type at all, so nothing here may match on a class.

function readErrorMessage(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return typeof error.message === 'string' && error.message.length > 0 ? error.message : undefined
  }
  return undefined
}

function readErrorName(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    return typeof error.name === 'string' && error.name.length > 0 ? error.name : undefined
  }
  return undefined
}

function readErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return typeof error.code === 'string' && error.code.length > 0 ? error.code : undefined
  }
  return undefined
}

function readErrorResponseCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'responseCode' in error) {
    return typeof error.responseCode === 'number' && Number.isInteger(error.responseCode)
      ? error.responseCode
      : undefined
  }
  return undefined
}

/** Words for a caught value that are always non-empty, because every failure detail the contract carries has a minimum length of one. */
export function describeThrownEmailError(error: unknown): string {
  const message = readErrorMessage(error)
  if (message !== undefined) {
    return message
  }
  const errorName = readErrorName(error)
  if (errorName !== undefined) {
    return errorName
  }
  const describedError = String(error)
  return describedError.length > 0 ? describedError : 'an error with no message'
}

/** Nodemailer's own error code, such as ESOCKET or EENVELOPE; the literal below when it threw something with no code. */
export function readSmtpErrorCode(error: unknown): string {
  return readErrorCode(error) ?? 'UNKNOWN_SMTP_ERROR'
}

/** The three-digit SMTP status the server answered with, such as 451, or undefined when the server never answered. */
export function readSmtpResponseCode(error: unknown): number | undefined {
  return readErrorResponseCode(error)
}
