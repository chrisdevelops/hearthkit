// Spawned with plain node by the createStructuredLogger gate. It writes through the package's own
// public entry point so the gate can read the real stdout of a real process, which is what the
// contract promises. Keep this file to erasable TypeScript: node strips the types, it does not compile.
import { createStructuredLogger } from '../src/index.ts'
import {
  structuredLoggerGateMessages,
  structuredLoggerGateName,
} from './structured-logger-stdout-capture.ts'

const defaultLogger = createStructuredLogger()
defaultLogger.debug(structuredLoggerGateMessages.defaultLevelDebug)
defaultLogger.info(structuredLoggerGateMessages.defaultLevelInfo)

const namedLogger = createStructuredLogger({
  logLevel: 'warn',
  loggerName: structuredLoggerGateName,
})
namedLogger.info(structuredLoggerGateMessages.namedLoggerInfo)
namedLogger.warn(structuredLoggerGateMessages.namedLoggerWarn)
namedLogger.error(structuredLoggerGateMessages.namedLoggerError)

// pino's default stdout destination is synchronous; this keeps the loop alive for one short tick so
// no line is lost if an implementation picks an asynchronous destination instead.
setTimeout(() => undefined, 50)
