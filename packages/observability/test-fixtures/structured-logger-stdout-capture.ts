import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Messages the spawned script logs, shared with the gate so it can assert on exact stdout lines.
 * The default-level pair proves the info default, the named trio proves the name binding and that
 * anything below logLevel is dropped.
 */
export const structuredLoggerGateMessages = {
  defaultLevelDebug: 'gate default level debug message',
  defaultLevelInfo: 'gate default level info message',
  namedLoggerInfo: 'gate named logger info message',
  namedLoggerWarn: 'gate named logger warn message',
  namedLoggerError: 'gate named logger error message',
} as const

/** The loggerName the spawned script passes to createStructuredLogger; pino writes it as the name binding. */
export const structuredLoggerGateName = 'gate-observability-logger'

/** Everything the spawned process wrote, so the gate can prove the JSON lines went to stdout and not stderr. */
export type StructuredLoggerScriptOutput = {
  standardOutput: string
  standardError: string
  exitCode: number | null
}

const gateScriptPath = fileURLToPath(new URL('./structured-logger-gate-script.ts', import.meta.url))

/**
 * Runs the logger script in a fresh node process so the gate reads the real file descriptor 1,
 * which is the only honest way to check the contract's "writes newline-delimited JSON to stdout".
 */
export function runStructuredLoggerGateScript(): Promise<StructuredLoggerScriptOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', gateScriptPath],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let standardOutput = ''
    let standardError = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      standardOutput += chunk
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      standardError += chunk
    })

    child.on('error', reject)
    child.on('close', (exitCode) => resolve({ standardOutput, standardError, exitCode }))
  })
}

/** One parsed stdout line; pino's default JSON carries a numeric level, the message and any bindings. */
export type ParsedLogLine = {
  level?: unknown
  msg?: unknown
  name?: unknown
}

/** Parses captured stdout as newline-delimited JSON, failing the gate on the first line that is not JSON. */
export function parseNewlineDelimitedJsonLines(standardOutput: string): ParsedLogLine[] {
  return standardOutput
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as ParsedLogLine
      } catch {
        throw new Error(`gate expected every stdout line to be JSON, received: ${line}`)
      }
    })
}
