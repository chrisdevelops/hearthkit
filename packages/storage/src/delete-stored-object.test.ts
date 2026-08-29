import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadHearthkitStorageEntry } from '../test-fixtures/hearthkit-storage-entry.ts'
import {
  createGateBucket,
  putGateObject,
  readGateObjectHead,
  removeGateBucket,
  type GateBucket,
} from '../test-fixtures/minio-gate-bucket.ts'
import {
  gateObjectBytes,
  gateTextContentType,
  uniqueGateObjectKey,
} from '../test-fixtures/storage-gate-connections.ts'
import { expectResultKind } from '../test-fixtures/storage-gate-expectations.ts'
import { deleteStoredObjectResultSchema } from './storage-contract.ts'

let gateBucket: GateBucket

beforeAll(async () => {
  gateBucket = await createGateBucket()
})

afterAll(async () => {
  await removeGateBucket(gateBucket)
})

describe('deleteStoredObject', () => {
  it('deletes idempotently: an object that exists, the same key a second time, and a key that never existed all succeed', async () => {
    const { deleteStoredObject } = await loadHearthkitStorageEntry()
    const storageObjectKey = uniqueGateObjectKey('delete')
    await putGateObject(
      gateBucket,
      storageObjectKey,
      gateObjectBytes('delete'),
      gateTextContentType,
    )

    const firstDelete = await deleteStoredObject({
      storageConnection: gateBucket.storageConnection,
      storageObjectKey,
    })
    deleteStoredObjectResultSchema.parse(firstDelete)
    expect(expectResultKind(firstDelete, 'stored-object-deleted').storageObjectKey).toBe(
      storageObjectKey,
    )
    expect(await readGateObjectHead(gateBucket, storageObjectKey)).toEqual({
      kind: 'gate-object-absent',
    })

    // Retry semantics: a delete that already succeeded must not start failing when it is repeated.
    const secondDelete = await deleteStoredObject({
      storageConnection: gateBucket.storageConnection,
      storageObjectKey,
    })
    deleteStoredObjectResultSchema.parse(secondDelete)
    expectResultKind(secondDelete, 'stored-object-deleted')

    // Success does not mean the key existed: this one never did, and there is no failure variant
    // for it anywhere in the package.
    const neverExisted = uniqueGateObjectKey('delete-never-existed')
    const neverExistedResult = await deleteStoredObject({
      storageConnection: gateBucket.storageConnection,
      storageObjectKey: neverExisted,
    })
    deleteStoredObjectResultSchema.parse(neverExistedResult)
    expect(expectResultKind(neverExistedResult, 'stored-object-deleted').storageObjectKey).toBe(
      neverExisted,
    )
  })
})
