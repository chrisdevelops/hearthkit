import type { StorageConnection, StorageFailure } from './storage-contract.ts'
import {
  storageBucketNotFoundFailure,
  storageCredentialsRejectedFailure,
  storageEndpointUnreachableFailure,
  storageRequestFailedFailure,
} from './storage-failure-results.ts'
import {
  describeStorageError,
  isStorageEndpointUnreachableError,
  readStorageErrorCode,
  readStorageErrorStatusCode,
} from './storage-s3-error-details.ts'

// The S3 code a missing bucket comes back with wherever the response carries a body at all.
const noSuchBucketErrorCode = 'NoSuchBucket'

/**
 * Maps anything thrown by the S3 SDK onto the contract failure union, so no call ever throws. A bare
 * 404 from a HEAD lands in storage-request-failed here; the download path resolves that case itself
 * with a bucket-level HEAD, because a HEAD response carries no code to tell the two apart.
 */
export function mapStorageErrorToFailure(
  error: unknown,
  storageConnection: StorageConnection,
): StorageFailure {
  if (isStorageEndpointUnreachableError(error)) {
    return storageEndpointUnreachableFailure(
      storageConnection.storageEndpointUrl,
      describeStorageError(error),
    )
  }

  const httpStatusCode = readStorageErrorStatusCode(error)
  if (httpStatusCode === 403) {
    return storageCredentialsRejectedFailure(
      storageConnection.storageAccessKeyId,
      describeStorageError(error),
    )
  }

  const storageErrorCode = readStorageErrorCode(error)
  if (storageErrorCode === noSuchBucketErrorCode) {
    return storageBucketNotFoundFailure(storageConnection.storageBucketName)
  }

  return storageRequestFailedFailure(storageErrorCode, httpStatusCode, describeStorageError(error))
}
