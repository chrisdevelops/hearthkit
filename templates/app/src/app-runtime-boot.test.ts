import { configInvalidErrorPrefix } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import {
  expectExportedFunction,
  importTemplateModule,
  messageOfThrownFrom,
} from '../test-fixtures/app-template-gate-expectations.ts'
import { readTemplateFileText } from '../test-fixtures/app-template-tree-files.ts'
import type { RequireAppRuntimeConfig } from './app-template-contract.ts'
import {
  appRuntimeConfigSchema,
  appStartupLogMessage,
  appTemplateEnvVariableNames,
  appTemplateFailureSchema,
} from './app-template-contract.ts'

/** A DSN that parses as an http url, so the populated-environment gate exercises the optional variable. */
const gateGlitchtipDsn = 'https://gatepublickey@glitchtip.example.com/7'

/** Names instrumentation.ts must call; it may not import src/, so the gate reads the file for them. */
const instrumentationWiringNames = [
  'requireAppRuntimeConfig',
  'initializeErrorReporting',
  'createStructuredLogger',
  'captureError',
]

const shapeKeysOf = (fragment: unknown): string[] => {
  const shape = (fragment as { shape?: Record<string, unknown> }).shape
  return shape === undefined ? [] : Object.keys(shape)
}

async function loadAppRuntimeConfigModule(): Promise<{
  requireAppRuntimeConfig: RequireAppRuntimeConfig
  appEnvSchemaFragments: readonly unknown[]
}> {
  const namespace = await importTemplateModule(
    'app-runtime-config.ts',
    () => import('../app-runtime-config.ts'),
  )
  const requireAppRuntimeConfig = expectExportedFunction(
    namespace,
    'requireAppRuntimeConfig',
    'app-runtime-config.ts',
  ) as unknown as RequireAppRuntimeConfig

  const fragments = namespace.appEnvSchemaFragments
  if (!Array.isArray(fragments)) {
    throw new Error(
      'gate expected templates/app/app-runtime-config.ts to export appEnvSchemaFragments as an array',
    )
  }

  return { requireAppRuntimeConfig, appEnvSchemaFragments: fragments as readonly unknown[] }
}

describe('requireAppRuntimeConfig', () => {
  it('boots with an empty environment because the Phase 4 template requires no variable', async () => {
    const { requireAppRuntimeConfig } = await loadAppRuntimeConfigModule()

    // The image builds and starts with nothing set, so every variable is optional or defaulted.
    const config = requireAppRuntimeConfig({ env: {} })

    expect(config.NODE_ENV).toBe('development')
    expect(config.LOG_LEVEL).toBe('info')
    expect(config.GLITCHTIP_DSN).toBeUndefined()
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('returns the composed config the contract schema describes for a populated environment', async () => {
    const { requireAppRuntimeConfig } = await loadAppRuntimeConfigModule()
    const env = {
      NODE_ENV: 'production',
      LOG_LEVEL: 'debug',
      GLITCHTIP_DSN: gateGlitchtipDsn,
    }

    const config = requireAppRuntimeConfig({ env })

    // appRuntimeConfigSchema (static, in the contract) and appEnvSchemaFragments (runtime, in
    // app-runtime-config.ts) hold the same information two ways; this is where they must agree.
    expect(config).toEqual(appRuntimeConfigSchema.parse(env))
    expect(config.NODE_ENV).toBe('production')
    expect(config.LOG_LEVEL).toBe('debug')
    expect(String(config.GLITCHTIP_DSN)).toBe(gateGlitchtipDsn)
  })

  it('throws config own prefixed message when a variable holds an invalid value', async () => {
    const { requireAppRuntimeConfig } = await loadAppRuntimeConfigModule()

    // No variable is required yet, so an invalid value is the only way to reach the boot failure.
    const message = messageOfThrownFrom(() =>
      requireAppRuntimeConfig({ env: { LOG_LEVEL: 'nope', GLITCHTIP_DSN: 'not-a-url' } }),
    )

    expect(message.startsWith(configInvalidErrorPrefix)).toBe(true)
    expect(message).toContain('LOG_LEVEL')
    expect(message).toContain('GLITCHTIP_DSN')

    const bootFailure = appTemplateFailureSchema.parse({ kind: 'app-boot-config-invalid', message })
    expect(bootFailure.kind).toBe('app-boot-config-invalid')
  })

  it('declares the same variables in appEnvSchemaFragments as the contract schema and .env.example', async () => {
    const { appEnvSchemaFragments } = await loadAppRuntimeConfigModule()

    const fragmentVariableNames = appEnvSchemaFragments.flatMap(shapeKeysOf).toSorted()
    const contractVariableNames = [...appTemplateEnvVariableNames].toSorted()

    expect(fragmentVariableNames).toEqual(contractVariableNames)
    expect(Object.keys(appRuntimeConfigSchema.shape).toSorted()).toEqual(contractVariableNames)

    // .env.example documents exactly this set, whether the line is commented out or not.
    const documentedVariableNames = [
      ...new Set(
        [...readTemplateFileText('.env.example').matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/gm)]
          .map((match) => match[1])
          .filter((variableName): variableName is string => variableName !== undefined),
      ),
    ].toSorted()
    expect(documentedVariableNames).toEqual(contractVariableNames)
  })
})

describe('instrumentation.ts', () => {
  it('exports register and onRequestError and logs the startup message the contract names', async () => {
    const namespace = await importTemplateModule(
      'instrumentation.ts',
      () => import('../instrumentation.ts'),
    )

    expectExportedFunction(namespace, 'register', 'instrumentation.ts')
    expectExportedFunction(namespace, 'onRequestError', 'instrumentation.ts')

    // instrumentation.ts sits outside src/, so it repeats the startup message as a literal; this is
    // the only thing keeping that literal and appStartupLogMessage in step.
    const instrumentationText = readTemplateFileText('instrumentation.ts')
    expect(instrumentationText).toContain(appStartupLogMessage)

    const missingWiringNames = instrumentationWiringNames.filter(
      (wiringName) => !instrumentationText.includes(wiringName),
    )
    expect(missingWiringNames).toEqual([])
  })
})
