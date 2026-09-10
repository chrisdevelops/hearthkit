import { z } from 'zod'

/** Unique literal prefix of the failure message when the storage endpoint refused the connection or did not resolve. */
export const storageEndpointUnreachableErrorPrefix = 'hearthkit storage endpoint unreachable:'

/** Unique literal prefix of the failure message when the bucket named by the connection does not exist. */
export const storageBucketNotFoundErrorPrefix = 'hearthkit storage bucket not found:'

/** Unique literal prefix of the failure message when credentials are rejected or may not perform the action. */
export const storageCredentialsRejectedErrorPrefix = 'hearthkit storage credentials rejected:'

/** Unique literal prefix of the failure message when the object key does not exist in the bucket. */
export const storageObjectNotFoundErrorPrefix = 'hearthkit storage object not found:'

/** Unique literal prefix of the failure message when a caller-supplied number falls outside its documented range. */
export const storageParameterOutOfRangeErrorPrefix = 'hearthkit storage parameter out of range:'

/** Unique literal prefix of the failure message when the object store answered with an error this package does not name. */
export const storageRequestFailedErrorPrefix = 'hearthkit storage request failed:'

/** Region sent to the S3 API when STORAGE_REGION is unset; MinIO ignores the value and Cloudflare R2 documents auto. */
export const defaultStorageRegionName = 'auto'

/** Lifetime of a presigned URL when the caller does not choose one; fifteen minutes, matching the AWS SDK default. */
export const defaultPresignedUrlExpirySeconds = 900

/** Longest lifetime a presigned URL may have; seven days, the AWS Signature Version 4 ceiling the signer enforces. */
export const maximumPresignedUrlExpirySeconds = 604800

/** Largest page listStoredObjects may request, and the default when the caller does not choose; S3 never returns more. */
export const maximumListedObjectCount = 1000

// Region names are lowercase letters, digits and hyphens. Shared so the fragment's defaulted copy cannot drift.
const storageRegionNamePattern = /^[a-z0-9-]{1,32}$/

/** Storage endpoint origin; an http(s) URL whose path is empty, so a bucket URL pasted by mistake is rejected at boot. */
export const storageEndpointUrlSchema = z
  .url({ protocol: /^https?$/ })
  .refine((endpointUrl) => new URL(endpointUrl).pathname === '/')
  .brand<'StorageEndpointUrl'>()

/** Branded storage endpoint; http://localhost:9000 against local MinIO, the R2 account endpoint in production. */
export type StorageEndpointUrl = z.infer<typeof storageEndpointUrlSchema>

/** Bucket name; lowercase letters, digits and hyphens, 3 to 63 characters, the intersection of the S3 and R2 rules. */
export const storageBucketNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/)
  .brand<'StorageBucketName'>()

/** Branded bucket name; dots are deliberately excluded because R2 rejects them and they break virtual-host TLS. */
export type StorageBucketName = z.infer<typeof storageBucketNameSchema>

/** Region name sent to the S3 API; lowercase letters, digits and hyphens, 1 to 32 characters. */
export const storageRegionNameSchema = z
  .string()
  .regex(storageRegionNamePattern)
  .brand<'StorageRegionName'>()

/** Branded region name; the S3 SDK requires one even where the provider ignores its value. */
export type StorageRegionName = z.infer<typeof storageRegionNameSchema>

/** Access key id; the public half of the credential pair, so it may appear in a failure message. */
export const storageAccessKeyIdSchema = z.string().min(1).brand<'StorageAccessKeyId'>()

/** Branded access key id used to sign every request this package makes or presigns. */
export type StorageAccessKeyId = z.infer<typeof storageAccessKeyIdSchema>

/** Secret access key; the private half of the pair, never placed in a failure message, log line or returned value. */
export const storageSecretAccessKeySchema = z.string().min(1).brand<'StorageSecretAccessKey'>()

/** Branded secret access key; treat every value of this type as a secret that must not be printed. */
export type StorageSecretAccessKey = z.infer<typeof storageSecretAccessKeySchema>

/** Object key; slash separated segments of URL-safe characters, no leading, trailing or empty segment, max 1024 characters. */
export const storageObjectKeySchema = z
  .string()
  .max(1024)
  .regex(/^[A-Za-z0-9!_.*'()-]+(?:\/[A-Za-z0-9!_.*'()-]+)*$/)
  .refine((objectKey) => !/(^|\/)\.{1,2}(\/|$)/.test(objectKey))
  .brand<'StorageObjectKey'>()

