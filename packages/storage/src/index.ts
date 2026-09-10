/** Public entry point of @hearthkit/storage: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Signs a PUT URL locally with the content type pinned into the signature; contacts nothing. */
export { createPresignedUploadUrl } from './create-presigned-upload-url.ts'

/** Confirms the object with a HEAD, then signs a GET URL and returns the metadata that HEAD already read. */
export { createPresignedDownloadUrl } from './create-presigned-download-url.ts'

/** Deletes one key; idempotent, so a key that never existed still succeeds. */
export { deleteStoredObject } from './delete-stored-object.ts'

/** Reads one page of keys, optionally filtered by a literal prefix. */
export { listStoredObjects } from './list-stored-objects.ts'

/** Contract values: the env fragment config composes, the failure union schema, and the connection input every function takes. */
export {
  storageConnectionSchema,
  storageEnvSchemaFragment,
  storageFailureSchema,
} from './storage-contract.ts'

/** Contract values: the full result schema of each function, for validating a value that crossed a process or network boundary. */
export {
  createPresignedDownloadUrlResultSchema,
  createPresignedUploadUrlResultSchema,
  deleteStoredObjectResultSchema,
  listStoredObjectsResultSchema,
} from './storage-contract.ts'

/** Contract values: the branded schemas an app must parse user-supplied text through before calling anything here. */
export {
  storageContentTypeSchema,
  storageDownloadFileNameSchema,
  storageObjectKeyPrefixSchema,
  storageObjectKeySchema,
} from './storage-contract.ts'

/** Contract types: the branded vocabulary, the connection, and the failure union returned by all four functions. */
export type {
  PresignedStorageUrl,
  StorageAccessKeyId,
  StorageBucketName,
  StorageConnection,
  StorageContentType,
  StorageContinuationToken,
  StorageDownloadFileName,
  StorageEndpointUrl,
  StorageFailure,
  StorageObjectKey,
  StorageObjectKeyPrefix,
  StorageRegionName,
  StorageSecretAccessKey,
} from './storage-contract.ts'

/** Contract types: the option, result and function shapes of every export above, plus the two listing pieces. */
export type {
  CreatePresignedDownloadUrl,
  CreatePresignedDownloadUrlOptions,
  CreatePresignedDownloadUrlResult,
  CreatePresignedUploadUrl,
  CreatePresignedUploadUrlOptions,
  CreatePresignedUploadUrlResult,
  DeleteStoredObject,
  DeleteStoredObjectOptions,
  DeleteStoredObjectResult,
  ListStoredObjects,
  ListStoredObjectsOptions,
  ListStoredObjectsResult,
  StoredObjectsPageStatus,
  StoredObjectSummary,
} from './storage-contract.ts'
