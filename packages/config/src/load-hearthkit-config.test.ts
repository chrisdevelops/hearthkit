import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  configEnvSchemaFragment,
  configFailureSchema,
  configFragmentConflictErrorPrefix,
  configInvalidErrorPrefix,
  configLoadResultSchema,
  configVariableIssueSchema,
  loadHearthkitConfig,
} from '@hearthkit/config'
import {
  buildGateEnvSource,
  expectConfigFragmentConflict,
  expectConfigLoaded,
  expectConfigValidationFailed,
  findGateIssueFor,
  gateConflictingStorageEnvSchemaFragment,
  gateDatabaseEnvSchemaFragment,
  gateEmailEnvSchemaFragment,
  gateStorageEnvSchemaFragment,
} from '../test-fixtures/config-gate-fragments.js'

describe('loadHearthkitConfig', () => {
  it('resolves a frozen typed config from valid env across several fragments', () => {
    const env = buildGateEnvSource({
      GATE_DATABASE_POOL_SIZE: '25',
      GATE_STORAGE_REGION: undefined,
      GATE_UNDECLARED_BY_ANY_FRAGMENT: 'ignore me',
    })

    const result = loadHearthkitConfig({
      fragments: [
        configEnvSchemaFragment,
        gateDatabaseEnvSchemaFragment,
        gateStorageEnvSchemaFragment,
      ],
      env,
    })

    configLoadResultSchema.parse(result)
    const config = expectConfigLoaded(result)

    // Values pass through, string numbers are coerced, and declared defaults fill the gaps.
    expect(config.GATE_DATABASE_URL).toBe(env.GATE_DATABASE_URL)
    const poolSize: number = config.GATE_DATABASE_POOL_SIZE
    expect(poolSize).toBe(25)
    expect(config.GATE_STORAGE_REGION).toBe('auto')
    expect(config.NODE_ENV).toBe('development')

    // Undeclared env keys are stripped, and the result is frozen.
    expect(Object.keys(config).toSorted()).toEqual([
      'GATE_DATABASE_POOL_SIZE',
      'GATE_DATABASE_URL',
      'GATE_STORAGE_BUCKET',
      'GATE_STORAGE_REGION',
      'NODE_ENV',
    ])
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('reads process.env when no env source is supplied', () => {
    const pathFromProcessEnv = process.env.PATH
    expect(pathFromProcessEnv, 'this gate needs PATH set in the test process').toBeTypeOf('string')

    const result = loadHearthkitConfig({ fragments: [z.object({ PATH: z.string().min(1) })] })

    const config = expectConfigLoaded(result)
    expect(config.PATH).toBe(pathFromProcessEnv)
  })

  it('fails with env-variable-missing and names the variable in the message', () => {
    const env = buildGateEnvSource({ GATE_STORAGE_BUCKET: undefined })

    const result = loadHearthkitConfig({
      fragments: [gateDatabaseEnvSchemaFragment, gateStorageEnvSchemaFragment],
      env,
    })

    configFailureSchema.parse(result)
    const failure = expectConfigValidationFailed(result)
    expect(failure.message.startsWith(configInvalidErrorPrefix)).toBe(true)
    expect(failure.message).toContain('GATE_STORAGE_BUCKET')

    const issue = findGateIssueFor(failure, 'GATE_STORAGE_BUCKET')
    configVariableIssueSchema.parse(issue)
    expect(issue.kind).toBe('env-variable-missing')
    expect(failure.issues).toHaveLength(1)
  })

  it('aggregates every failing variable into one message instead of stopping at the first', () => {
    const env = buildGateEnvSource({
      GATE_DATABASE_URL: 'not-a-url',
      GATE_STORAGE_BUCKET: undefined,
    })

    const result = loadHearthkitConfig({
      fragments: [gateDatabaseEnvSchemaFragment, gateStorageEnvSchemaFragment],
      env,
    })

    const failure = expectConfigValidationFailed(result)
    expect(failure.issues).toHaveLength(2)

    // Both names appear, each on its own line, under the single aggregate prefix.
    const messageLines = failure.message.split('\n')
    expect(messageLines.filter((line) => line.includes('GATE_DATABASE_URL'))).toHaveLength(1)
    expect(messageLines.filter((line) => line.includes('GATE_STORAGE_BUCKET'))).toHaveLength(1)
    expect(findGateIssueFor(failure, 'GATE_DATABASE_URL').kind).toBe('env-variable-invalid-url')
    expect(findGateIssueFor(failure, 'GATE_STORAGE_BUCKET').kind).toBe('env-variable-missing')
  })

  it('fails with env-variable-wrong-type when a present value does not match its schema', () => {
    const env = buildGateEnvSource({
      NODE_ENV: 'staging',
      GATE_DATABASE_POOL_SIZE: 'not-a-number',
    })

    const result = loadHearthkitConfig({
      fragments: [
        configEnvSchemaFragment,
        gateDatabaseEnvSchemaFragment,
        gateStorageEnvSchemaFragment,
      ],
      env,
    })

    const failure = expectConfigValidationFailed(result)
    const enumIssue = findGateIssueFor(failure, 'NODE_ENV')
    const numberIssue = findGateIssueFor(failure, 'GATE_DATABASE_POOL_SIZE')
    if (
      enumIssue.kind !== 'env-variable-wrong-type' ||
      numberIssue.kind !== 'env-variable-wrong-type'
    ) {
      throw new Error(
        `gate expected env-variable-wrong-type for both, received ${enumIssue.kind} and ${numberIssue.kind}`,
      )
    }

    // The kind carries what the variable should have been, so the boot message can say it.
    expect(enumIssue.expected.length).toBeGreaterThan(0)
    expect(numberIssue.expected.length).toBeGreaterThan(0)
    expect(failure.message).toContain('NODE_ENV')
    expect(failure.message).toContain('GATE_DATABASE_POOL_SIZE')
  })

  it('fails with env-variable-invalid-url when a present value is not a URL', () => {
    const env = buildGateEnvSource({ GATE_DATABASE_URL: 'postgres//missing-colon' })

    const result = loadHearthkitConfig({
      fragments: [gateDatabaseEnvSchemaFragment, gateStorageEnvSchemaFragment],
      env,
    })

    const failure = expectConfigValidationFailed(result)
    const issue = findGateIssueFor(failure, 'GATE_DATABASE_URL')
    configVariableIssueSchema.parse(issue)
    expect(issue.kind).toBe('env-variable-invalid-url')
    expect(failure.message).toContain('GATE_DATABASE_URL')
  })

  it('treats an empty string as unset for required and defaulted variables', () => {
    const requiredEmpty = loadHearthkitConfig({
      fragments: [gateDatabaseEnvSchemaFragment, gateStorageEnvSchemaFragment],
      env: buildGateEnvSource({ GATE_STORAGE_BUCKET: '', GATE_DATABASE_POOL_SIZE: '' }),
    })

    // The empty required variable is missing; the empty defaulted one is not an error at all.
    const failure = expectConfigValidationFailed(requiredEmpty)
    expect(failure.issues).toHaveLength(1)
    expect(findGateIssueFor(failure, 'GATE_STORAGE_BUCKET').kind).toBe('env-variable-missing')

    const defaultedEmpty = loadHearthkitConfig({
      fragments: [gateDatabaseEnvSchemaFragment, gateStorageEnvSchemaFragment],
      env: buildGateEnvSource({ GATE_DATABASE_POOL_SIZE: '', GATE_STORAGE_REGION: '' }),
    })

    const config = expectConfigLoaded(defaultedEmpty)
    expect(config.GATE_DATABASE_POOL_SIZE).toBe(10)
    expect(config.GATE_STORAGE_REGION).toBe('auto')
  })

  it('fails with config-fragment-conflict when two fragments declare the same variable', () => {
    const result = loadHearthkitConfig({
      fragments: [
        gateDatabaseEnvSchemaFragment,
        gateStorageEnvSchemaFragment,
        gateConflictingStorageEnvSchemaFragment,
      ],
      env: buildGateEnvSource(),
    })

    configFailureSchema.parse(result)
    const conflict = expectConfigFragmentConflict(result)
    expect(conflict.variableName).toBe('GATE_STORAGE_BUCKET')
    expect(conflict.message.startsWith(configFragmentConflictErrorPrefix)).toBe(true)
    expect(conflict.message).toContain('GATE_STORAGE_BUCKET')
  })

  it('does not require the variables of a fragment the app did not pass', () => {
    const env = buildGateEnvSource()

    const withoutEmailFragment = loadHearthkitConfig({
      fragments: [gateDatabaseEnvSchemaFragment, gateStorageEnvSchemaFragment],
      env,
    })

    const config = expectConfigLoaded(withoutEmailFragment)
    expect(Object.keys(config)).not.toContain('GATE_EMAIL_API_KEY')

    const withEmailFragment = loadHearthkitConfig({
      fragments: [
        gateDatabaseEnvSchemaFragment,
        gateStorageEnvSchemaFragment,
        gateEmailEnvSchemaFragment,
      ],
      env,
    })

    const failure = expectConfigValidationFailed(withEmailFragment)
    expect(findGateIssueFor(failure, 'GATE_EMAIL_API_KEY').kind).toBe('env-variable-missing')
  })
})
