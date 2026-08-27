import { describe, expect, it } from 'vitest'
import {
  configEnvSchemaFragment,
  configFragmentConflictErrorPrefix,
  configInvalidErrorPrefix,
  requireHearthkitConfig,
} from '@hearthkit/config'
import {
  buildGateEnvSource,
  gateConflictingStorageEnvSchemaFragment,
  gateDatabaseEnvSchemaFragment,
  gateStorageEnvSchemaFragment,
} from '../test-fixtures/config-gate-fragments.js'

describe('requireHearthkitConfig', () => {
  it('returns the frozen config when every variable is valid', () => {
    const env = buildGateEnvSource({ GATE_DATABASE_POOL_SIZE: '3' })

    const config = requireHearthkitConfig({
      fragments: [
        configEnvSchemaFragment,
        gateDatabaseEnvSchemaFragment,
        gateStorageEnvSchemaFragment,
      ],
      env,
    })

    expect(config.GATE_DATABASE_URL).toBe(env.GATE_DATABASE_URL)
    expect(config.GATE_DATABASE_POOL_SIZE).toBe(3)
    expect(config.NODE_ENV).toBe('development')
    expect(Object.isFrozen(config)).toBe(true)
  })

  it('throws one aggregate error naming every failing variable', () => {
    const env = buildGateEnvSource({
      GATE_DATABASE_URL: 'not-a-url',
      GATE_STORAGE_BUCKET: undefined,
    })

    let thrown: unknown
    try {
      requireHearthkitConfig({
        fragments: [gateDatabaseEnvSchemaFragment, gateStorageEnvSchemaFragment],
        env,
      })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(Error)
    const message = thrown instanceof Error ? thrown.message : String(thrown)
    expect(message.startsWith(configInvalidErrorPrefix)).toBe(true)
    expect(message).toContain('GATE_DATABASE_URL')
    expect(message).toContain('GATE_STORAGE_BUCKET')
  })

  it('throws with the fragment conflict prefix when two fragments declare the same variable', () => {
    expect(() =>
      requireHearthkitConfig({
        fragments: [gateStorageEnvSchemaFragment, gateConflictingStorageEnvSchemaFragment],
        env: buildGateEnvSource(),
      }),
    ).toThrowError(new RegExp(`^${configFragmentConflictErrorPrefix}.*GATE_STORAGE_BUCKET`, 's'))
  })
})
