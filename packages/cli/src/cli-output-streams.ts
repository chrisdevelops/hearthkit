/** Writes the one machine-readable line a successful command prints; stdout carries nothing else. */
export function writeStandardOutputLine(line: string): void {
  process.stdout.write(`${line}\n`)
}

/** Writes one human line to stderr: guidance, progress, or the failure message, never machine-readable output. */
export function writeStandardErrorLine(line: string): void {
  process.stderr.write(`${line}\n`)
}

/** Forwards a child process's stderr through unchanged, so docker compose progress reaches the operator as it happens. */
export function writeStandardErrorChunk(chunk: string): void {
  process.stderr.write(chunk)
}
