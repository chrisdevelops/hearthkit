import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import {
  hearthkitStorageEntryValueExportNames,
  importHearthkitStorageNamespace,
  loadHearthkitStorageEntry,
} from '../test-fixtures/hearthkit-storage-entry.ts'
import { expectResultKind } from '../test-fixtures/storage-gate-expectations.ts'
import * as storageContract from './storage-contract.ts'
import { defaultStorageRegionName } from './storage-contract.ts'

const completeStorageEnv = {
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'hearthkit-uploads',
  STORAGE_ACCESS_KEY_ID: 'hearthkit',
  STORAGE_SECRET_ACCESS_KEY: 'hearthkit',
}

describe('storageEnvSchemaFragment', () => {
  it('declares five variables, requires four of them, and defaults STORAGE_REGION to auto with an empty string counting as unset', async () => {
    const { storageEnvSchemaFragment } = await loadHearthkitStorageEntry()
    expect(Object.keys(storageEnvSchemaFragment.shape).toSorted()).toEqual([
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_BUCKET',
      'STORAGE_ENDPOINT',
      'STORAGE_REGION',
      'STORAGE_SECRET_ACCESS_KEY',
    ])

    const nothingSet = expectResultKind(
      loadHearthkitConfig({ fragments: [storageEnvSchemaFragment], env: {} }),
      'config-validation-failed',
    )
    for (const variableName of Object.keys(completeStorageEnv)) {
      expect(nothingSet.message).toContain(variableName)
    }
    expect(nothingSet.message).not.toContain('STORAGE_REGION')
    expect(nothingSet.issues).toHaveLength(4)

    const regionUnset = expectResultKind(
      loadHearthkitConfig({ fragments: [storageEnvSchemaFragment], env: completeStorageEnv }),
      'config-loaded',
    )
    expect(String(regionUnset.config.STORAGE_REGION)).toBe(defaultStorageRegionName)
    expect(String(regionUnset.config.STORAGE_ENDPOINT)).toBe(completeStorageEnv.STORAGE_ENDPOINT)
    expect(String(regionUnset.config.STORAGE_BUCKET)).toBe(completeStorageEnv.STORAGE_BUCKET)

    const regionEmpty = expectResultKind(
      loadHearthkitConfig({
        fragments: [storageEnvSchemaFragment],
        env: { ...completeStorageEnv, STORAGE_REGION: '' },
      }),
      'config-loaded',
    )
    expect(String(regionEmpty.config.STORAGE_REGION)).toBe(defaultStorageRegionName)

    const regionChosen = expectResultKind(
      loadHearthkitConfig({
        fragments: [storageEnvSchemaFragment],
        env: { ...completeStorageEnv, STORAGE_REGION: 'us-east-1' },
      }),
      'config-loaded',
    )
    expect(String(regionChosen.config.STORAGE_REGION)).toBe('us-east-1')
  })

  it('fails and names the variable when the endpoint carries a path, the bucket name is not legal, or the region is not lowercase', async () => {
    const { storageEnvSchemaFragment } = await loadHearthkitStorageEntry()

    const failure = expectResultKind(
      loadHearthkitConfig({
        fragments: [storageEnvSchemaFragment],
        env: {
          ...completeStorageEnv,
          // An endpoint with a bucket path is the mistake the branded schema exists to catch at boot.
          STORAGE_ENDPOINT: 'http://localhost:9000/hearthkit-uploads',
          STORAGE_BUCKET: 'Uploads.Bucket',
          STORAGE_REGION: 'Not A Region',
        },
      }),
      'config-validation-failed',
    )

    expect(failure.message).toContain('STORAGE_ENDPOINT')
    expect(failure.message).toContain('STORAGE_BUCKET')
    expect(failure.message).toContain('STORAGE_REGION')
    expect(failure.issues).toHaveLength(3)
  })
})

describe('@hearthkit/storage entry point', () => {
  it('exports exactly the fifteen allowlisted values and nothing else, each the value storage-contract.ts already exports', async () => {
    const namespace = await importHearthkitStorageNamespace()
    const contractModule = storageContract as unknown as Record<string, unknown>

    // A module namespace carries value exports only, so every `export type` is already erased here and
    // the types CONTRACT.md keeps on the entry point are covered by typecheck instead. Both lists are
    // compared whole rather than name by name, so a failure names every wrong export at once instead
    // of stopping at the first and hiding the rest behind a rerun.
    const actualValueExportNames = Object.keys(namespace)
      .filter((exportName) => namespace[exportName] !== undefined)
      .toSorted()
    expect(
      actualValueExportNames,
      'src/index.ts must export exactly the allowlist in CONTRACT.md "Package entry point"',
    ).toEqual([...hearthkitStorageEntryValueExportNames].toSorted())

    // Split by origin: the schemas come from storage-contract.ts, the four functions come from their
    // own implementation modules. A schema renamed in the contract falls out of the first group and
    // fails the second assertion by name, so neither check can go quiet.
    const fromTheContractModule = hearthkitStorageEntryValueExportNames.filter(
      (exportName) => contractModule[exportName] !== undefined,
    )
    const fromAnImplementationModule = hearthkitStorageEntryValueExportNames.filter(
      (exportName) => contractModule[exportName] === undefined,
    )

    const rebuiltInsteadOfReExported = fromTheContractModule.filter(
      (exportName) => namespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value storage-contract.ts exports, not a second copy of it',
    ).toEqual([])

    const notAFunction = fromAnImplementationModule.filter(
      (exportName) => typeof namespace[exportName] !== 'function',
    )
    expect(
      notAFunction,
      'every allowlisted name storage-contract.ts does not export must be one of the four functions',
    ).toEqual([])
  })
})
