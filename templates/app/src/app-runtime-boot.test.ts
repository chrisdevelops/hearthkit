import { configInvalidErrorPrefix } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import {
  expectExportedFunction,
  importTemplateModule,
  messageOfThrownFrom,
} from '../test-fixtures/app-template-gate-expectations.ts'
import { gateSupersetEnv } from '../test-fixtures/app-template-gate-environment.ts'
import {
  fileLinesInsideSectionBlocksOf,
  fileLinesOutsideSectionBlocks,
} from '../test-fixtures/app-template-section-markers.ts'
import {
  documentedEnvVariableNamesIn,
  readTemplateFileText,
} from '../test-fixtures/app-template-tree-files.ts'
import type { RequireAppRuntimeConfig } from './app-template-contract.ts'
import {
  appRuntimeConfigSchema,
  appStartupLogMessage,
  appTemplateEnvBlockMismatchErrorPrefix,
  appTemplateEnvVariableNames,
  appTemplateFailureSchema,
  appTemplateOptionalPackageNames,
  appTemplateSectionBlockBeginPrefix,
  appTemplateSectionBlockEndPrefix,
  appTemplateSectionsByOptionalPackage,
  appTemplateSupersetEnvVariableNames,
} from './app-template-contract.ts'

/** A DSN that parses as an http url, so the populated-environment gate exercises the optional variable. */
const gateGlitchtipDsn = 'https://gatepublickey@glitchtip.example.com/7'

/** Every variable an optional package owns, which is what the superset adds to the always-on three. */
const optionalEnvVariableNames = appTemplateOptionalPackageNames.flatMap(
  (optionalPackageName) =>
    appTemplateSectionsByOptionalPackage[optionalPackageName].envVariableNames,
)

/** A complete superset environment, since every optional package contributes at least one required variable. */
const supersetEnv = (overrides?: Readonly<Record<string, string>>): Record<string, string> =>
  gateSupersetEnv({
    supersetEnvVariableNames: appTemplateSupersetEnvVariableNames,
    optionalEnvVariableNames,
    overrides,
  })

