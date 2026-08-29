import {
  storageBucketNotFoundErrorPrefix,
  storageCredentialsRejectedErrorPrefix,
  storageEndpointUnreachableErrorPrefix,
  storageObjectNotFoundErrorPrefix,
  storageParameterOutOfRangeErrorPrefix,
  storageRequestFailedErrorPrefix,
  type StorageAccessKeyId,
  type StorageBucketName,
  type StorageEndpointUrl,
  type StorageFailure,
  type StorageObjectKey,
} from './storage-contract.ts'

/** One arm of the returned failure union, picked by kind, so every constructor below is checked against the contract shape. */
type StorageFailureOf<TKind extends StorageFailure['kind']> = Extract<
  StorageFailure,
  { kind: TKind }
>

/** Endpoint refused the connection or did not resolve; `detail` replaces the empty message the SDK's AggregateError carries. */
export function storageEndpointUnreachableFailure(
  storageEndpointUrl: StorageEndpointUrl,
  detail: string,
): StorageFailureOf<'storage-endpoint-unreachable'> {
  return {
    kind: 'storage-endpoint-unreachable',
    storageEndpointUrl,
    message: `${storageEndpointUnreachableErrorPrefix} ${storageEndpointUrl} answered nothing: ${detail}`,
  }
}

/** The bucket named by the connection is not on the object store; this package never creates one, so the operator must. */
export function storageBucketNotFoundFailure(
  storageBucketName: StorageBucketName,
): StorageFailureOf<'storage-bucket-not-found'> {
  return {
    kind: 'storage-bucket-not-found',
    storageBucketName,
    message: `${storageBucketNotFoundErrorPrefix} ${storageBucketName} is not a bucket on this object store`,
  }
}

/** Any 403; carries the public half of the credential pair only, because the secret must never reach a returned value. */
export function storageCredentialsRejectedFailure(
  storageAccessKeyId: StorageAccessKeyId,
  detail: string,
): StorageFailureOf<'storage-credentials-rejected'> {
  return {
    kind: 'storage-credentials-rejected',
    storageAccessKeyId,
    message: `${storageCredentialsRejectedErrorPrefix} ${storageAccessKeyId} may not perform this action: ${detail}`,
  }
}

/** The key is not in a bucket that does exist; only createPresignedDownloadUrl can tell the two apart, so only it returns this. */
export function storageObjectNotFoundFailure(
  storageObjectKey: StorageObjectKey,
  storageBucketName: StorageBucketName,
): StorageFailureOf<'storage-object-not-found'> {
  return {
    kind: 'storage-object-not-found',
    storageObjectKey,
    message: `${storageObjectNotFoundErrorPrefix} ${storageObjectKey} is not in bucket ${storageBucketName}`,
  }
}

/** A caller-supplied number fell outside its documented range; returned before any client is built, so it needs no service. */
export function storageParameterOutOfRangeFailure(
  parameterName: 'expiresInSeconds' | 'maxObjectCount',
  parameterValue: number,
  acceptedRange: string,
): StorageFailureOf<'storage-parameter-out-of-range'> {
  return {
    kind: 'storage-parameter-out-of-range',
    parameterName,
    parameterValue,
    message: `${storageParameterOutOfRangeErrorPrefix} ${parameterName} must be ${acceptedRange}, received ${parameterValue}`,
  }
}

/** Anything the contract does not name, including 5xx after retries; `storageErrorCode` is the S3 code or the SDK error name. */
export function storageRequestFailedFailure(
  storageErrorCode: string,
  httpStatusCode: number | undefined,
  detail: string,
): StorageFailureOf<'storage-request-failed'> {
  return {
    kind: 'storage-request-failed',
    storageErrorCode,
    httpStatusCode,
    message: `${storageRequestFailedErrorPrefix} the object store answered ${storageErrorCode}${httpStatusCode === undefined ? '' : ` with HTTP ${httpStatusCode}`}: ${detail}`,
  }
}
