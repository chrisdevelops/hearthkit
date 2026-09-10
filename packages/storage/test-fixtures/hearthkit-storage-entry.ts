import type * as storageContract from '../src/storage-contract.ts'
import type {
  CreatePresignedDownloadUrl,
  CreatePresignedUploadUrl,
  DeleteStoredObject,
  ListStoredObjects,
} from '../src/storage-contract.ts'

/** The env fragment's own type, read off the contract module so this fixture needs no runtime import. */
export type StorageEnvSchemaFragment = typeof storageContract.storageEnvSchemaFragment

/** The whole public surface a gate is allowed to call; nothing here may be imported from an internal module. */
export type HearthkitStorageEntry = {
  createPresignedUploadUrl: CreatePresignedUploadUrl
  createPresignedDownloadUrl: CreatePresignedDownloadUrl
  deleteStoredObject: DeleteStoredObject
  listStoredObjects: ListStoredObjects
  storageEnvSchemaFragment: StorageEnvSchemaFragment
}

/**
 * The fifteen value exports CONTRACT.md "Package entry point" allows src/index.ts to have, spelled
 * out because the allowlist is a decision no module namespace can be derived from: every other value
 * storage-contract.ts exports is internal and must stay off the entry point.
 */
export const hearthkitStorageEntryValueExportNames = [
  'createPresignedUploadUrl',
  'createPresignedDownloadUrl',
  'deleteStoredObject',
  'listStoredObjects',
  'storageEnvSchemaFragment',
  'storageFailureSchema',
  'storageConnectionSchema',
  'createPresignedUploadUrlResultSchema',
  'createPresignedDownloadUrlResultSchema',
  'deleteStoredObjectResultSchema',
  'listStoredObjectsResultSchema',
  'storageObjectKeySchema',
  'storageObjectKeyPrefixSchema',
  'storageContentTypeSchema',
  'storageDownloadFileNameSchema',
] as const

/**
 * Imports @hearthkit/storage through its public entry point at call time, so a package with no
 * implementation yet fails one gate at a time instead of breaking collection for a whole file.
 */
export async function importHearthkitStorageNamespace(): Promise<Record<string, unknown>> {
  try {
    return (await import('@hearthkit/storage')) as Record<string, unknown>
  } catch (error) {
    throw new Error(
      `gate could not load the public entry point of @hearthkit/storage (not implemented yet?): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

/**
 * The public entry point narrowed to the surface the contract promises. Throws naming whatever is
 * not exported yet, because a missing named export resolves to undefined rather than throwing in
 * this repo's Vitest setup, which would let a gate pass while checking nothing.
 */
export async function loadHearthkitStorageEntry(): Promise<HearthkitStorageEntry> {
  const namespace = await importHearthkitStorageNamespace()

  const missingNames = hearthkitStorageEntryValueExportNames.filter(
    (exportName) => namespace[exportName] === undefined,
  )
  if (missingNames.length > 0) {
    throw new Error(`gate expected @hearthkit/storage to export ${missingNames.join(', ')}`)
  }

  return namespace as unknown as HearthkitStorageEntry
}
