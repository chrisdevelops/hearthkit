import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadHearthkitStorageEntry } from '../test-fixtures/hearthkit-storage-entry.ts'
import {
  createGateBucket,
  readGateObjectHead,
  removeGateBucket,
  type GateBucket,
} from '../test-fixtures/minio-gate-bucket.ts'
import {
  gateObjectBytes,
  gateTextContentType,
  uniqueGateObjectKey,
} from '../test-fixtures/storage-gate-connections.ts'
import {
  expectResultKind,
  expectStorageFailure,
} from '../test-fixtures/storage-gate-expectations.ts'
import {
  createPresignedDownloadUrlResultSchema,
  createPresignedUploadUrlResultSchema,
  deleteStoredObjectResultSchema,
  storageObjectNotFoundErrorPrefix,
} from './storage-contract.ts'

let gateBucket: GateBucket

beforeAll(async () => {
  gateBucket = await createGateBucket()
})

afterAll(async () => {
  await removeGateBucket(gateBucket)
})

describe('presigned object round trip', () => {
  it('presigns an upload, PUTs it with plain fetch, presigns a download, GETs identical bytes back, deletes it, and then reports it gone', async () => {
    const { createPresignedUploadUrl, createPresignedDownloadUrl, deleteStoredObject } =
      await loadHearthkitStorageEntry()
    const storageObjectKey = uniqueGateObjectKey('round-trip')
    const fileBytes = gateObjectBytes('round-trip')

    const uploadResult = await createPresignedUploadUrl({
      storageConnection: gateBucket.storageConnection,
      storageObjectKey,
      contentType: gateTextContentType,
    })
    createPresignedUploadUrlResultSchema.parse(uploadResult)
    const upload = expectResultKind(uploadResult, 'presigned-upload-url-created')
    expect(upload.storageObjectKey).toBe(storageObjectKey)
    expect(upload.expiresAt.getTime()).toBeGreaterThan(Date.now())

    // forcePathStyle: the bucket is a path segment, not a subdomain, which is what MinIO requires
    // and R2 accepts.
    const uploadUrl = new URL(upload.presignedUploadUrl)
    expect(uploadUrl.origin).toBe(
      new URL(String(gateBucket.storageConnection.storageEndpointUrl)).origin,
    )
    expect(uploadUrl.pathname).toBe(`/${gateBucket.storageBucketName}/${storageObjectKey}`)

    // requiredRequestHeaders is sent verbatim: the gate must not guess what the signature covers.
    expect(upload.requiredRequestHeaders).toEqual({ 'content-type': String(gateTextContentType) })
    const putResponse = await fetch(upload.presignedUploadUrl, {
      method: 'PUT',
      headers: upload.requiredRequestHeaders,
      body: fileBytes,
    })
    const putBody = await putResponse.text()
    expect(putResponse.status, `PUT was refused: ${putBody}`).toBe(200)

    const downloadResult = await createPresignedDownloadUrl({
      storageConnection: gateBucket.storageConnection,
      storageObjectKey,
    })
    createPresignedDownloadUrlResultSchema.parse(downloadResult)
    const download = expectResultKind(downloadResult, 'presigned-download-url-created')
    expect(download.storageObjectKey).toBe(storageObjectKey)
    expect(download.objectByteCount).toBe(fileBytes.byteLength)
    expect(download.objectContentType).toBe(String(gateTextContentType))
    expect(download.objectLastModifiedAt.getTime()).toBeGreaterThan(Date.now() - 300_000)
    expect(download.expiresAt.getTime()).toBeGreaterThan(Date.now())

    const getResponse = await fetch(download.presignedDownloadUrl)
    expect(getResponse.status).toBe(200)
    expect(new Uint8Array(await getResponse.arrayBuffer())).toEqual(fileBytes)

    const deleteResult = await deleteStoredObject({
      storageConnection: gateBucket.storageConnection,
      storageObjectKey,
    })
    deleteStoredObjectResultSchema.parse(deleteResult)
    expect(expectResultKind(deleteResult, 'stored-object-deleted').storageObjectKey).toBe(
      storageObjectKey,
    )

    // Confirmed twice: straight from MinIO, and through the download presign the contract points at.
    expect(await readGateObjectHead(gateBucket, storageObjectKey)).toEqual({
      kind: 'gate-object-absent',
    })
    const afterDelete = await createPresignedDownloadUrl({
      storageConnection: gateBucket.storageConnection,
      storageObjectKey,
    })
    createPresignedDownloadUrlResultSchema.parse(afterDelete)
    const gone = expectStorageFailure(afterDelete, 'storage-object-not-found')
    expect(gone.storageObjectKey).toBe(storageObjectKey)
    expect(gone.message.startsWith(storageObjectNotFoundErrorPrefix)).toBe(true)
  })
})
