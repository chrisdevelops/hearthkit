---
'@hearthkit/storage': minor
---

New `@hearthkit/storage` package: S3-compatible object storage with presigned uploads and downloads, MinIO locally and Cloudflare R2 in production. The application server never handles file bytes — it signs a URL and the browser talks to the object store directly. Four functions: `createPresignedUploadUrl`, `createPresignedDownloadUrl`, `deleteStoredObject`, `listStoredObjects`. Every call takes its connection as a parameter and destroys its client before returning, so no credentials are cached and no ambient AWS credential chain is ever consulted.

**The upload presign pins the content type into the signature, and that pin is load-bearing.** The S3 presigner adds `content-type` to its unsignable set by default, so setting `ContentType` on the command alone is decorative: a URL signed for `text/plain` accepts a `text/html` upload with 200 and stores it as `text/html`. Passing `signableHeaders: new Set(['content-type'])` is what makes the pin real, turning that mismatch into a 403. This matters because a client-chosen `text/html` in a bucket someone later makes public is a stored-XSS hazard. `createPresignedUploadUrl` returns the exact header map the client must send, so callers and gates never guess.

`createPresignedDownloadUrl` confirms the object with a HEAD before signing, which is why `storage-object-not-found` exists at all and why the returned value already carries size, content type and modified time. A HEAD response has no XML body, so a missing key and a missing bucket both arrive as a bare 404 with no S3 error code; the implementation disambiguates with a second bucket-level HEAD rather than guessing.

Failure modes are a discriminated union returned, never thrown, each with a unique literal message prefix. Three go beyond the plan entry's list and each earns its place: `storage-endpoint-unreachable` exists because the SDK surfaces a dead endpoint as an `AggregateError` with an empty message, `storage-parameter-out-of-range` because range-checking with a throwing parse would break the never-throws promise, and `storage-request-failed` as the catch-all that keeps that promise honest. Deleting a key that never existed succeeds, because S3 delete is idempotent — the contract says so rather than inventing a failure that cannot occur.

`STORAGE_REGION` joins the four environment variables the plan lists. The SDK requires a region even where the provider ignores its value, so it defaults to `auto` (what R2 documents) and stays overridable for a MinIO deployment configured with a site region.
