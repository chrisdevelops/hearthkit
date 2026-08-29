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
  StorageEndpointUrl,
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

// The Node socket and DNS codes that all mean one thing to a gate: nothing answered at the endpoint.
// Listed here rather than imported from src/, because a fixture that leaned on the code under test
// could not report honestly on the run where that code is what is broken.
const unreachableGateEndpointErrorCodes = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
])

// Reads an unknown thrown value as a property bag without asserting anything about its shape.
function readGateErrorRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Flattens what the SDK threw. A host that resolves to two addresses arrives as an AggregateError
 * whose own message is empty, so both the code and the readable words live on its members, not on it.
 */
function summarizeGateStorageError(error: unknown): {
  unreachableErrorCode: string | undefined
  errorDescription: string
} {
  const pending: unknown[] = [error]
  const visited = new Set<Record<string, unknown>>()
  let unreachableErrorCode: string | undefined
  let errorDescription = ''

  for (let index = 0; index < pending.length; index += 1) {
    const current = readGateErrorRecord(pending[index])
    if (current === undefined || visited.has(current)) {
      continue
    }
    visited.add(current)

    const errorCode = current.code
    if (
      unreachableErrorCode === undefined &&
      typeof errorCode === 'string' &&
      unreachableGateEndpointErrorCodes.has(errorCode)
    ) {
      unreachableErrorCode = errorCode
    }

    const message = current.message
    if (errorDescription === '' && typeof message === 'string' && message.length > 0) {
      errorDescription = message
    }

    const aggregated = current.errors
    if (Array.isArray(aggregated)) {
      pending.push(...Array.from<unknown>(aggregated))
    }
    pending.push(current.cause)
  }

  return {
    unreachableErrorCode,
    errorDescription: errorDescription === '' ? String(error) : errorDescription,
  }
}

/**
 * Turns a bucket setup failure into words a contributor can act on. A refused connection is the
 * common case — MinIO simply is not running — and gets its own sentence naming the endpoint and the
 * command that starts it. Every other failure keeps its own message, so a real MinIO error is never
 * reported as a missing container.
 */
function gateBucketSetupError(storageEndpointUrl: StorageEndpointUrl, error: unknown): Error {
  const { unreachableErrorCode, errorDescription } = summarizeGateStorageError(error)
  if (unreachableErrorCode !== undefined) {
    // No `cause` here on purpose. The endpoint, the code and the fix are the whole story, whereas the
    // raw value is an AggregateError with an empty message that the reporter prints as thirty lines
    // of socket internals — the noise this message exists to replace.
    return new Error(
      `gate cannot reach MinIO at ${String(storageEndpointUrl)} (${unreachableErrorCode}): the object storage service is not running. Start it from the repo root with "docker compose up -d --wait minio".`,
    )
  }
  // Anything else is unexplored, so the original travels with it: its words inline, its stack as cause.
  return new Error(
    `gate could not create a bucket in MinIO at ${String(storageEndpointUrl)}: ${errorDescription}`,
    { cause: error },
  )
}

/** Creates one throwaway bucket for a gate file, uniquely named so parallel files never collide. */
export async function createGateBucket(): Promise<GateBucket> {
  const storageBucketName = uniqueGateBucketName()
  const storageConnection = gateStorageConnection(storageBucketName)
  try {
    await withGateS3Client(storageConnection, async (client) => {
      await client.send(new CreateBucketCommand({ Bucket: String(storageBucketName) }))
    })
  } catch (error) {
    // The bucket name is deliberately left out: every gate file would otherwise report a different
    // string for one missing service, and the reporter would print six blocks instead of one.
    throw gateBucketSetupError(storageConnection.storageEndpointUrl, error)
  }
  return { storageBucketName, storageConnection }
}

/**
 * Deletes every object in a gate bucket and then the bucket, so a run leaves MinIO as it found it.
 * Takes undefined and does nothing, because when beforeAll failed there is no bucket to remove and a
 * teardown hook that threw there would bury the error that actually stopped the run.
 */
export async function removeGateBucket(bucket: GateBucket | undefined): Promise<void> {
  if (bucket === undefined) {
    return
  }
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
