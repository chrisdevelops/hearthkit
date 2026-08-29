import { HeadBucketCommand, type S3Client } from '@aws-sdk/client-s3'
import type { StorageConnection, StorageFailure, StorageObjectKey } from './storage-contract.ts'
import { mapStorageErrorToFailure } from './storage-error-to-failure.ts'
import {
  storageBucketNotFoundFailure,
  storageObjectNotFoundFailure,
} from './storage-failure-results.ts'
import { readStorageErrorStatusCode } from './storage-s3-error-details.ts'

// HTTP 404 arrives for a missing key and a missing bucket alike, which is the whole reason this
// module exists.
const notFoundHttpStatusCode = 404

/**
 * Decides which thing was missing after a HEAD on an object answered 404. A HEAD response has no XML
 * body, so the S3 error code never arrives and a missing key and a missing bucket are byte-identical;
 * a second bucket-level HEAD is the only way to tell them apart.
 */
export async function resolveMissingStorageObjectFailure(
  s3Client: S3Client,
  storageConnection: StorageConnection,
  storageObjectKey: StorageObjectKey,
): Promise<StorageFailure> {
  try {
    await s3Client.send(
      new HeadBucketCommand({ Bucket: String(storageConnection.storageBucketName) }),
    )
  } catch (bucketError) {
    if (readStorageErrorStatusCode(bucketError) === notFoundHttpStatusCode) {
      return storageBucketNotFoundFailure(storageConnection.storageBucketName)
    }
    return mapStorageErrorToFailure(bucketError, storageConnection)
  }

  return storageObjectNotFoundFailure(storageObjectKey, storageConnection.storageBucketName)
}
