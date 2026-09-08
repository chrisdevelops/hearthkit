import { createHash, createHmac } from 'node:crypto'

/** The credentials the generated compose file gives both the minio service and the bucket init container. */
const minioAccessKeyId = 'hearthkit'
const minioSecretAccessKey = 'hearthkit'

/** MinIO answers to the S3 default region unless it is configured otherwise, and the generated file does not configure it. */
const minioSignatureRegion = 'us-east-1'

/** How long a presigned gate URL stays valid; long enough for one request, short enough to be worthless if it leaked into a log. */
const presignedUrlLifetimeSeconds = 300

/** What one signed S3 request over the wire produced; the status is the whole point, because a missing bucket answers 404. */
export type MinioS3Response = {
  status: number
  body: string
}

/** One HMAC-SHA256 round of the SigV4 signing key derivation. */
function signWithHmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/** Lowercase hex SHA-256, the hash SigV4 uses for the canonical request. */
function hashToHex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

/** Percent-encodes one path segment the way SigV4 canonical URIs require, which is stricter than encodeURIComponent alone. */
function encodeS3PathSegment(pathSegment: string): string {
  return encodeURIComponent(pathSegment).replaceAll(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** The X-Amz-Date stamp SigV4 wants: basic-format UTC, no separators and no milliseconds. */
function amazonDateStamp(now: Date): string {
  return now
    .toISOString()
    .replaceAll(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/**
 * Builds a SigV4 presigned URL for one object in the local MinIO. Signed by hand from node:crypto so
 * the gate needs no AWS SDK dependency in a package whose contract lists none, and so the request
 * that reaches MinIO is a real S3 API call rather than an mc invocation inside the docker network.
 */
export function presignMinioObjectUrl(options: {
  httpMethod: 'PUT' | 'GET'
  s3HostPort: number
  bucketName: string
  objectKey: string
}): string {
  const requestHost = `127.0.0.1:${options.s3HostPort}`
  const requestDateStamp = amazonDateStamp(new Date())
  const requestDay = requestDateStamp.slice(0, 8)
  const credentialScope = `${requestDay}/${minioSignatureRegion}/s3/aws4_request`
  const canonicalUri = `/${encodeS3PathSegment(options.bucketName)}/${encodeS3PathSegment(options.objectKey)}`

  const queryParameters: readonly (readonly [string, string])[] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${minioAccessKeyId}/${credentialScope}`],
    ['X-Amz-Date', requestDateStamp],
    ['X-Amz-Expires', String(presignedUrlLifetimeSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
  const canonicalQueryString = queryParameters
    .toSorted(([leftName], [rightName]) => (leftName < rightName ? -1 : 1))
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('&')

  const canonicalRequest = [
    options.httpMethod,
    canonicalUri,
    canonicalQueryString,
    `host:${requestHost}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    requestDateStamp,
    credentialScope,
    hashToHex(canonicalRequest),
  ].join('\n')

  const signingKey = signWithHmac(
    signWithHmac(
      signWithHmac(signWithHmac(`AWS4${minioSecretAccessKey}`, requestDay), minioSignatureRegion),
      's3',
    ),
    'aws4_request',
  )
  const requestSignature = createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex')

  return `http://${requestHost}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${requestSignature}`
}

/** Uploads one object over the real S3 API; a bucket that was never created answers 404 rather than throwing. */
export async function putMinioObjectWithSignedUrl(options: {
  s3HostPort: number
  bucketName: string
  objectKey: string
  objectBody: string
}): Promise<MinioS3Response> {
  const response = await fetch(presignMinioObjectUrl({ httpMethod: 'PUT', ...options }), {
    method: 'PUT',
    body: options.objectBody,
  })
  return { status: response.status, body: await response.text() }
}

/** Reads one object back over the real S3 API, so the gate proves the upload landed rather than only that it was accepted. */
export async function getMinioObjectWithSignedUrl(options: {
  s3HostPort: number
  bucketName: string
  objectKey: string
}): Promise<MinioS3Response> {
  const response = await fetch(presignMinioObjectUrl({ httpMethod: 'GET', ...options }), {
    method: 'GET',
  })
  return { status: response.status, body: await response.text() }
}

/**
 * Polls the S3 endpoint until MinIO answers at all. The healthcheck compose waits on says the server
 * is ready inside the network; this says the published host port is forwarding, which is a separate
 * question and the one a host-side request depends on.
 */
export async function waitForMinioS3Endpoint(options: {
  s3HostPort: number
  attemptLimit?: number
}): Promise<void> {
  const attemptLimit = options.attemptLimit ?? 60
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const reached = await fetch(`http://127.0.0.1:${options.s3HostPort}/minio/health/live`).then(
      (response) => response.status > 0,
      () => false,
    )
    if (reached) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `gate could not reach the MinIO S3 endpoint on host port ${options.s3HostPort} after ${attemptLimit} attempts`,
  )
}
