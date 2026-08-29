import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadHearthkitStorageEntry } from '../test-fixtures/hearthkit-storage-entry.ts'
import {
  createGateBucket,
  readGateObjectHead,
  removeGateBucket,
  type GateBucket,
} from '../test-fixtures/minio-gate-bucket.ts'
import {
  gateHtmlContentType,
  gateObjectBytes,
  gateStorageConnection,
  gateTextContentType,
  neverCreatedGateBucketName,
  uniqueGateObjectKey,
} from '../test-fixtures/storage-gate-connections.ts'
import { expectResultKind } from '../test-fixtures/storage-gate-expectations.ts'
import {
  createPresignedUploadUrlResultSchema,
  defaultPresignedUrlExpirySeconds,
} from './storage-contract.ts'

let gateBucket: GateBucket

beforeAll(async () => {
  gateBucket = await createGateBucket()
})

afterAll(async () => {
  await removeGateBucket(gateBucket)
})

describe('createPresignedUploadUrl', () => {
  it('pins the signed content type, so a PUT sending any other value is refused and the stored type is the one the server chose', async () => {
    const { createPresignedUploadUrl } = await loadHearthkitStorageEntry()
    const storageObjectKey = uniqueGateObjectKey('content-type-pin')
    const fileBytes = gateObjectBytes('content-type-pin')

    const result = await createPresignedUploadUrl({
      storageConnection: gateBucket.storageConnection,
      storageObjectKey,
      contentType: gateTextContentType,
    })
    createPresignedUploadUrlResultSchema.parse(result)
    const upload = expectResultKind(result, 'presigned-upload-url-created')
    expect(upload.requiredRequestHeaders).toEqual({ 'content-type': String(gateTextContentType) })

    // The stored-XSS hazard: without signableHeaders the object store accepts this with 200 and
    // stores the client's chosen type. It must be refused.
    const smuggledHtml = await fetch(upload.presignedUploadUrl, {
      method: 'PUT',
      headers: { 'content-type': String(gateHtmlContentType) },
      body: fileBytes,
    })
    await smuggledHtml.text()
    expect(smuggledHtml.status).toBe(403)

    // A browser fetch with a string body sends text/plain;charset=UTF-8, which is not the signed
    // value either. This is why requiredRequestHeaders exists rather than callers guessing.
    const browserDefaultHeader = await fetch(upload.presignedUploadUrl, {
      method: 'PUT',
      body: 'gate string body',
    })
    await browserDefaultHeader.text()
    expect(browserDefaultHeader.status).toBe(403)

    // Omitting the header is refused too. MinIO answers 400 here rather than the 403 it uses for a
    // wrong value; either way the upload never lands.
    const noHeader = await fetch(upload.presignedUploadUrl, { method: 'PUT', body: fileBytes })
    await noHeader.text()
    expect([400, 403]).toContain(noHeader.status)
    expect(await readGateObjectHead(gateBucket, storageObjectKey)).toEqual({
      kind: 'gate-object-absent',
    })

    const matching = await fetch(upload.presignedUploadUrl, {
      method: 'PUT',
      headers: upload.requiredRequestHeaders,
      body: fileBytes,
    })
    const matchingBody = await matching.text()
    expect(matching.status, `PUT with requiredRequestHeaders was refused: ${matchingBody}`).toBe(
      200,
    )
    expect(await readGateObjectHead(gateBucket, storageObjectKey)).toEqual({
      kind: 'gate-object-present',
      storedContentType: String(gateTextContentType),
      storedByteCount: fileBytes.byteLength,
    })
  })

  it('signs an upload for a bucket that does not exist, because signing contacts nothing', async () => {
    const { createPresignedUploadUrl } = await loadHearthkitStorageEntry()
    const missingBucketName = neverCreatedGateBucketName()
    const storageObjectKey = uniqueGateObjectKey('missing-bucket')

    const result = await createPresignedUploadUrl({
      storageConnection: gateStorageConnection(missingBucketName),
      storageObjectKey,
      contentType: gateTextContentType,
    })
    createPresignedUploadUrlResultSchema.parse(result)
    const upload = expectResultKind(result, 'presigned-upload-url-created')
    expect(new URL(upload.presignedUploadUrl).pathname).toBe(
      `/${missingBucketName}/${storageObjectKey}`,
    )

    // The contract's reason this is not a failure: the missing bucket surfaces on the client's PUT.
    const putResponse = await fetch(upload.presignedUploadUrl, {
      method: 'PUT',
      headers: upload.requiredRequestHeaders,
      body: gateObjectBytes('missing-bucket'),
    })
    await putResponse.text()
    expect(putResponse.status).toBe(404)
  })

  it('defaults expiry to fifteen minutes and signs a URL the object store refuses once expiresInSeconds has elapsed', async () => {
    const { createPresignedUploadUrl } = await loadHearthkitStorageEntry()

    const defaulted = expectResultKind(
      await createPresignedUploadUrl({
        storageConnection: gateBucket.storageConnection,
        storageObjectKey: uniqueGateObjectKey('default-expiry'),
        contentType: gateTextContentType,
      }),
      'presigned-upload-url-created',
    )
    const defaultExpiryMs = defaultPresignedUrlExpirySeconds * 1000
    expect(defaulted.expiresAt.getTime()).toBeGreaterThan(Date.now() + defaultExpiryMs - 30_000)
    expect(defaulted.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + defaultExpiryMs)

    const storageObjectKey = uniqueGateObjectKey('short-expiry')
    const shortLived = expectResultKind(
      await createPresignedUploadUrl({
        storageConnection: gateBucket.storageConnection,
        storageObjectKey,
        contentType: gateTextContentType,
        expiresInSeconds: 1,
      }),
      'presigned-upload-url-created',
    )
    expect(shortLived.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000)

    await new Promise((resolve) => setTimeout(resolve, 2_500))

    const expired = await fetch(shortLived.presignedUploadUrl, {
      method: 'PUT',
      headers: shortLived.requiredRequestHeaders,
      body: gateObjectBytes('short-expiry'),
    })
    const expiredBody = await expired.text()
    expect(expired.status).toBe(403)
    expect(expiredBody).toContain('expired')
    expect(await readGateObjectHead(gateBucket, storageObjectKey)).toEqual({
      kind: 'gate-object-absent',
    })
  })
})
