import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type {
  StorageBucketName,
  StorageConnection,
  StorageContentType,
  StorageObjectKey,
} from '../src/storage-contract.ts'
import { gateStorageConnection, uniqueGateBucketName } from './storage-gate-connections.ts'

/**
 * Bucket lifecycle for the gates, driven by the S3 SDK directly. The package under test creates no
 * buckets and seeds no objects, so setup here must never go through it.
 */
export type GateBucket = {
  storageBucketName: StorageBucketName
  storageConnection: StorageConnection
}

// Every client is closed before the call returns, so a gate run is never held open by a socket.
async function withGateS3Client<TResult>(
  storageConnection: StorageConnection,
  run: (client: S3Client) => Promise<TResult>,
): Promise<TResult> {
  const client = new S3Client({
    endpoint: String(storageConnection.storageEndpointUrl),
    region: String(storageConnection.storageRegionName),
    forcePathStyle: true,
    credentials: {
      accessKeyId: String(storageConnection.storageAccessKeyId),
      secretAccessKey: String(storageConnection.storageSecretAccessKey),
    },
  })
  try {
    return await run(client)
  } finally {
    client.destroy()
  }
}

/** Creates one throwaway bucket for a gate file, uniquely named so parallel files never collide. */
export async function createGateBucket(): Promise<GateBucket> {
  const storageBucketName = uniqueGateBucketName()
  const storageConnection = gateStorageConnection(storageBucketName)
  await withGateS3Client(storageConnection, async (client) => {
    await client.send(new CreateBucketCommand({ Bucket: String(storageBucketName) }))
  })
  return { storageBucketName, storageConnection }
}

/** Deletes every object in a gate bucket and then the bucket, so a run leaves MinIO as it found it. */
export async function removeGateBucket(bucket: GateBucket): Promise<void> {
  await withGateS3Client(bucket.storageConnection, async (client) => {
    let continuationToken: string | undefined
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: String(bucket.storageBucketName),
          ContinuationToken: continuationToken,
        }),
      )
      for (const entry of page.Contents ?? []) {
        if (entry.Key !== undefined) {
          await client.send(
            new DeleteObjectCommand({ Bucket: String(bucket.storageBucketName), Key: entry.Key }),
          )
        }
      }
      continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined
    } while (continuationToken !== undefined)

    await client.send(new DeleteBucketCommand({ Bucket: String(bucket.storageBucketName) }))
  })
}

/** Stores one object with the SDK, so a gate's setup never depends on the code the gate is testing. */
export async function putGateObject(
  bucket: GateBucket,
  storageObjectKey: StorageObjectKey,
  bodyBytes: Uint8Array,
  contentType: StorageContentType,
): Promise<void> {
  await withGateS3Client(bucket.storageConnection, async (client) => {
    await client.send(
      new PutObjectCommand({
        Bucket: String(bucket.storageBucketName),
        Key: String(storageObjectKey),
        Body: bodyBytes,
        ContentType: String(contentType),
      }),
    )
  })
}

/** What MinIO stored for one key, read with the SDK; absent means the key is not there at all. */
export type GateObjectHead =
  | { kind: 'gate-object-present'; storedContentType: string | undefined; storedByteCount: number }
  | { kind: 'gate-object-absent' }

/** Reads one object's stored metadata straight from MinIO, so an assertion about it never goes through the package. */
export async function readGateObjectHead(
  bucket: GateBucket,
  storageObjectKey: StorageObjectKey,
): Promise<GateObjectHead> {
  return withGateS3Client(bucket.storageConnection, async (client) => {
    try {
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: String(bucket.storageBucketName),
          Key: String(storageObjectKey),
        }),
      )
      return {
        kind: 'gate-object-present',
        storedContentType: head.ContentType,
        storedByteCount: head.ContentLength ?? 0,
      }
    } catch {
      return { kind: 'gate-object-absent' }
    }
  })
}
