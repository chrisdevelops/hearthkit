import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  startFailingStorageServer,
  type FailingStorageServer,
} from '../test-fixtures/failing-storage-server.ts'
import { loadHearthkitStorageEntry } from '../test-fixtures/hearthkit-storage-entry.ts'
import {
  createGateBucket,
  removeGateBucket,
  type GateBucket,
} from '../test-fixtures/minio-gate-bucket.ts'
import {
  gateTextContentType,
  gateUnknownAccessKeyId,
  rejectedCredentialsStorageConnection,
  storageConnectionForEndpoint,
  uniqueGateObjectKey,
  unreachableStorageEndpointUrl,
  unreachableStorageEndpointUrls,
} from '../test-fixtures/storage-gate-connections.ts'
import {
  expectStorageFailure,
  expectValueCarriesNoSecret,
} from '../test-fixtures/storage-gate-expectations.ts'
import {
  storageCredentialsRejectedErrorPrefix,
  storageEndpointUnreachableErrorPrefix,
  storageRequestFailedErrorPrefix,
} from './storage-contract.ts'

let gateBucket: GateBucket
let failingServer: FailingStorageServer

beforeAll(async () => {
  gateBucket = await createGateBucket()
  failingServer = await startFailingStorageServer()
})

afterAll(async () => {
  await failingServer.closeFailingStorageServer()
  await removeGateBucket(gateBucket)
})

describe('storage failure modes shared by every function that reaches the network', () => {
  it('returns storage-endpoint-unreachable, naming the endpoint, whether the connection is refused or the name does not resolve', async () => {
    const { createPresignedDownloadUrl, deleteStoredObject, listStoredObjects } =
      await loadHearthkitStorageEntry()

    // Three shapes the SDK produces: an AggregateError with an empty message (a name that resolves
    // to two addresses), a plain ECONNREFUSED Error (a literal address), and ENOTFOUND (a name that
    // does not resolve). All three are the same thing to a caller.
    for (const storageEndpointUrl of unreachableStorageEndpointUrls) {
      const storageConnection = storageConnectionForEndpoint(
        storageEndpointUrl,
        gateBucket.storageBucketName,
      )
      const storageObjectKey = uniqueGateObjectKey('unreachable')

      const results = [
        await createPresignedDownloadUrl({ storageConnection, storageObjectKey }),
        await deleteStoredObject({ storageConnection, storageObjectKey }),
        await listStoredObjects({ storageConnection }),
      ]

      for (const result of results) {
        const failure = expectStorageFailure(result, 'storage-endpoint-unreachable')
        expect(failure.storageEndpointUrl).toBe(storageEndpointUrl)
        expect(failure.message.startsWith(storageEndpointUnreachableErrorPrefix)).toBe(true)
        expect(failure.message).toContain(String(storageEndpointUrl))
      }
    }
  })

  it('returns storage-credentials-rejected for any 403, naming the access key id and never the secret', async () => {
    const { createPresignedDownloadUrl, deleteStoredObject, listStoredObjects } =
      await loadHearthkitStorageEntry()
    const storageConnection = rejectedCredentialsStorageConnection(gateBucket.storageBucketName)
    const storageObjectKey = uniqueGateObjectKey('rejected-credentials')

    const results = [
      // The download path is the one that can go wrong quietly: its HEAD answers 403 with no body,
      // so an implementation reading only the status shape could call this a missing object.
      await createPresignedDownloadUrl({ storageConnection, storageObjectKey }),
      await deleteStoredObject({ storageConnection, storageObjectKey }),
      await listStoredObjects({ storageConnection }),
    ]

    for (const result of results) {
      const failure = expectStorageFailure(result, 'storage-credentials-rejected')
      expect(failure.storageAccessKeyId).toBe(gateUnknownAccessKeyId)
      expect(failure.message.startsWith(storageCredentialsRejectedErrorPrefix)).toBe(true)
    }
  })

  it('returns storage-request-failed with the status code when the object store answers 500', async () => {
    const { createPresignedDownloadUrl, deleteStoredObject, listStoredObjects } =
      await loadHearthkitStorageEntry()
    const storageConnection = storageConnectionForEndpoint(
      failingServer.storageEndpointUrl,
      gateBucket.storageBucketName,
    )
    const storageObjectKey = uniqueGateObjectKey('request-failed')

    const results = [
      await createPresignedDownloadUrl({ storageConnection, storageObjectKey }),
      await deleteStoredObject({ storageConnection, storageObjectKey }),
      await listStoredObjects({ storageConnection }),
    ]

    for (const result of results) {
      const failure = expectStorageFailure(result, 'storage-request-failed')
      expect(failure.httpStatusCode).toBe(500)
      // The S3 error code where a body carried one, the SDK error name where the HEAD had none.
      expect(failure.storageErrorCode.length).toBeGreaterThan(0)
      expect(failure.message.startsWith(storageRequestFailedErrorPrefix)).toBe(true)
    }
    expect(failingServer.receivedRequestCount()).toBeGreaterThan(0)
  })

  it('returns every failure as a value, so no call ever throws and no returned value carries the secret', async () => {
    const {
      createPresignedUploadUrl,
      createPresignedDownloadUrl,
      deleteStoredObject,
      listStoredObjects,
    } = await loadHearthkitStorageEntry()
    const storageConnection = storageConnectionForEndpoint(
      unreachableStorageEndpointUrl,
      gateBucket.storageBucketName,
    )
    const storageObjectKey = uniqueGateObjectKey('never-throws')

    const settled = await Promise.allSettled([
      // Out of range, so it fails without a network call; the other three fail at the socket.
      createPresignedUploadUrl({
        storageConnection,
        storageObjectKey,
        contentType: gateTextContentType,
        expiresInSeconds: 0,
      }),
      createPresignedDownloadUrl({ storageConnection, storageObjectKey }),
      deleteStoredObject({ storageConnection, storageObjectKey }),
      listStoredObjects({ storageConnection }),
    ])

    for (const outcome of settled) {
      expect(
        outcome.status,
        `a storage call rejected instead of returning a failure: ${outcome.status === 'rejected' ? String(outcome.reason) : ''}`,
      ).toBe('fulfilled')
      if (outcome.status === 'fulfilled') {
        expectValueCarriesNoSecret(outcome.value)
      }
    }

    // Fulfilling with anything at all is not enough: each value must be the contract failure for
    // what went wrong, so this gate cannot go green against a function that resolves with a stub.
    const [uploadOutcome, ...networkOutcomes] = settled
    expect(uploadOutcome?.status).toBe('fulfilled')
    if (uploadOutcome?.status === 'fulfilled') {
      expectStorageFailure(uploadOutcome.value, 'storage-parameter-out-of-range')
    }
    for (const outcome of networkOutcomes) {
      if (outcome.status === 'fulfilled') {
        expectStorageFailure(outcome.value, 'storage-endpoint-unreachable')
      }
    }
  })
})
