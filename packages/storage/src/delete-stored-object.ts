import { DeleteObjectCommand } from '@aws-sdk/client-s3'
import type { DeleteStoredObjectOptions, DeleteStoredObjectResult } from './storage-contract.ts'
import { mapStorageErrorToFailure } from './storage-error-to-failure.ts'
import { withStorageS3Client } from './storage-s3-client-session.ts'

/**
 * Deletes one key. Idempotent, because S3 delete succeeds for a key that never existed: a repeated
 * delete must not start failing, so this function has no way to report that the key was already gone.
 */
export async function deleteStoredObject(
  options: DeleteStoredObjectOptions,
): Promise<DeleteStoredObjectResult> {
  try {
    return await withStorageS3Client(options.storageConnection, async (s3Client) => {
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: String(options.storageConnection.storageBucketName),
          Key: String(options.storageObjectKey),
        }),
      )
      return { kind: 'stored-object-deleted', storageObjectKey: options.storageObjectKey }
    })
  } catch (error) {
    return mapStorageErrorToFailure(error, options.storageConnection)
  }
}
