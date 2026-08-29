import { loadHearthkitConfig } from '@hearthkit/config'
import { describe, expect, it } from 'vitest'
import {
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

// The rule packages/storage/CONTRACT.md states for the entry point is mechanical: every value
// storage-contract.ts exports is re-exported from src/index.ts, with no exceptions. So the required
// list is read off the contract module's own namespace rather than typed out here. A hand-written
// list of names would have to be extended by hand every time the contract grows an export, and would
// silently fall behind the day someone forgot; a derived list cannot.
//
// A module namespace carries value exports only. Every `export type` in storage-contract.ts is erased
// before this file runs, so the types CONTRACT.md also asks the entry point to re-export are outside
// what this gate can see and are covered by typecheck instead.
function contractValueExportNames(contractModule: Record<string, unknown>): string[] {
  return Object.keys(contractModule).toSorted()
}

// CONTRACT.md names these four success-only schemas as required in so many words. They are spelled
// out as strings so that renaming one in the contract fails this gate loudly, instead of quietly
// shrinking the derived list to a set an entry point already satisfies.
const successOnlySchemaNamesTheContractRequires = [
  'presignedUploadUrlCreatedSchema',
  'presignedDownloadUrlCreatedSchema',
  'storedObjectDeletedSchema',
  'storedObjectsListedSchema',
] as const

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
  it('re-exports by name every value storage-contract.ts exports, with no exceptions', async () => {
    const namespace = await importHearthkitStorageNamespace()
    const contractModule = storageContract as unknown as Record<string, unknown>
    const requiredExportNames = contractValueExportNames(contractModule)

    const renamedInTheContract = successOnlySchemaNamesTheContractRequires.filter(
      (exportName) => !requiredExportNames.includes(exportName),
    )
    expect(
      renamedInTheContract,
      'storage-contract.ts must still export the success-only schemas CONTRACT.md names',
    ).toEqual([])

    // Both lists are compared whole rather than one name at a time, so a failure names every export
    // that is wrong instead of stopping at the first and hiding the rest behind a rerun.
    const missingFromTheEntryPoint = requiredExportNames.filter(
      (exportName) => namespace[exportName] === undefined,
    )
    expect(
      missingFromTheEntryPoint,
      'src/index.ts must re-export these by name from storage-contract.ts',
    ).toEqual([])

    const rebuiltInsteadOfReExported = requiredExportNames.filter(
      (exportName) => namespace[exportName] !== contractModule[exportName],
    )
    expect(
      rebuiltInsteadOfReExported,
      'these must be the identical value storage-contract.ts exports, not a second copy of it',
    ).toEqual([])
  })
})
