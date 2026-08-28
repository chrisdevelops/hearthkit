import { pino } from 'pino'
import {
  createStructuredLoggerOptionsSchema,
  type CreateStructuredLogger,
} from './observability-contract.ts'

/** Builds a pino logger writing newline-delimited JSON to stdout; unusable options fall back to info level. */
export const createStructuredLogger: CreateStructuredLogger = (options) => {
  const parsedOptions = createStructuredLoggerOptionsSchema.safeParse(options ?? {})
  const logLevel = parsedOptions.success ? parsedOptions.data.logLevel : 'info'
  const loggerName = parsedOptions.success ? parsedOptions.data.loggerName : undefined

  // pino's default destination is stdout, which is exactly what Docker and Dokploy capture.
  return loggerName === undefined
    ? pino({ level: logLevel })
    : pino({ level: logLevel, name: loggerName })
}