/** Branded object key; stricter than S3 on purpose, so a user-supplied file name must be parsed through this schema first. */
export type StorageObjectKey = z.infer<typeof storageObjectKeySchema>

/** Object key prefix used to filter a listing; the key character set, may stop mid-segment or end with a slash. */
export const storageObjectKeyPrefixSchema = z
  .string()
  .max(1024)
  .regex(/^[A-Za-z0-9!_.*'()-]+(?:\/[A-Za-z0-9!_.*'()-]*)*$/)
  .brand<'StorageObjectKeyPrefix'>()

/** Branded listing prefix; matched literally by the object store, it is not a path and never implies a directory. */
export type StorageObjectKeyPrefix = z.infer<typeof storageObjectKeyPrefixSchema>

/** Content type pinned into an upload signature; a bare type/subtype pair, parameters such as charset are not accepted. */
export const storageContentTypeSchema = z
  .string()
  .max(127)
  .regex(/^[a-z0-9][a-z0-9!#$&^+.-]*\/[a-z0-9][a-z0-9!#$&^+.-]*$/i)
  .brand<'StorageContentType'>()

/** Branded content type; the uploading client must send exactly this value or the object store rejects the PUT. */
export type StorageContentType = z.infer<typeof storageContentTypeSchema>

/** File name a download URL offers the browser; letters, digits, spaces and simple punctuation, never quotes or slashes. */
export const storageDownloadFileNameSchema = z
  .string()
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._()-]*$/)
  .brand<'StorageDownloadFileName'>()

/** Branded download file name; the character set keeps it safe to place inside a quoted Content-Disposition header. */
export type StorageDownloadFileName = z.infer<typeof storageDownloadFileNameSchema>

/** Opaque pagination token from a truncated listing; pass it back unchanged to read the next page. */
export const storageContinuationTokenSchema = z.string().min(1).brand<'StorageContinuationToken'>()

/** Branded continuation token; it is not a key and its contents must never be parsed or constructed by hand. */
export type StorageContinuationToken = z.infer<typeof storageContinuationTokenSchema>

/** Presigned URL; carries the signature and expiry in its query string and works with any plain HTTP client. */
export const presignedStorageUrlSchema = z.url().brand<'PresignedStorageUrl'>()

/** Branded presigned URL; it is a bearer credential for one object and one method, so treat it as a secret. */
export type PresignedStorageUrl = z.infer<typeof presignedStorageUrlSchema>

/** Lifetime of a presigned URL in seconds; one second to seven days, checked before any network call is made. */
export const presignedUrlExpirySecondsSchema = z
  .number()
  .int()
  .min(1)
  .max(maximumPresignedUrlExpirySeconds)

/** Page size for a listing; one to one thousand, checked before any network call is made. */
export const listedObjectCountSchema = z.number().int().min(1).max(maximumListedObjectCount)

/** Everything one call needs to reach a bucket; the app builds it from config and passes it to every function here. */
export const storageConnectionSchema = z.object({
  storageEndpointUrl: storageEndpointUrlSchema,
  storageBucketName: storageBucketNameSchema,
  storageRegionName: storageRegionNameSchema,
  storageAccessKeyId: storageAccessKeyIdSchema,
  storageSecretAccessKey: storageSecretAccessKeySchema,
})

/** Connection type accepted by every public function; passed per call so nothing caches credentials between calls. */
export type StorageConnection = z.infer<typeof storageConnectionSchema>

/** Env schema fragment this package contributes to config; STORAGE_REGION defaults to auto and the other four are required. */
export const storageEnvSchemaFragment = z.object({
  STORAGE_ENDPOINT: storageEndpointUrlSchema,
  STORAGE_BUCKET: storageBucketNameSchema,
  STORAGE_ACCESS_KEY_ID: storageAccessKeyIdSchema,
  STORAGE_SECRET_ACCESS_KEY: storageSecretAccessKeySchema,
  STORAGE_REGION: z
    .string()
    .regex(storageRegionNamePattern)
    .default(defaultStorageRegionName)
    .brand<'StorageRegionName'>(),
})

