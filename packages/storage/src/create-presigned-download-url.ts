import {
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  presignedStorageUrlSchema,
  type CreatePresignedDownloadUrlOptions,
  type CreatePresignedDownloadUrlResult,
} from './storage-contract.ts'
import { mapStorageErrorToFailure } from './storage-error-to-failure.ts'
import { checkPresignedUrlExpirySeconds } from './storage-number-parameter-range.ts'
import { resolveMissingStorageObjectFailure } from './resolve-missing-storage-object.ts'
import { withStorageS3Client } from './storage-s3-client-session.ts'
import { readStorageErrorStatusCode } from './storage-s3-error-details.ts'

const notFoundHttpStatusCode = 404

// Quoting is safe without escaping because storageDownloadFileNameSchema excludes quotes, slashes
// and anything else that could end the header value early.
function attachmentContentDisposition(downloadFileName: string): string {
  return `attachment; filename="${downloadFileName}"`
}

/**
 * Confirms the object exists with a HEAD and then signs a GET URL, so the returned metadata costs no
 * extra round trip and the browser is never handed a URL that 404s. Omitting downloadFileName leaves
 * the response header off entirely, which is what makes the browser fall back to the key's last segment.
 */
export async function createPresignedDownloadUrl(
  options: CreatePresignedDownloadUrlOptions,
): Promise<CreatePresignedDownloadUrlResult> {
  const expiryCheck = checkPresignedUrlExpirySeconds(options.expiresInSeconds)
  if (expiryCheck.kind === 'storage-parameter-rejected') {
    return expiryCheck.failure
  }
  const expiresInSeconds = expiryCheck.parameterValue
  const { storageConnection, storageObjectKey } = options
  const bucketName = String(storageConnection.storageBucketName)
  const objectKey = String(storageObjectKey)

  try {
    return await withStorageS3Client(storageConnection, async (s3Client) => {
      let headOutput: HeadObjectCommandOutput
      try {
        headOutput = await s3Client.send(
          new HeadObjectCommand({ Bucket: bucketName, Key: objectKey }),
        )
      } catch (headError) {
        if (readStorageErrorStatusCode(headError) === notFoundHttpStatusCode) {
          return await resolveMissingStorageObjectFailure(
            s3Client,
            storageConnection,
            storageObjectKey,
          )
        }
        return mapStorageErrorToFailure(headError, storageConnection)
      }

      const signedAtMs = Date.now()
      const presignedDownloadUrl = await getSignedUrl(
        s3Client,
        new GetObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          ResponseContentDisposition:
            options.downloadFileName === undefined
              ? undefined
              : attachmentContentDisposition(String(options.downloadFileName)),
        }),
        { expiresIn: expiresInSeconds },
      )

      return {
        kind: 'presigned-download-url-created',
        presignedDownloadUrl: presignedStorageUrlSchema.parse(presignedDownloadUrl),
        storageObjectKey,
        objectByteCount: headOutput.ContentLength ?? 0,
        objectContentType: headOutput.ContentType,
        // A successful HEAD always carries Last-Modified; the epoch keeps the result total if one ever does not.
        objectLastModifiedAt: headOutput.LastModified ?? new Date(0),
        expiresAt: new Date(signedAtMs + expiresInSeconds * 1000),
      }
    })
  } catch (error) {
    return mapStorageErrorToFailure(error, storageConnection)
  }
}
