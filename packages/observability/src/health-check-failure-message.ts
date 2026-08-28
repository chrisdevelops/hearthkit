const healthCheckFailureMessageMaxLength = 200

/** Reduces any thrown value to the first line of its message, capped at 200 chars so /health never leaks a stack. */
export function deriveHealthCheckFailureMessage(thrown: unknown): string {
  let rawFailureMessage: string
  try {
    rawFailureMessage = thrown instanceof Error ? thrown.message : String(thrown)
  } catch {
    // A thrown value whose toString itself throws still has to produce a printable line.
    rawFailureMessage = 'health check rejected with a value that cannot be converted to a string'
  }

  const [firstLine = ''] = rawFailureMessage.split(/\r?\n/)
  return firstLine.slice(0, healthCheckFailureMessageMaxLength)
}
