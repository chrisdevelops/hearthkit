import type { _Object } from '@aws-sdk/client-s3'
import { z } from 'zod'
import {
  storageContinuationTokenSchema,
  type StoredObjectsPageStatus,
  type StoredObjectSummary,
} from './storage-contract.ts'

// A listed key is branded without re-checking the strict key pattern. The object store may hold keys
// written by tools this package never saw, and a listing has to report what is there rather than hide
// it or fail the whole page; the strict schema still guards every key this package writes.
const listedStorageObjectKeySchema = z.string().brand<'StorageObjectKey'>()

/** Turns one page of ListObjectsV2 contents into contract summaries, dropping any entry the store sent without a key. */
export function mapListedStoredObjects(
  listedObjects: readonly _Object[] | undefined,
): StoredObjectSummary[] {
  const storedObjects: StoredObjectSummary[] = []
  for (const listedObject of listedObjects ?? []) {
    if (listedObject.Key === undefined) {
      continue
    }
    storedObjects.push({
      storageObjectKey: listedStorageObjectKeySchema.parse(listedObject.Key),
      objectByteCount: listedObject.Size ?? 0,
      // A listed object always carries LastModified; the epoch keeps the page total if one ever does not.
      objectLastModifiedAt: listedObject.LastModified ?? new Date(0),
    })
  }
  return storedObjects
}

/**
 * Pairs the truncation flag with its token so the two can never disagree: a page counts as truncated
 * only when the object store also handed back a token to continue with.
 */
export function mapListedPageStatus(
  isTruncated: boolean | undefined,
  nextContinuationToken: string | undefined,
): StoredObjectsPageStatus {
  if (isTruncated !== true) {
    return { kind: 'stored-objects-page-complete' }
  }
  const parsedToken = storageContinuationTokenSchema.safeParse(nextContinuationToken)
  if (!parsedToken.success) {
    return { kind: 'stored-objects-page-complete' }
  }
  return { kind: 'stored-objects-page-truncated', nextContinuationToken: parsedToken.data }
}
