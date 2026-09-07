import type { StorageConnection } from '@hearthkit/storage'
import { requireAppRuntimeConfig } from './app-runtime-config.ts'

/**
 * The storage connection every `/api/storage/*` handler passes to `@hearthkit/storage`.
 *
 * Built per call rather than cached at module scope, for the same reason the section's route
 * handlers export `dynamic = 'force-dynamic'`: `next build` runs with an empty environment, and a
 * connection assembled while a route was being prerendered would fail the build with a
 * missing-variable message instead of at the first request.
 *
 * Nothing here caches a credential. `@hearthkit/storage` takes the connection on every call so that
 * a rotated key takes effect on the next request rather than on the next deploy.
 */
export function requireAppStorageConnection(): StorageConnection {
  const appRuntimeConfig = requireAppRuntimeConfig()

  return {
    storageEndpointUrl: appRuntimeConfig.STORAGE_ENDPOINT,
    storageBucketName: appRuntimeConfig.STORAGE_BUCKET,
    storageRegionName: appRuntimeConfig.STORAGE_REGION,
    storageAccessKeyId: appRuntimeConfig.STORAGE_ACCESS_KEY_ID,
    storageSecretAccessKey: appRuntimeConfig.STORAGE_SECRET_ACCESS_KEY,
  }
}