/** Every way a storage call can fail; each variant's message starts with its unique prefix and names the value at fault. */
export const storageFailureSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('storage-endpoint-unreachable'),
    storageEndpointUrl: storageEndpointUrlSchema,
    message: z.string().startsWith(storageEndpointUnreachableErrorPrefix),
  }),
  z.object({
    kind: z.literal('storage-bucket-not-found'),
    storageBucketName: storageBucketNameSchema,
    message: z.string().startsWith(storageBucketNotFoundErrorPrefix),
  }),
  z.object({
    kind: z.literal('storage-credentials-rejected'),
    storageAccessKeyId: storageAccessKeyIdSchema,
    message: z.string().startsWith(storageCredentialsRejectedErrorPrefix),
  }),
  z.object({
    kind: z.literal('storage-object-not-found'),
    storageObjectKey: storageObjectKeySchema,
    message: z.string().startsWith(storageObjectNotFoundErrorPrefix),
  }),
  z.object({
    kind: z.literal('storage-parameter-out-of-range'),
    parameterName: z.enum(['expiresInSeconds', 'maxObjectCount']),
    parameterValue: z.number(),
    message: z.string().startsWith(storageParameterOutOfRangeErrorPrefix),
  }),
  z.object({
    kind: z.literal('storage-request-failed'),
    storageErrorCode: z.string().min(1),
    httpStatusCode: z.number().int().optional(),
    message: z.string().startsWith(storageRequestFailedErrorPrefix),
  }),
])

/** Discriminated failure union returned, never thrown, by all four public functions of this package. */
export type StorageFailure = z.infer<typeof storageFailureSchema>

/** Runtime shape of createPresignedUploadUrl options; contentType is pinned into the signature, so the PUT must match it. */
export const createPresignedUploadUrlOptionsSchema = z.object({
  storageConnection: storageConnectionSchema,
  storageObjectKey: storageObjectKeySchema,
  contentType: storageContentTypeSchema,
  expiresInSeconds: presignedUrlExpirySecondsSchema.default(defaultPresignedUrlExpirySeconds),
})

/** Options type for createPresignedUploadUrl; omit expiresInSeconds for the fifteen minute default. */
export type CreatePresignedUploadUrlOptions = {
  storageConnection: StorageConnection
  storageObjectKey: StorageObjectKey
  contentType: StorageContentType
  expiresInSeconds?: number
}

// Success arm of createPresignedUploadUrl; module-private, reachable through createPresignedUploadUrlResultSchema.
const presignedUploadUrlCreatedSchema = z.object({
  kind: z.literal('presigned-upload-url-created'),
  presignedUploadUrl: presignedStorageUrlSchema,
  storageObjectKey: storageObjectKeySchema,
  requiredRequestHeaders: z.record(z.string(), z.string()),
  expiresAt: z.date(),
})

/** Full result union of createPresignedUploadUrl; success shape { kind: 'presigned-upload-url-created', presignedUploadUrl, storageObjectKey, requiredRequestHeaders, expiresAt } or a StorageFailure. */
export const createPresignedUploadUrlResultSchema = z.union([
  presignedUploadUrlCreatedSchema,
  storageFailureSchema,
])

/** Result type of createPresignedUploadUrl. */
export type CreatePresignedUploadUrlResult = z.infer<typeof createPresignedUploadUrlResultSchema>

/** Signature of createPresignedUploadUrl: signs locally and contacts nothing, so only the expiry range can fail here. */
export type CreatePresignedUploadUrl = (
  options: CreatePresignedUploadUrlOptions,
) => Promise<CreatePresignedUploadUrlResult>

/** Runtime shape of createPresignedDownloadUrl options; downloadFileName sets the name the browser saves the file under. */
export const createPresignedDownloadUrlOptionsSchema = z.object({
  storageConnection: storageConnectionSchema,
  storageObjectKey: storageObjectKeySchema,
  downloadFileName: storageDownloadFileNameSchema.optional(),
  expiresInSeconds: presignedUrlExpirySecondsSchema.default(defaultPresignedUrlExpirySeconds),
})

/** Options type for createPresignedDownloadUrl; omit downloadFileName to let the browser use the key's last segment. */
export type CreatePresignedDownloadUrlOptions = {
  storageConnection: StorageConnection
  storageObjectKey: StorageObjectKey
  downloadFileName?: StorageDownloadFileName
  expiresInSeconds?: number
}

// Success arm of createPresignedDownloadUrl; module-private, reachable through createPresignedDownloadUrlResultSchema.
const presignedDownloadUrlCreatedSchema = z.object({
  kind: z.literal('presigned-download-url-created'),
  presignedDownloadUrl: presignedStorageUrlSchema,
  storageObjectKey: storageObjectKeySchema,
  objectByteCount: z.number().int().min(0),
  objectContentType: z.string().optional(),
  objectLastModifiedAt: z.date(),
  expiresAt: z.date(),
})

/** Full result union of createPresignedDownloadUrl; success shape { kind: 'presigned-download-url-created', presignedDownloadUrl, storageObjectKey, objectByteCount, objectContentType?, objectLastModifiedAt, expiresAt } or a StorageFailure. */
export const createPresignedDownloadUrlResultSchema = z.union([
  presignedDownloadUrlCreatedSchema,
  storageFailureSchema,
])

