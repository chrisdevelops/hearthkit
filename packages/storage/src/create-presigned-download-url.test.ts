import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadHearthkitStorageEntry } from '../test-fixtures/hearthkit-storage-entry.ts'
import {
  createGateBucket,
  putGateObject,
  removeGateBucket,
  type GateBucket,
} from '../test-fixtures/minio-gate-bucket.ts'
import {
  gateObjectBytes,
  gateStorageConnection,
  gateTextContentType,
  neverCreatedGateBucketName,
  uniqueGateObjectKey,
} from '../test-fixtures/storage-gate-connections.ts'
import {
  expectResultKind,
  expectStorageFailure,
} from '../test-fixtures/storage-gate-expectations.ts'
import {
  createPresignedDownloadUrlResultSchema,
  storageBucketNotFoundErrorPrefix,
  storageDownloadFileNameSchema,
  storageObjectNotFoundErrorPrefix,
} from './storage-contract.ts'

let gateBucket: GateBucket

beforeAll(async () => {
  gateBucket = await createGateBucket()
})

afterAll(async () => {
  await removeGateBucket(gateBucket)
})

describe('createPresignedDownloadUrl', () => {
  it('names the saved file through Content-Disposition when downloadFileName is given, and sends no such header when it is not', async () => {
    const { createPresignedDownloadUrl } = await loadHearthkitStorageEntry()
    const storageObjectKey = uniqueGateObjectKey('download-name')
    const fileBytes = gateObjectBytes('download-name')
    await putGateObject(gateBucket, storageObjectKey, fileBytes, gateTextContentType)

    const downloadFileName = storageDownloadFileNameSchema.parse('gate report 01.txt')
    const named = expectResultKind(
      await createPresignedDownloadUrl({
        storageConnection: gateBucket.storageConnection,
        storageObjectKey,
        downloadFileName,
      }),
      'presigned-download-url-created',
    )

    const namedResponse = await fetch(named.presignedDownloadUrl)
    expect(namedResponse.status).toBe(200)
    expect(namedResponse.headers.get('content-disposition')).toBe(
      `attachment; filename="${downloadFileName}"`,
    )
    expect(new Uint8Array(await namedResponse.arrayBuffer())).toEqual(fileBytes)

    // Omitting it must leave the header off entirely, so the browser falls back to the key's last
    // segment rather than to a name this package invented.
    const unnamed = expectResultKind(
      await createPresignedDownloadUrl({
        storageConnection: gateBucket.storageConnection,
        storageObjectKey,
      }),
      'presigned-download-url-created',
    )
    const unnamedResponse = await fetch(unnamed.presignedDownloadUrl)
    expect(unnamedResponse.status).toBe(200)
    expect(unnamedResponse.headers.get('content-disposition')).toBeNull()
    await unnamedResponse.arrayBuffer()
  })

  it('returns storage-object-not-found for a key that is not in a bucket that does exist', async () => {
    const { createPresignedDownloadUrl } = await loadHearthkitStorageEntry()
    const storageObjectKey = uniqueGateObjectKey('never-uploaded')

    const result = await createPresignedDownloadUrl({
      storageConnection: gateBucket.storageConnection,
      storageObjectKey,
    })

    createPresignedDownloadUrlResultSchema.parse(result)
    const failure = expectStorageFailure(result, 'storage-object-not-found')
    expect(failure.storageObjectKey).toBe(storageObjectKey)
    expect(failure.message.startsWith(storageObjectNotFoundErrorPrefix)).toBe(true)
  })

  it('returns storage-bucket-not-found when the bucket itself is missing, which the object HEAD alone cannot tell apart from a missing key', async () => {
    const { createPresignedDownloadUrl } = await loadHearthkitStorageEntry()
    const missingBucketName = neverCreatedGateBucketName()
    const storageObjectKey = uniqueGateObjectKey('missing-bucket-download')

    const result = await createPresignedDownloadUrl({
      storageConnection: gateStorageConnection(missingBucketName),
      storageObjectKey,
    })

    createPresignedDownloadUrlResultSchema.parse(result)
    const failure = expectStorageFailure(result, 'storage-bucket-not-found')
    expect(failure.storageBucketName).toBe(missingBucketName)
    expect(failure.message.startsWith(storageBucketNotFoundErrorPrefix)).toBe(true)
  })
})
