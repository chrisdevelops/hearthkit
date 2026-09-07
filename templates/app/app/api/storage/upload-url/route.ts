import {
  createPresignedUploadUrl,
  storageContentTypeSchema,
  storageObjectKeySchema,
} from '@hearthkit/storage'
import { requireAppStorageConnection } from '../../../../app-storage-connection.ts'

/**
 * Signs a `PUT` URL the browser uploads to directly.
 *
 * The bytes never reach this server: that is the point of `@hearthkit/storage`, and the section
 * demonstrates it rather than hiding it behind a form post. The signature covers the content type, so
 * the browser must send `requiredRequestHeaders` back verbatim or the object store rejects the PUT.
 */

/** Never prerendered: `next build` runs with an empty environment and this handler reads config. */
export const dynamic = 'force-dynamic'

/** What the storage page posts here: the file it picked, by name and content type. */
type UploadUrlRequestBody = {
  objectKey?: unknown
  contentType?: unknown
}

/** Signs an upload URL for one object key, or answers the owning package's own failure unchanged. */
export async function POST(request: Request): Promise<Response> {
  let requestBody: UploadUrlRequestBody
  try {
    requestBody = (await request.json()) as UploadUrlRequestBody
  } catch {
    return Response.json({ message: 'the request body was not JSON' }, { status: 400 })
  }

  const storageObjectKey = storageObjectKeySchema.safeParse(requestBody.objectKey)
  const contentType = storageContentTypeSchema.safeParse(requestBody.contentType)
  if (!storageObjectKey.success || !contentType.success) {
    return Response.json(
      { message: 'objectKey must be a storage object key and contentType a media type' },
      { status: 400 },
    )
  }

  const result = await createPresignedUploadUrl({
    storageConnection: requireAppStorageConnection(),
    storageObjectKey: storageObjectKey.data,
    contentType: contentType.data,
  })

  if (result.kind !== 'presigned-upload-url-created') {
    return Response.json(result, { status: 502 })
  }
  return Response.json(result, { status: 200 })
}
