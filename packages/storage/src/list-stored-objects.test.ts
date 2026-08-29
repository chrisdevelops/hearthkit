import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadHearthkitStorageEntry } from '../test-fixtures/hearthkit-storage-entry.ts'
import {
  createGateBucket,
  putGateObject,
  removeGateBucket,
  type GateBucket,
} from '../test-fixtures/minio-gate-bucket.ts'
import {
  gateObjectKeyUnderPrefix,
  gateStorageConnection,
  gateTextContentType,
  neverCreatedGateBucketName,
  uniqueGateObjectKeyPrefix,
} from '../test-fixtures/storage-gate-connections.ts'
import {
  expectResultKind,
  expectStorageFailure,
} from '../test-fixtures/storage-gate-expectations.ts'
import {
  listStoredObjectsResultSchema,
  storageBucketNotFoundErrorPrefix,
  storageObjectKeyPrefixSchema,
  type StorageObjectKey,
} from './storage-contract.ts'

let gateBucket: GateBucket

beforeAll(async () => {
  gateBucket = await createGateBucket()
})

afterAll(async () => {
  await removeGateBucket(gateBucket)
})

// Three keys under one prefix and one outside it, each a different length so byte counts are
// distinguishable in the assertions.
async function seedGateListing(
  objectKeyPrefix: ReturnType<typeof uniqueGateObjectKeyPrefix>,
): Promise<{ matchingKeys: StorageObjectKey[]; matchingByteCounts: number[] }> {
  const matchingKeys: StorageObjectKey[] = []
  const matchingByteCounts: number[] = []
  for (const [index, lastSegment] of ['alpha.txt', 'bravo.txt', 'charlie.txt'].entries()) {
    const storageObjectKey = gateObjectKeyUnderPrefix(objectKeyPrefix, lastSegment)
    const bodyBytes = new TextEncoder().encode('g'.repeat(index + 1))
    await putGateObject(gateBucket, storageObjectKey, bodyBytes, gateTextContentType)
    matchingKeys.push(storageObjectKey)
    matchingByteCounts.push(bodyBytes.byteLength)
  }
  return { matchingKeys, matchingByteCounts }
}

describe('listStoredObjects', () => {
  it('lists only the keys under the given prefix, with each key byte count and modified time', async () => {
    const { listStoredObjects } = await loadHearthkitStorageEntry()
    const objectKeyPrefix = uniqueGateObjectKeyPrefix('list-prefix')
    const { matchingKeys, matchingByteCounts } = await seedGateListing(objectKeyPrefix)

    // Same bucket, different prefix: it must not appear in the filtered listing.
    const unmatchedPrefix = uniqueGateObjectKeyPrefix('list-elsewhere')
    await putGateObject(
      gateBucket,
      gateObjectKeyUnderPrefix(unmatchedPrefix, 'delta.txt'),
      new TextEncoder().encode('dddd'),
      gateTextContentType,
    )

    const result = await listStoredObjects({
      storageConnection: gateBucket.storageConnection,
      objectKeyPrefix,
    })
    listStoredObjectsResultSchema.parse(result)
    const listed = expectResultKind(result, 'stored-objects-listed')

    expect(listed.storedObjects.map((stored) => String(stored.storageObjectKey))).toEqual(
      matchingKeys.map(String),
    )
    expect(listed.storedObjects.map((stored) => stored.objectByteCount)).toEqual(matchingByteCounts)
    for (const stored of listed.storedObjects) {
      expect(stored.objectLastModifiedAt.getTime()).toBeGreaterThan(Date.now() - 300_000)
    }
    expect(listed.pageStatus).toEqual({ kind: 'stored-objects-page-complete' })
  })

  it('returns an empty list rather than a failure when the prefix matches nothing', async () => {
    const { listStoredObjects } = await loadHearthkitStorageEntry()

    const result = await listStoredObjects({
      storageConnection: gateBucket.storageConnection,
      objectKeyPrefix: uniqueGateObjectKeyPrefix('list-nothing'),
    })

    listStoredObjectsResultSchema.parse(result)
    const listed = expectResultKind(result, 'stored-objects-listed')
    expect(listed.storedObjects).toEqual([])
    expect(listed.pageStatus).toEqual({ kind: 'stored-objects-page-complete' })
  })

  it('returns a continuation token for a truncated page that fetches the remaining keys', async () => {
    const { listStoredObjects } = await loadHearthkitStorageEntry()
    const objectKeyPrefix = uniqueGateObjectKeyPrefix('list-page')
    const { matchingKeys } = await seedGateListing(objectKeyPrefix)

    const firstResult = await listStoredObjects({
      storageConnection: gateBucket.storageConnection,
      objectKeyPrefix,
      maxObjectCount: 2,
    })
    listStoredObjectsResultSchema.parse(firstResult)
    const firstPage = expectResultKind(firstResult, 'stored-objects-listed')
    expect(firstPage.storedObjects).toHaveLength(2)
    const truncated = expectResultKind(firstPage.pageStatus, 'stored-objects-page-truncated')
    expect(String(truncated.nextContinuationToken).length).toBeGreaterThan(0)

    const secondResult = await listStoredObjects({
      storageConnection: gateBucket.storageConnection,
      objectKeyPrefix,
      maxObjectCount: 2,
      continuationToken: truncated.nextContinuationToken,
    })
    listStoredObjectsResultSchema.parse(secondResult)
    const secondPage = expectResultKind(secondResult, 'stored-objects-listed')
    expect(secondPage.storedObjects).toHaveLength(1)
    expect(secondPage.pageStatus).toEqual({ kind: 'stored-objects-page-complete' })

    // The two pages together are every key, each exactly once.
    expect(
      [...firstPage.storedObjects, ...secondPage.storedObjects].map((stored) =>
        String(stored.storageObjectKey),
      ),
    ).toEqual(matchingKeys.map(String))
  })

  it('returns storage-bucket-not-found for a bucket that was never created', async () => {
    const { listStoredObjects } = await loadHearthkitStorageEntry()
    const missingBucketName = neverCreatedGateBucketName()

    const result = await listStoredObjects({
      storageConnection: gateStorageConnection(missingBucketName),
      objectKeyPrefix: storageObjectKeyPrefixSchema.parse('gate-anything/'),
    })

    listStoredObjectsResultSchema.parse(result)
    const failure = expectStorageFailure(result, 'storage-bucket-not-found')
    expect(failure.storageBucketName).toBe(missingBucketName)
    expect(failure.message.startsWith(storageBucketNotFoundErrorPrefix)).toBe(true)
  })
})
