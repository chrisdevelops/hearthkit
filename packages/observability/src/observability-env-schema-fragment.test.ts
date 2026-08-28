import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import {
  importHearthkitObservabilityNamespace,
  loadHearthkitObservabilityEntry,
} from '../test-fixtures/hearthkit-observability-entry.ts'
import { expectObservabilityResultKind } from '../test-fixtures/observability-gate-expectations.ts'
import {
  healthCheckNameConflictErrorPrefix,
  observabilityFlushTimeoutErrorPrefix,
  observabilityInvalidDsnErrorPrefix,
} from './observability-contract.ts'

const gateGlitchtipDsn = 'https://gatepublickey@glitchtip.example.com/7'

describe('observabilityEnvSchemaFragment', () => {
  it('makes GLITCHTIP_DSN optional and defaults LOG_LEVEL to info, treating an empty string as unset', async () => {
    const { observabilityEnvSchemaFragment } = await loadHearthkitObservabilityEntry()
    expect(Object.keys(observabilityEnvSchemaFragment.shape).toSorted()).toEqual([
      'GLITCHTIP_DSN',
      'LOG_LEVEL',
    ])

    const withNothingSet = expectObservabilityResultKind(
      loadHearthkitConfig({ fragments: [observabilityEnvSchemaFragment], env: {} }),
      'config-loaded',
    )
    expect(withNothingSet.config.LOG_LEVEL).toBe('info')
    expect(withNothingSet.config.GLITCHTIP_DSN).toBeUndefined()

    const withEmptyStrings = expectObservabilityResultKind(
      loadHearthkitConfig({
        fragments: [observabilityEnvSchemaFragment],
        env: { GLITCHTIP_DSN: '', LOG_LEVEL: '' },
      }),
      'config-loaded',
    )
    expect(withEmptyStrings.config.LOG_LEVEL).toBe('info')
    expect(withEmptyStrings.config.GLITCHTIP_DSN).toBeUndefined()

    const withBothSet = expectObservabilityResultKind(
      loadHearthkitConfig({
        fragments: [observabilityEnvSchemaFragment],
        env: { GLITCHTIP_DSN: gateGlitchtipDsn, LOG_LEVEL: 'debug' },
      }),
      'config-loaded',
    )
    expect(withBothSet.config.LOG_LEVEL).toBe('debug')
    expect(String(withBothSet.config.GLITCHTIP_DSN)).toBe(gateGlitchtipDsn)
  })

  it('fails and names the variable when GLITCHTIP_DSN is not an http url or LOG_LEVEL is not a pino level', async () => {
    const { observabilityEnvSchemaFragment } = await loadHearthkitObservabilityEntry()

    const failure = expectObservabilityResultKind(
      loadHearthkitConfig({
        fragments: [observabilityEnvSchemaFragment],
        env: { GLITCHTIP_DSN: 'glitchtip.example.com/7', LOG_LEVEL: 'verbose' },
      }),
      'config-validation-failed',
    )

    expect(failure.message).toContain('GLITCHTIP_DSN')
    expect(failure.message).toContain('LOG_LEVEL')
    expect(failure.issues).toHaveLength(2)
  })
})

describe('@hearthkit/observability entry point', () => {
  it('re-exports the error prefixes and the schemas gates parse results with', async () => {
    const namespace = await importHearthkitObservabilityNamespace()

    expect(namespace.observabilityInvalidDsnErrorPrefix).toBe(observabilityInvalidDsnErrorPrefix)
    expect(namespace.observabilityFlushTimeoutErrorPrefix).toBe(
      observabilityFlushTimeoutErrorPrefix,
    )
    expect(namespace.healthCheckNameConflictErrorPrefix).toBe(healthCheckNameConflictErrorPrefix)

    const contractSchemaNames = [
      'observabilityFailureSchema',
      'initializeErrorReportingResultSchema',
      'captureErrorResultSchema',
      'flushErrorReportingResultSchema',
      'healthCheckResultSchema',
      'healthReportSchema',
      'namedHealthCheckSchema',
      'glitchtipDsnSchema',
      'logLevelNameSchema',
      'healthCheckNameSchema',
      'errorEventIdSchema',
    ]
    for (const schemaName of contractSchemaNames) {
      const schemaExport = namespace[schemaName] as { parse?: unknown } | undefined
      expect(
        typeof schemaExport?.parse,
        `${schemaName} must be re-exported from src/index.ts`,
      ).toBe('function')
    }
  })
})
