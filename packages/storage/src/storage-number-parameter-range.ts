import {
  defaultPresignedUrlExpirySeconds,
  listedObjectCountSchema,
  maximumListedObjectCount,
  maximumPresignedUrlExpirySeconds,
  presignedUrlExpirySecondsSchema,
  type StorageFailure,
} from './storage-contract.ts'
import { storageParameterOutOfRangeFailure } from './storage-failure-results.ts'

/** Outcome of range-checking one caller-supplied number; a rejection carries its failure so no branch throws. */
export type StorageNumberParameterCheck =
  | { kind: 'storage-parameter-accepted'; parameterValue: number }
  | {
      kind: 'storage-parameter-rejected'
      failure: Extract<StorageFailure, { kind: 'storage-parameter-out-of-range' }>
    }

/** Checks expiresInSeconds against the Signature Version 4 window before any client is built, so a bad value fails offline. */
export function checkPresignedUrlExpirySeconds(
  expiresInSeconds: number | undefined,
): StorageNumberParameterCheck {
  const chosenValue = expiresInSeconds ?? defaultPresignedUrlExpirySeconds
  if (presignedUrlExpirySecondsSchema.safeParse(chosenValue).success) {
    return { kind: 'storage-parameter-accepted', parameterValue: chosenValue }
  }
  return {
    kind: 'storage-parameter-rejected',
    failure: storageParameterOutOfRangeFailure(
      'expiresInSeconds',
      chosenValue,
      `a whole number of seconds from 1 to ${maximumPresignedUrlExpirySeconds}`,
    ),
  }
}

/** Checks maxObjectCount against the page size S3 will honour, before any client is built, so a bad value fails offline. */
export function checkListedObjectCount(
  maxObjectCount: number | undefined,
): StorageNumberParameterCheck {
  const chosenValue = maxObjectCount ?? maximumListedObjectCount
  if (listedObjectCountSchema.safeParse(chosenValue).success) {
    return { kind: 'storage-parameter-accepted', parameterValue: chosenValue }
  }
  return {
    kind: 'storage-parameter-rejected',
    failure: storageParameterOutOfRangeFailure(
      'maxObjectCount',
      chosenValue,
      `a whole number of keys from 1 to ${maximumListedObjectCount}`,
    ),
  }
}
