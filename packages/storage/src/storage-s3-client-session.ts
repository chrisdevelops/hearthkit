import { S3Client } from '@aws-sdk/client-s3'
import type { StorageConnection } from './storage-contract.ts'

/**
 * Runs one call against a client built from the connection and destroyed before returning. Path-style
 * addressing is what MinIO requires and R2 accepts, and the static credentials keep the ambient AWS
 * provider chain out of it, so nothing is cached between calls and no socket outlives one.
 */
export async function withStorageS3Client<TResult>(
  storageConnection: StorageConnection,
  runStorageCall: (s3Client: S3Client) => Promise<TResult>,
): Promise<TResult> {
  const s3Client = new S3Client({
    endpoint: String(storageConnection.storageEndpointUrl),
    region: String(storageConnection.storageRegionName),
    forcePathStyle: true,
    credentials: {
      accessKeyId: String(storageConnection.storageAccessKeyId),
      secretAccessKey: String(storageConnection.storageSecretAccessKey),
    },
  })

  try {
    return await runStorageCall(s3Client)
  } finally {
    s3Client.destroy()
  }
}