/** Result type of createPresignedDownloadUrl. */
export type CreatePresignedDownloadUrlResult = z.infer<
  typeof createPresignedDownloadUrlResultSchema
>

/** Signature of createPresignedDownloadUrl: confirms the object exists with a HEAD before signing, so it does reach the network. */
export type CreatePresignedDownloadUrl = (
  options: CreatePresignedDownloadUrlOptions,
) => Promise<CreatePresignedDownloadUrlResult>

/** Runtime shape of deleteStoredObject options; there is nothing to configure beyond the connection and the key. */
export const deleteStoredObjectOptionsSchema = z.object({
  storageConnection: storageConnectionSchema,
  storageObjectKey: storageObjectKeySchema,
})

/** Options type for deleteStoredObject. */
export type DeleteStoredObjectOptions = z.infer<typeof deleteStoredObjectOptionsSchema>

// Success arm of deleteStoredObject; module-private, reachable through deleteStoredObjectResultSchema.
const storedObjectDeletedSchema = z.object({
  kind: z.literal('stored-object-deleted'),
  storageObjectKey: storageObjectKeySchema,
})

/** Full result union of deleteStoredObject; success shape { kind: 'stored-object-deleted', storageObjectKey }, returned whether or not the key existed, or a StorageFailure. */
export const deleteStoredObjectResultSchema = z.union([
  storedObjectDeletedSchema,
  storageFailureSchema,
])

/** Result type of deleteStoredObject. */
export type DeleteStoredObjectResult = z.infer<typeof deleteStoredObjectResultSchema>

/** Signature of deleteStoredObject: idempotent, so it can never report that the key was already absent. */
export type DeleteStoredObject = (
  options: DeleteStoredObjectOptions,
) => Promise<DeleteStoredObjectResult>

/** Runtime shape of listStoredObjects options; maxObjectCount defaults to the thousand-key maximum S3 will return. */
export const listStoredObjectsOptionsSchema = z.object({
  storageConnection: storageConnectionSchema,
  objectKeyPrefix: storageObjectKeyPrefixSchema.optional(),
  maxObjectCount: listedObjectCountSchema.default(maximumListedObjectCount),
  continuationToken: storageContinuationTokenSchema.optional(),
})

/** Options type for listStoredObjects; omit objectKeyPrefix to list the whole bucket one page at a time. */
export type ListStoredObjectsOptions = {
  storageConnection: StorageConnection
  objectKeyPrefix?: StorageObjectKeyPrefix
  maxObjectCount?: number
  continuationToken?: StorageContinuationToken
}

/** One object in a listing; a listing carries no content type, so only these three facts are reported per key. */
export const storedObjectSummarySchema = z.object({
  storageObjectKey: storageObjectKeySchema,
  objectByteCount: z.number().int().min(0),
  objectLastModifiedAt: z.date(),
})

/** Per-key summary type inside a listing result. */
export type StoredObjectSummary = z.infer<typeof storedObjectSummarySchema>

/** Whether a listing returned every matching key or stopped early; the token and the truncation flag cannot disagree. */
export const storedObjectsPageStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stored-objects-page-complete') }),
  z.object({
    kind: z.literal('stored-objects-page-truncated'),
    nextContinuationToken: storageContinuationTokenSchema,
  }),
])

/** Page status type carried by a listing result. */
export type StoredObjectsPageStatus = z.infer<typeof storedObjectsPageStatusSchema>

// Success arm of listStoredObjects; module-private, reachable through listStoredObjectsResultSchema.
const storedObjectsListedSchema = z.object({
  kind: z.literal('stored-objects-listed'),
  storedObjects: z.array(storedObjectSummarySchema),
  pageStatus: storedObjectsPageStatusSchema,
})

/** Full result union of listStoredObjects; success shape { kind: 'stored-objects-listed', storedObjects, pageStatus }, where an empty array is not a failure, or a StorageFailure. */
export const listStoredObjectsResultSchema = z.union([
  storedObjectsListedSchema,
  storageFailureSchema,
])

/** Result type of listStoredObjects. */
export type ListStoredObjectsResult = z.infer<typeof listStoredObjectsResultSchema>

/** Signature of listStoredObjects: one page per call, so a caller wanting everything loops on the truncated page status. */
export type ListStoredObjects = (
  options: ListStoredObjectsOptions,
) => Promise<ListStoredObjectsResult>
