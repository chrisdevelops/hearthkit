/** Public entry point of @hearthkit/storage: a named re-export of exactly the surface the contract lists, so no internal module is importable by consumers. */

/** Signs a PUT URL locally with the content type pinned into the signature; contacts nothing. */
export { createPresignedUploadUrl } from './create-presigned-upload-url.ts'

/** Confirms the object with a HEAD, then signs a GET URL and returns the metadata that HEAD already read. */
export { createPresignedDownloadUrl } from './create-presigned-download-url.ts'

/** Deletes one key; idempotent, so a key that never existed still succeeds. */
export { deleteStoredObject } from './delete-stored-object.ts'

/** Reads one page of keys, optionally filtered by a literal prefix. */
export { listStoredObjects } from './list-stored-objects.ts'

/** Contract values: this package's env fragment, the failure union schema, and the constants that decide every default and range. */
export {
  defaultPresignedUrlExpirySeconds,
  defaultStorageRegionName,
  maximumListedObjectCount,
  maximumPresignedUrlExpirySeconds,
  storageEnvSchemaFragment,
  storageFailureSchema,
} from './storage-contract.ts'

/** Contract values: the unique literal prefix every returned failure message starts with. */
export {
  storageBucketNotFoundErrorPrefix,
  storageCredentialsRejectedErrorPrefix,
  storageEndpointUnreachableErrorPrefix,
  storageObjectNotFoundErrorPrefix,
  storageParameterOutOfRangeErrorPrefix,
  storageRequestFailedErrorPrefix,
} from './storage-contract.ts'

/** Contract values: the branded vocabulary schemas, so an app can parse a user-supplied key or file name before calling anything here. */
export {
  listedObjectCountSchema,
  presignedStorageUrlSchema,
  presignedUrlExpirySecondsSchema,
  storageAccessKeyIdSchema,
  storageBucketNameSchema,
  storageConnectionSchema,
  storageContentTypeSchema,
  storageContinuationTokenSchema,
  storageDownloadFileNameSchema,
  storageEndpointUrlSchema,
  storageObjectKeyPrefixSchema,
  storageObjectKeySchema,
  storageRegionNameSchema,
  storageSecretAccessKeySchema,
} from './storage-contract.ts'

/** Contract values: each function's options, success-only and full result schemas, plus the two listing pieces, for runtime validation. */
export {
  createPresignedDownloadUrlOptionsSchema,
  createPresignedDownloadUrlResultSchema,
  createPresignedUploadUrlOptionsSchema,
  createPresignedUploadUrlResultSchema,
  deleteStoredObjectOptionsSchema,
  deleteStoredObjectResultSchema,
  listStoredObjectsOptionsSchema,
  listStoredObjectsResultSchema,
  presignedDownloadUrlCreatedSchema,
  presignedUploadUrlCreatedSchema,
  storedObjectDeletedSchema,
  storedObjectsListedSchema,
  storedObjectsPageStatusSchema,
  storedObjectSummarySchema,
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
