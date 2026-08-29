import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import { mapListedPageStatus, mapListedStoredObjects } from './listed-stored-objects-page.ts'
import type { ListStoredObjectsOptions, ListStoredObjectsResult } from './storage-contract.ts'
import { mapStorageErrorToFailure } from './storage-error-to-failure.ts'
import { checkListedObjectCount } from './storage-number-parameter-range.ts'
import { withStorageS3Client } from './storage-s3-client-session.ts'

/**
 * Reads one page of keys. The prefix is a literal filter, never a directory, and an empty result is a
 * success rather than a failure; a caller that wants everything loops while the page status is truncated.
 */
export async function listStoredObjects(
  options: ListStoredObjectsOptions,
): Promise<ListStoredObjectsResult> {
  const countCheck = checkListedObjectCount(options.maxObjectCount)
  if (countCheck.kind === 'storage-parameter-rejected') {
    return countCheck.failure
  }

  try {
    return await withStorageS3Client(options.storageConnection, async (s3Client) => {
      const listedPage = await s3Client.send(
        new ListObjectsV2Command({
          Bucket: String(options.storageConnection.storageBucketName),
          Prefix:
            options.objectKeyPrefix === undefined ? undefined : String(options.objectKeyPrefix),
          MaxKeys: countCheck.parameterValue,
          ContinuationToken:
            options.continuationToken === undefined ? undefined : String(options.continuationToken),
        }),
      )

      return {
        kind: 'stored-objects-listed',
        storedObjects: mapListedStoredObjects(listedPage.Contents),
        pageStatus: mapListedPageStatus(listedPage.IsTruncated, listedPage.NextContinuationToken),
      }
    })
  } catch (error) {
    return mapStorageErrorToFailure(error, options.storageConnection)
  }
}