/** Everything a marker scan of .env.example needs from the contract. */
const envExampleMarkerValues = {
  beginPrefix: appTemplateSectionBlockBeginPrefix,
  endPrefix: appTemplateSectionBlockEndPrefix,
  optionalPackageNames: [...appTemplateOptionalPackageNames],
} as const

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
  it('refuses an empty environment in the superset, naming every variable an optional package requires', async () => {
    const { requireAppRuntimeConfig } = await loadAppRuntimeConfigModule()

    // With no optional package selected nothing is required, which is why an empty-selection project
    // boots on an empty environment and the container image builds with nothing set. That half is
    // the contract's always-on schema, and it still holds.
    expect(appRuntimeConfigSchema.parse({}).LOG_LEVEL).toBe('info')

    // Selecting anything changes it: app-boot-config-invalid becomes reachable through a MISSING
    // variable and not only through an invalid one, and the superset selects all four. The message
    // has to name them, or an operator is left guessing which of twenty-five is unset.
    const message = messageOfThrownFrom(() => requireAppRuntimeConfig({ env: {} }))
    expect(message.startsWith(configInvalidErrorPrefix)).toBe(true)
    for (const requiredVariableName of [
      'STORAGE_ENDPOINT',
      'EMAIL_TRANSPORT',
      'DATABASE_URL',
      'AUTH_SECRET',
      'STRIPE_SECRET_KEY',
    ]) {
      expect(message, `a superset boot failure must name ${requiredVariableName}`).toContain(
        requiredVariableName,
      )
    }
  })

  it('returns the composed config the contract schema describes for a populated environment', async () => {
    const { requireAppRuntimeConfig } = await loadAppRuntimeConfigModule()
    const env = supersetEnv({
      NODE_ENV: 'production',
      LOG_LEVEL: 'debug',
      GLITCHTIP_DSN: gateGlitchtipDsn,
    })

    const config = requireAppRuntimeConfig({ env })

    // appRuntimeConfigSchema (static, in the contract) carries the always-on three, and
    // appEnvSchemaFragments (runtime, in app-runtime-config.ts) carries those plus every selected
    // package's; this is where the two must agree about the three they share.
    const alwaysOnConfig = appRuntimeConfigSchema.parse(env)
    expect(config.NODE_ENV).toBe(alwaysOnConfig.NODE_ENV)
    expect(config.LOG_LEVEL).toBe(alwaysOnConfig.LOG_LEVEL)
    expect(String(config.GLITCHTIP_DSN)).toBe(gateGlitchtipDsn)
    expect(Object.isFrozen(config)).toBe(true)

    // One value from an optional package's fragment, to prove the composition really widened rather
    // than the superset environment merely being ignored.
    expect(String((config as Record<string, unknown>).DATABASE_URL)).toBe(env.DATABASE_URL)
  })

  it('throws config own prefixed message when a variable holds an invalid value', async () => {
    const { requireAppRuntimeConfig } = await loadAppRuntimeConfigModule()

    // Every required variable is present here, so the only thing wrong is the two values: this is
    // the invalid-value half of app-boot-config-invalid, distinct from the missing-variable half the
    // superset made reachable.
    const message = messageOfThrownFrom(() =>
      requireAppRuntimeConfig({
        env: supersetEnv({ LOG_LEVEL: 'nope', GLITCHTIP_DSN: 'not-a-url' }),
      }),
    )

    expect(message.startsWith(configInvalidErrorPrefix)).toBe(true)
    expect(message).toContain('LOG_LEVEL')
    expect(message).toContain('GLITCHTIP_DSN')

    const bootFailure = appTemplateFailureSchema.parse({ kind: 'app-boot-config-invalid', message })
    expect(bootFailure.kind).toBe('app-boot-config-invalid')
  })

  it('declares every superset variable in appEnvSchemaFragments and documents exactly those in .env.example', async () => {
    const { appEnvSchemaFragments } = await loadAppRuntimeConfigModule()

    // Sorted, not in order: the superset list is written in appTemplateOptionalPackageNames order
    // while a fragment's own shape order is its author's, and STORAGE_REGION already sits in a
    // different place in each. The SET is the contract; the order of the list is documentation.
    const supersetVariableNames = [...appTemplateSupersetEnvVariableNames].toSorted()
    expect(appEnvSchemaFragments.flatMap(shapeKeysOf).toSorted()).toEqual(supersetVariableNames)

    // The contract's static schema stays the always-on three: it is the empty-selection boot shape,
    // and widening it would make a project that picked nothing require a variable it has no use for.
    expect(Object.keys(appRuntimeConfigSchema.shape).toSorted()).toEqual(
      [...appTemplateEnvVariableNames].toSorted(),
    )

    // .env.example documents exactly the superset set, whether the line is commented out or not.
    expect(documentedEnvVariableNamesIn(readTemplateFileText('.env.example')).toSorted()).toEqual(
      supersetVariableNames,
    )
  })

  it('documents every optional variable inside its owning package .env.example block and the always-on three outside every block', () => {
    const envExampleText = readTemplateFileText('.env.example')
    const envBlockMismatches: string[] = []

    // A variable outside its owner's block survives a prune that deletes the package, so a project
    // is told to set something nothing reads; a variable inside two blocks is deleted by whichever
    // package goes first. Either way the pruned file is wrong in a way only boot would show.
    const namesOutsideEveryBlock = documentedEnvVariableNamesIn(
      fileLinesOutsideSectionBlocks({ ...envExampleMarkerValues, fileText: envExampleText }).join(
        '\n',
      ),
    )
    for (const alwaysOnVariableName of appTemplateEnvVariableNames) {
      if (!namesOutsideEveryBlock.includes(alwaysOnVariableName)) {
        envBlockMismatches.push(
          `${appTemplateEnvBlockMismatchErrorPrefix} ${alwaysOnVariableName} is documented inside a section block`,
        )
      }
    }

    for (const optionalPackageName of appTemplateOptionalPackageNames) {
      const namesInsideThisBlock = documentedEnvVariableNamesIn(
        fileLinesInsideSectionBlocksOf({
          ...envExampleMarkerValues,
          fileText: envExampleText,
          owningOptionalPackageName: optionalPackageName,
        }).join('\n'),
      )
      for (const envVariableName of appTemplateSectionsByOptionalPackage[optionalPackageName]
        .envVariableNames) {
        if (!namesInsideThisBlock.includes(envVariableName)) {
          envBlockMismatches.push(
            `${appTemplateEnvBlockMismatchErrorPrefix} ${envVariableName} (${optionalPackageName})`,
          )
        }
      }
      // Nothing else belongs in that block, which is the "inside two blocks at once" half.
      for (const documentedName of namesInsideThisBlock) {
        if (
          !(
            appTemplateSectionsByOptionalPackage[optionalPackageName]
              .envVariableNames as readonly string[]
          ).includes(documentedName)
        ) {
          envBlockMismatches.push(
            `${appTemplateEnvBlockMismatchErrorPrefix} ${documentedName} is documented in the ${optionalPackageName} block, which does not own it`,
          )
        }
      }
    }

    expect(envBlockMismatches).toEqual([])

    const envBlockMismatchFailure = appTemplateFailureSchema.parse({
      kind: 'app-template-env-block-mismatch',
      envVariableName: 'DATABASE_URL',
      owningOptionalPackageName: '@hearthkit/auth',
      message: `${appTemplateEnvBlockMismatchErrorPrefix} DATABASE_URL`,
    })
    expect(envBlockMismatchFailure.kind).toBe('app-template-env-block-mismatch')
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
