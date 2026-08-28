import { describe, expect, it } from 'vitest'
import {
  parseNewlineDelimitedJsonLines,
  runStructuredLoggerGateScript,
  structuredLoggerGateMessages,
  structuredLoggerGateName,
} from '../test-fixtures/structured-logger-stdout-capture.ts'

describe('createStructuredLogger', () => {
  it('writes newline-delimited JSON to stdout, drops messages below logLevel and binds loggerName as name', async () => {
    const { standardOutput, standardError, exitCode } = await runStructuredLoggerGateScript()

    expect(exitCode, `gate script failed, stderr was: ${standardError || '(empty)'}`).toBe(0)

    const logLines = parseNewlineDelimitedJsonLines(standardOutput)

    // The default logger is info level: debug is dropped, info survives, and there is no name binding.
    const defaultInfoLine = logLines.find(
      (line) => line.msg === structuredLoggerGateMessages.defaultLevelInfo,
    )
    expect(defaultInfoLine, 'the default logger must write its info message').toBeDefined()
    expect(defaultInfoLine?.level).toBe(30)
    expect(defaultInfoLine?.name).toBeUndefined()

    // The named logger is warn level: info is dropped, warn and error survive and carry the name.
    const namedWarnLine = logLines.find(
      (line) => line.msg === structuredLoggerGateMessages.namedLoggerWarn,
    )
    const namedErrorLine = logLines.find(
      (line) => line.msg === structuredLoggerGateMessages.namedLoggerError,
    )
    expect(namedWarnLine?.level).toBe(40)
    expect(namedErrorLine?.level).toBe(50)
    expect(namedWarnLine?.name).toBe(structuredLoggerGateName)
    expect(namedErrorLine?.name).toBe(structuredLoggerGateName)

    // Exactly the three surviving messages, nothing below the configured level.
    expect(logLines).toHaveLength(3)
    expect(standardOutput).not.toContain(structuredLoggerGateMessages.defaultLevelDebug)
    expect(standardOutput).not.toContain(structuredLoggerGateMessages.namedLoggerInfo)

    // Logs go to stdout, which is what Docker and Dokploy capture; never to stderr.
    for (const droppedOrKeptMessage of Object.values(structuredLoggerGateMessages)) {
      expect(standardError).not.toContain(droppedOrKeptMessage)
    }
  })
})
