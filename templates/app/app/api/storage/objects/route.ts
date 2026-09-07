import { listStoredObjects } from '@hearthkit/storage'
import { requireAppStorageConnection } from '../../../../app-storage-connection.ts'

/**
 * One page of the bucket's object keys.
 *
 * `listStoredObjects` answers one page per call and reports whether it was truncated, so a caller
 * wanting the whole bucket loops on `pageStatus`. The storage section shows the first page only,
 * which is all a demonstration needs.
 */

/** Never prerendered: `next build` runs with an empty environment and this handler reads config. */
export const dynamic = 'force-dynamic'

/** Lists the bucket, or answers the owning package's own failure unchanged. */
export async function GET(): Promise<Response> {
  const result = await listStoredObjects({ storageConnection: requireAppStorageConnection() })

  if (result.kind !== 'stored-objects-listed') {
    return Response.json(result, { status: 502 })
  }
  return Response.json(result, { status: 200 })
}
