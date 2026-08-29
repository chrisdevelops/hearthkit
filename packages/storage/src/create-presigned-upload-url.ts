import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  presignedStorageUrlSchema,
  type CreatePresignedUploadUrlOptions,
  type CreatePresignedUploadUrlResult,
} from './storage-contract.ts'
import { mapStorageErrorToFailure } from './storage-error-to-failure.ts'
import { checkPresignedUrlExpirySeconds } from './storage-number-parameter-range.ts'
import { withStorageS3Client } from './storage-s3-client-session.ts'

// The presigner marks content-type unsignable by default, so without this the pinned type is
// decorative: a client could send text/html against a URL signed for text/plain and the object store
// would store the client's choice. Naming it here is what makes the mismatch a 403.
const signableUploadHeaders = new Set(['content-type'])

/**
 * Signs a PUT URL locally, contacting nothing, so a missing bucket or a rejected credential surfaces
 * on the client's own PUT rather than here. The returned headers must be sent verbatim.
 */
export async function createPresignedUploadUrl(
  options: CreatePresignedUploadUrlOptions,
): Promise<CreatePresignedUploadUrlResult> {
  const expiryCheck = checkPresignedUrlExpirySeconds(options.expiresInSeconds)
  if (expiryCheck.kind === 'storage-parameter-rejected') {
    return expiryCheck.failure
  }
  const expiresInSeconds = expiryCheck.parameterValue
  const contentType = String(options.contentType)

  try {
    return await withStorageS3Client(options.storageConnection, async (s3Client) => {
      const signedAtMs = Date.now()
      const presignedUploadUrl = await getSignedUrl(
        s3Client,
        new PutObjectCommand({
          Bucket: String(options.storageConnection.storageBucketName),
          Key: String(options.storageObjectKey),
          ContentType: contentType,
        }),
        { expiresIn: expiresInSeconds, signableHeaders: signableUploadHeaders },
      )

      return {
        kind: 'presigned-upload-url-created',
        presignedUploadUrl: presignedStorageUrlSchema.parse(presignedUploadUrl),
        storageObjectKey: options.storageObjectKey,
        requiredRequestHeaders: { 'content-type': contentType },
        expiresAt: new Date(signedAtMs + expiresInSeconds * 1000),
      }
    })
  } catch (error) {
    return mapStorageErrorToFailure(error, options.storageConnection)
  }
}
