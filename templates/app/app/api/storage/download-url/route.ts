import { createPresignedDownloadUrl, storageObjectKeySchema } from '@hearthkit/storage'
import { requireAppStorageConnection } from '../../../../app-storage-connection.ts'

/**
 * Signs a `GET` URL for one object the browser then fetches directly.
 *
 * Unlike the upload signer this one does reach the network: `@hearthkit/storage` confirms the object
 * with a HEAD before signing, which is why a key that is not there answers `storage-object-not-found`
 * rather than a URL that 404s later.
 */

/** Never prerendered: `next build` runs with an empty environment and this handler reads config. */
export const dynamic = 'force-dynamic'

/** True for a JSON object body, which is the only shape this route reads fields out of. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Signs a download URL for one object key, or answers the owning package's own failure unchanged. */
export async function POST(request: Request): Promise<Response> {
  let requestBody: unknown
  try {
    requestBody = await request.json()
  } catch {
    return Response.json({ message: 'the request body was not JSON' }, { status: 400 })
  }
  if (!isJsonObject(requestBody)) {
    return Response.json({ message: 'the request body was not a JSON object' }, { status: 400 })
  }

  const storageObjectKey = storageObjectKeySchema.safeParse(requestBody.objectKey)
  if (!storageObjectKey.success) {
    return Response.json({ message: 'objectKey must be a storage object key' }, { status: 400 })
  }

  const result = await createPresignedDownloadUrl({
    storageConnection: requireAppStorageConnection(),
    storageObjectKey: storageObjectKey.data,
  })

  if (result.kind !== 'presigned-download-url-created') {
    return Response.json(result, { status: result.kind === 'storage-object-not-found' ? 404 : 502 })
  }
  return Response.json(result, { status: 200 })
}
