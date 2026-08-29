import { randomUUID } from 'node:crypto'
import {
  defaultStorageRegionName,
  storageAccessKeyIdSchema,
  storageBucketNameSchema,
  storageContentTypeSchema,
  storageEndpointUrlSchema,
  storageObjectKeyPrefixSchema,
  storageObjectKeySchema,
  storageRegionNameSchema,
  storageSecretAccessKeySchema,
  type StorageAccessKeyId,
  type StorageBucketName,
  type StorageConnection,
  type StorageContentType,
  type StorageEndpointUrl,
  type StorageObjectKey,
  type StorageObjectKeyPrefix,
} from '../src/storage-contract.ts'

/**
 * Builds StorageConnection values for the gates. Deliberately imports no S3 SDK and opens no socket,
 * so the parameter-range gates can use it without any object store running anywhere.
 */

/** MinIO from the repo-root docker-compose.yml; override when the service is not on the default port. */
export const gateStorageEndpointUrl: StorageEndpointUrl = storageEndpointUrlSchema.parse(
  process.env.HEARTHKIT_GATE_STORAGE_ENDPOINT ?? 'http://localhost:9000',
)

/** MINIO_ROOT_USER from the repo-root compose file; the only credential that can create a gate bucket. */
export const gateStorageAccessKeyId: StorageAccessKeyId =
  storageAccessKeyIdSchema.parse('hearthkit')

/** MINIO_ROOT_PASSWORD from the repo-root compose file; the same word as the access key id, which the leak sweep accounts for. */
const gateStorageSecretAccessKey = storageSecretAccessKeySchema.parse('hearthkit')

/** An access key id MinIO has never heard of, which is what makes a 403 arrive instead of a 404. */
export const gateUnknownAccessKeyId: StorageAccessKeyId =
  storageAccessKeyIdSchema.parse('gateunknownaccesskeyid')

// Used wherever the object store never validates the credential, so no such failure can carry the
// real access key id and confuse the secret-leak sweep below.
const gatePlaceholderAccessKeyId = storageAccessKeyIdSchema.parse('gateplaceholderaccesskeyid')

/** A secret handed only to connections that must be refused; finding this string in any output proves a leak. */
export const gateSentinelSecretAccessKey = storageSecretAccessKeySchema.parse(
  'gate-secret-access-key-that-must-never-be-echoed',
)

/**
 * The secret strings a returned value may never contain. Only the sentinel is listed: the compose
 * MinIO secret is the word `hearthkit`, which every contract message prefix already starts with, so
 * it cannot act as a canary. Every gate that reaches a failure the object store decides therefore
 * signs with the sentinel, and the credentials-rejected gate — the one variant that deliberately
 * carries half of the credential pair — is one of them.
 */
export const gateSecretsThatMustNeverLeak: readonly string[] = [String(gateSentinelSecretAccessKey)]

/** A dead port on a name that resolves to two addresses, which is the AggregateError-with-empty-message shape. */
export const unreachableStorageEndpointUrl: StorageEndpointUrl =
  storageEndpointUrlSchema.parse('http://localhost:59998')

/** Every way an endpoint can fail to answer: two refused connections and one name that does not resolve. */
export const unreachableStorageEndpointUrls: readonly StorageEndpointUrl[] = [
  unreachableStorageEndpointUrl,
  storageEndpointUrlSchema.parse('http://127.0.0.1:59998'),
  storageEndpointUrlSchema.parse('http://gate-storage-host-that-never-resolves.invalid:9000'),
]

/** The connection the gates use against real MinIO; credentials come from the compose file, not the environment. */
export function gateStorageConnection(storageBucketName: StorageBucketName): StorageConnection {
  return {
    storageEndpointUrl: gateStorageEndpointUrl,
    storageBucketName,
    storageRegionName: storageRegionNameSchema.parse(defaultStorageRegionName),
    storageAccessKeyId: gateStorageAccessKeyId,
    storageSecretAccessKey: gateStorageSecretAccessKey,
  }
}

/** Real MinIO with an access key id it does not know, so every request comes back 403. */
export function rejectedCredentialsStorageConnection(
  storageBucketName: StorageBucketName,
): StorageConnection {
  return {
    ...gateStorageConnection(storageBucketName),
    storageAccessKeyId: gateUnknownAccessKeyId,
    storageSecretAccessKey: gateSentinelSecretAccessKey,
  }
}

/** Any endpoint with credentials the server never gets to validate: dead ports and the in-process 500 server. */
export function storageConnectionForEndpoint(
  storageEndpointUrl: StorageEndpointUrl,
  storageBucketName: StorageBucketName,
): StorageConnection {
  return {
    storageEndpointUrl,
    storageBucketName,
    storageRegionName: storageRegionNameSchema.parse(defaultStorageRegionName),
    storageAccessKeyId: gatePlaceholderAccessKeyId,
    storageSecretAccessKey: gateSentinelSecretAccessKey,
  }
}

/** A bucket name unique to this process and call, so parallel gate files and repeated runs never collide. */
export function uniqueGateBucketName(): StorageBucketName {
  return storageBucketNameSchema.parse(
    `gate-store-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  )
}

/** A bucket name in the legal shape that no gate ever creates, for the bucket-not-found failures. */
export function neverCreatedGateBucketName(): StorageBucketName {
  return storageBucketNameSchema.parse(
    `gate-absent-${randomUUID().replaceAll('-', '').slice(0, 12)}`,
  )
}

/** An object key unique to this process and call, under a prefix naming the gate that made it. */
export function uniqueGateObjectKey(purpose: string): StorageObjectKey {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
  return storageObjectKeySchema.parse(`gate-${purpose}/${process.pid}-${suffix}.txt`)
}

/** A listing prefix under a run-unique first segment, so one gate file's listing never sees another's keys. */
export function uniqueGateObjectKeyPrefix(purpose: string): StorageObjectKeyPrefix {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
  return storageObjectKeyPrefixSchema.parse(`gate-${purpose}-${suffix}/`)
}

/** An object key built under a prefix a gate already made unique. */
export function gateObjectKeyUnderPrefix(
  objectKeyPrefix: StorageObjectKeyPrefix,
  lastSegment: string,
): StorageObjectKey {
  return storageObjectKeySchema.parse(`${objectKeyPrefix}${lastSegment}`)
}

/** The content type the gates sign uploads with; a bare type/subtype pair, as the contract's schema demands. */
export const gateTextContentType: StorageContentType = storageContentTypeSchema.parse('text/plain')

/** The content type a client would smuggle in if the signature did not pin one; the stored-XSS hazard. */
export const gateHtmlContentType: StorageContentType = storageContentTypeSchema.parse('text/html')

/** Bytes with the gate run id inside them, so a round trip proves the exact object came back. */
export function gateObjectBytes(label: string): Uint8Array {
  return new TextEncoder().encode(`hearthkit storage gate payload ${label} ${randomUUID()}`)
}
