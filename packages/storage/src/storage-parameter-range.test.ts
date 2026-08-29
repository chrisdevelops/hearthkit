import { describe, expect, it } from 'vitest'
import { loadHearthkitStorageEntry } from '../test-fixtures/hearthkit-storage-entry.ts'
import {
  gateTextContentType,
  storageConnectionForEndpoint,
  uniqueGateBucketName,
  uniqueGateObjectKey,
  unreachableStorageEndpointUrl,
} from '../test-fixtures/storage-gate-connections.ts'
import {
  expectContractNumberExport,
  expectResultKind,
  expectStorageFailure,
} from '../test-fixtures/storage-gate-expectations.ts'
import {
  createPresignedDownloadUrlResultSchema,
  createPresignedUploadUrlResultSchema,
  listStoredObjectsResultSchema,
  maximumListedObjectCount,
  maximumPresignedUrlExpirySeconds,
  storageParameterOutOfRangeErrorPrefix,
} from './storage-contract.ts'

// Every connection here points at a dead port. A range failure returned rather than
// storage-endpoint-unreachable is the proof that the check happens before any network call, which
// is also why this file needs no MinIO and no bucket.
const offlineStorageConnection = storageConnectionForEndpoint(
  unreachableStorageEndpointUrl,
  uniqueGateBucketName(),
)

const longestExpiry = expectContractNumberExport(
  maximumPresignedUrlExpirySeconds,
  'maximumPresignedUrlExpirySeconds',
)
const largestPage = expectContractNumberExport(maximumListedObjectCount, 'maximumListedObjectCount')

describe('storage-parameter-out-of-range', () => {
  it('range-checks expiresInSeconds on both presign functions in both directions, before contacting anything', async () => {
    const { createPresignedUploadUrl, createPresignedDownloadUrl } =
      await loadHearthkitStorageEntry()

    for (const expiresInSeconds of [0, longestExpiry + 1]) {
      const uploadResult = await createPresignedUploadUrl({
        storageConnection: offlineStorageConnection,
        storageObjectKey: uniqueGateObjectKey('expiry-range'),
        contentType: gateTextContentType,
        expiresInSeconds,
      })
      createPresignedUploadUrlResultSchema.parse(uploadResult)
      const uploadFailure = expectStorageFailure(uploadResult, 'storage-parameter-out-of-range')
      expect(uploadFailure.parameterName).toBe('expiresInSeconds')
      expect(uploadFailure.parameterValue).toBe(expiresInSeconds)
      expect(uploadFailure.message.startsWith(storageParameterOutOfRangeErrorPrefix)).toBe(true)
      expect(uploadFailure.message).toContain('expiresInSeconds')
      expect(uploadFailure.message).toContain(String(expiresInSeconds))

      const downloadResult = await createPresignedDownloadUrl({
        storageConnection: offlineStorageConnection,
        storageObjectKey: uniqueGateObjectKey('expiry-range'),
        expiresInSeconds,
      })
      createPresignedDownloadUrlResultSchema.parse(downloadResult)
      const downloadFailure = expectStorageFailure(downloadResult, 'storage-parameter-out-of-range')
      expect(downloadFailure.parameterName).toBe('expiresInSeconds')
      expect(downloadFailure.parameterValue).toBe(expiresInSeconds)
    }

    // Both ends of the accepted range are inclusive, and an upload signs offline, so these succeed
    // against the same dead port.
    for (const expiresInSeconds of [1, longestExpiry]) {
      expectResultKind(
        await createPresignedUploadUrl({
          storageConnection: offlineStorageConnection,
          storageObjectKey: uniqueGateObjectKey('expiry-boundary'),
          contentType: gateTextContentType,
          expiresInSeconds,
        }),
        'presigned-upload-url-created',
      )
    }
  })

  it('range-checks maxObjectCount in both directions, before contacting anything', async () => {
    const { listStoredObjects } = await loadHearthkitStorageEntry()

    for (const maxObjectCount of [0, largestPage + 1]) {
      const result = await listStoredObjects({
        storageConnection: offlineStorageConnection,
        maxObjectCount,
      })
      listStoredObjectsResultSchema.parse(result)
      const failure = expectStorageFailure(result, 'storage-parameter-out-of-range')
      expect(failure.parameterName).toBe('maxObjectCount')
      expect(failure.parameterValue).toBe(maxObjectCount)
      expect(failure.message.startsWith(storageParameterOutOfRangeErrorPrefix)).toBe(true)
      expect(failure.message).toContain('maxObjectCount')
      expect(failure.message).toContain(String(maxObjectCount))
    }

    // An in-range page size passes the check and then reaches the network, which is the other half
    // of the ordering claim.
    for (const maxObjectCount of [1, largestPage]) {
      expectStorageFailure(
        await listStoredObjects({ storageConnection: offlineStorageConnection, maxObjectCount }),
        'storage-endpoint-unreachable',
      )
    }
  })
})
