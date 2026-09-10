# @hearthkit/storage — contract

## Purpose

S3-compatible object storage with presigned uploads and downloads: MinIO locally, Cloudflare R2 in production. The application server never handles file bytes. It hands out a signed URL and the browser (or any HTTP client) talks to the object store directly. R2 and MinIO both speak S3 and both accept path-style addressing, so the only difference between environments is the endpoint. The package requires the bucket to already exist — OpenTofu creates it in production — and it holds no state: every call takes its connection as a parameter and releases its client before returning, which is what keeps a future secrets manager and a second region open.

## Inputs

### Environment variables

| Name                        | Type                               | Required                             | Example                 |
| --------------------------- | ---------------------------------- | ------------------------------------ | ----------------------- |
| `STORAGE_ENDPOINT`          | http(s) URL with no path           | required when `storage` is installed | `http://localhost:9000` |
| `STORAGE_BUCKET`            | bucket name, 3 to 63 characters    | required                             | `hearthkit-uploads`     |
| `STORAGE_ACCESS_KEY_ID`     | non-empty string                   | required                             | `hearthkit`             |
| `STORAGE_SECRET_ACCESS_KEY` | non-empty string                   | required                             | `hearthkit`             |
| `STORAGE_REGION`            | lowercase name, 1 to 32 characters | optional, defaults to `auto`         | `auto`                  |

Declared in `storageEnvSchemaFragment`, composed by `@hearthkit/config` (empty string counts as unset, per config's contract). This package never reads `process.env` itself: the app composes config and passes values in, the same pattern `db` uses for `DATABASE_URL`. `STORAGE_REGION` is a fifth variable the plan entry does not list — see Decisions 1 and the questions at the bottom.

The app builds one connection value from config and passes it to every call:

```ts
const storageConnection = {
  storageEndpointUrl: config.STORAGE_ENDPOINT,
  storageBucketName: config.STORAGE_BUCKET,
  storageRegionName: config.STORAGE_REGION,
  storageAccessKeyId: config.STORAGE_ACCESS_KEY_ID,
  storageSecretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
}
```

### Shared vocabulary

- `StorageEndpointUrl` — branded; an http(s) URL whose path is empty. A bucket URL pasted into `STORAGE_ENDPOINT` by mistake fails at boot instead of at first upload.
- `StorageBucketName` — branded; lowercase letters, digits and hyphens, 3 to 63 characters. Dots are excluded on purpose: R2 rejects them and they break virtual-host TLS.
- `StorageRegionName` — branded; lowercase letters, digits and hyphens, defaulting to `auto`.
- `StorageAccessKeyId` — branded; the public half of the credential pair, so it may appear in a failure message.
- `StorageSecretAccessKey` — branded; the private half. It never appears in a returned value, a failure message or a log line.
- `StorageObjectKey` — branded; slash-separated segments of URL-safe characters (`A-Z a-z 0-9 ! _ . * ' ( ) -`), no leading, trailing or empty segment, no `.` or `..` segment, at most 1024 characters. Deliberately stricter than S3, which allows almost any byte. An app that derives a key from a user-supplied file name must parse it through `storageObjectKeySchema` first; the four functions do not re-validate a branded value at runtime.
- `StorageObjectKeyPrefix` — branded; the same character set, but it may stop mid-segment or end with a slash. It is a literal filter, not a path, and never implies a directory.
- `StorageContentType` — branded; a bare `type/subtype` pair. Parameters such as `; charset=utf-8` are not accepted (see Decisions 6).
- `StorageDownloadFileName` — branded; letters, digits, spaces, `.`, `_`, `-`, `(`, `)`, starting with a letter or digit, at most 255 characters. The character set is what makes it safe inside a quoted `Content-Disposition` header.
- `StorageContinuationToken` — branded; the opaque pagination token from a truncated listing. Never parse or construct one.
- `PresignedStorageUrl` — branded; a URL carrying the signature and expiry in its query string. It is a bearer credential for one object and one method, so treat it as a secret.
- `StorageConnection` — the five values above that name one bucket: `storageEndpointUrl`, `storageBucketName`, `storageRegionName`, `storageAccessKeyId`, `storageSecretAccessKey`.

### Public functions

All four are async and return their failures as values. None throws for a contract failure mode. Every caller-supplied number (`expiresInSeconds`, `maxObjectCount`) is range-checked **before** any network call, so a bad parameter fails the same way whether or not the object store is reachable.

- `createPresignedUploadUrl({ storageConnection, storageObjectKey, contentType, expiresInSeconds? })` — signs a `PUT` URL. Purely local: it contacts nothing, so it cannot detect a missing bucket or rejected credentials; those surface as a 404 or 403 on the client's own `PUT`. `contentType` is signed into the URL, so the client must send exactly that header (see Decisions 6). `expiresInSeconds` defaults to 900 and must be 1 to 604800.
- `createPresignedDownloadUrl({ storageConnection, storageObjectKey, downloadFileName?, expiresInSeconds? })` — confirms the object exists with a `HEAD`, then signs a `GET` URL. `downloadFileName` sets `ResponseContentDisposition` to `attachment; filename="<downloadFileName>"`, so the browser saves the file under that name without the bytes passing through the app. Omit it and the browser falls back to the key's last segment. Same expiry rules as upload.
- `deleteStoredObject({ storageConnection, storageObjectKey })` — deletes one key. Idempotent: deleting a key that never existed succeeds (see Decisions 2).
- `listStoredObjects({ storageConnection, objectKeyPrefix?, maxObjectCount?, continuationToken? })` — one page of keys, optionally filtered by prefix. `maxObjectCount` defaults to 1000 and must be 1 to 1000; `continuationToken` is the token from a previous truncated page.

## Outputs

- `createPresignedUploadUrl` returns `{ kind: 'presigned-upload-url-created', presignedUploadUrl, storageObjectKey, requiredRequestHeaders, expiresAt }` or a failure. `requiredRequestHeaders` is a lowercase header map that the client must send verbatim — today always exactly `{ 'content-type': <contentType> }`. A `PUT` that sends a different value is rejected by the object store with 403, and a `PUT` that omits the header entirely is rejected with 400; either way the upload never lands, which is the point of pinning it. `expiresAt` is the wall-clock time the URL stops working.
- `createPresignedDownloadUrl` returns `{ kind: 'presigned-download-url-created', presignedDownloadUrl, storageObjectKey, objectByteCount, objectContentType?, objectLastModifiedAt, expiresAt }` or a failure. The three metadata fields come from the `HEAD` that already had to happen, so an app rendering a file list does not need a second call. `objectContentType` is whatever the object store reports and is an unvalidated string, because objects can arrive from tools that store a content type this package would not accept.
- `deleteStoredObject` returns `{ kind: 'stored-object-deleted', storageObjectKey }` or a failure. Success does not mean the key existed.
- `listStoredObjects` returns `{ kind: 'stored-objects-listed', storedObjects, pageStatus }` or a failure. `storedObjects` is an array of `{ storageObjectKey, objectByteCount, objectLastModifiedAt }`; an empty array means nothing matched, which is not a failure. `pageStatus` is a nested discriminated union, `{ kind: 'stored-objects-page-complete' }` or `{ kind: 'stored-objects-page-truncated', nextContinuationToken }`, so a truncation flag and a token can never disagree.

### Package entry point

`src/index.ts` is the package entry, a thin named re-export (no `export *`). Its value exports are a fixed allowlist of exactly these fifteen, and nothing else:

1. `createPresignedUploadUrl`
2. `createPresignedDownloadUrl`
3. `deleteStoredObject`
4. `listStoredObjects`
5. `storageEnvSchemaFragment`
6. `storageFailureSchema`
7. `storageConnectionSchema` — the input every function takes; an app builds it from config
8. `createPresignedUploadUrlResultSchema`
9. `createPresignedDownloadUrlResultSchema`
10. `deleteStoredObjectResultSchema`
11. `listStoredObjectsResultSchema`
12. `storageObjectKeySchema`
13. `storageObjectKeyPrefixSchema`
14. `storageContentTypeSchema`
15. `storageDownloadFileNameSchema`

Type exports are not counted and stay: the branded types under Shared vocabulary, `StorageConnection`, `StorageFailure`, `StoredObjectSummary`, `StoredObjectsPageStatus`, and each function's options, result and function types.

Every other value in `storage-contract.ts` is internal: the six message-prefix constants, `defaultStorageRegionName`, `defaultPresignedUrlExpirySeconds`, `maximumPresignedUrlExpirySeconds`, `maximumListedObjectCount`, the connection-part schemas (`storageEndpointUrlSchema`, `storageBucketNameSchema`, `storageRegionNameSchema`, `storageAccessKeyIdSchema`, `storageSecretAccessKeySchema`), `storageContinuationTokenSchema`, `presignedStorageUrlSchema`, `presignedUrlExpirySecondsSchema`, `listedObjectCountSchema`, the four options schemas, `storedObjectSummarySchema` and `storedObjectsPageStatusSchema`. The implementation and this package's own gates may import them from `storage-contract.ts` directly, but they are not part of the public surface and may change without a changeset. The four per-arm success schemas are module-private inside `storage-contract.ts` and are reachable only through the result unions; a caller that has narrowed a result on `kind` already holds the validated shape.

## Failure modes

All failures are one discriminated union, `StorageFailure`, on `kind`. Every variant carries a `message` starting with its unique literal prefix. In the last column, "upload" and "download" mean the two presign functions.

| `kind`                           | When                                                       | Message prefix                              | Returned by            |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------- | ---------------------- |
| `storage-endpoint-unreachable`   | Endpoint refused the connection or did not resolve         | `hearthkit storage endpoint unreachable:`   | download, delete, list |
| `storage-bucket-not-found`       | Bucket in the connection does not exist                    | `hearthkit storage bucket not found:`       | download, delete, list |
| `storage-credentials-rejected`   | Any 403: key unknown, signature bad, or action not allowed | `hearthkit storage credentials rejected:`   | download, delete, list |
| `storage-object-not-found`       | Key does not exist in the bucket                           | `hearthkit storage object not found:`       | download               |
| `storage-parameter-out-of-range` | `expiresInSeconds` or `maxObjectCount` out of range        | `hearthkit storage parameter out of range:` | upload, download, list |
| `storage-request-failed`         | Any other S3 error, including 5xx after retries            | `hearthkit storage request failed:`         | download, delete, list |

Notes the gates and the implementation both depend on:

- `storage-endpoint-unreachable` carries `storageEndpointUrl` and its message names that URL. This exists because the AWS SDK surfaces an unreachable endpoint as an `AggregateError` with an **empty** message, which tells a maintainer nothing. Wrapping it is the whole point of the variant.
- `storage-credentials-rejected` carries `storageAccessKeyId`, never the secret. It covers `InvalidAccessKeyId`, `SignatureDoesNotMatch`, `AccessDenied` and any other 403, because from the caller's side they are one thing: the credentials given cannot do this.
- `storage-object-not-found` is reachable only from `createPresignedDownloadUrl`, which is why that function does a `HEAD` at all. A `HEAD` response has no XML body, so the S3 error code is not available and a missing bucket and a missing key both arrive as a bare 404. The implementation must disambiguate on that path with a bucket-level `HEAD`: bucket absent gives `storage-bucket-not-found`, bucket present gives `storage-object-not-found`. Without that second call the two failures are indistinguishable.
- `storage-parameter-out-of-range` carries `parameterName` (`expiresInSeconds` or `maxObjectCount`) and the offending `parameterValue`, and names both in the message after the prefix. It needs no service, so it is gateable offline.
- `storage-request-failed` carries `storageErrorCode` (the S3 error code, or the SDK error name when no code is available) and `httpStatusCode` when there is one. It exists so no error is silently mis-mapped into a nicer-sounding variant and no call ever throws instead of returning.
- Requests use the AWS SDK's default retry strategy (standard mode, up to three attempts), so an unreachable endpoint and a 5xx both take a few hundred milliseconds of backoff before the failure comes back.

Explicit non-failures the gates should also cover: deleting a key that never existed returns `stored-object-deleted`; listing a prefix that matches nothing returns `stored-objects-listed` with an empty array; presigning an upload for a bucket that does not exist succeeds, because that function never contacts the server.

## Dependencies

- Packages: `@hearthkit/config` as a `workspace:*` runtime dependency (`dependencies`, by the completion plan step 1 hygiene decision). This package's own `src` outside the gates does not import it — it contributes `storageEnvSchemaFragment` for config to compose — but the gates compose the env fragment through config.
- Services for gates: MinIO from the repo-root `docker-compose.yml` (`http://localhost:9000`, `hearthkit` / `hearthkit`, image `minio/minio:RELEASE.2025-09-07T16-13-09Z`). The `storage-request-failed` gate needs no container: an in-process `node:http` server that answers 500 is enough, the same technique the observability gates use. The `storage-endpoint-unreachable` gate points the connection at a local port where nothing is listening.
- Buckets for gates: the gates create their own with the SDK's `CreateBucketCommand` in a fixture, one uniquely named bucket per run, and delete its objects and then the bucket afterwards. This package creates no buckets (see Decisions 5), and a name that was never created is what the `storage-bucket-not-found` gate uses.
- Runtime libraries (implementor adds, exact pins): `@aws-sdk/client-s3@3.1121.0`, `@aws-sdk/s3-request-presigner@3.1121.0`, `zod@4.4.3`.
- Dev dependencies (implementor adds, exact pins): `vitest@4.1.11`, `typescript@7.0.2`, `@types/node@24.13.3`. `@hearthkit/config` is not a devDependency; it sits under `dependencies` as `workspace:*` (see the Packages line above).
- Client configuration the implementation must use: `forcePathStyle: true` (required by MinIO, accepted by R2), `endpoint` from the connection, `region` from the connection, and explicit static `credentials` from the connection, so no ambient AWS credential provider chain is ever consulted. The client must not outlive the call that created it: no module-level client, no pooled socket left open, so a CLI process or a Vitest run is never held open by this package and no credential is cached across calls.

## Out of scope

- **Creating, configuring or deleting buckets.** Production buckets, their CORS rules and their scoped token come from the OpenTofu module in Phase 7 (plan section 8.2). Because `contentType` is signed, that CORS policy must list `Content-Type` in `AllowedHeaders` or browser uploads fail preflight.
- **Multipart upload.** A single presigned `PUT` is capped at 5 GB on S3 and 5 GiB on R2. Adding multipart later is an additive pair of functions and changes nothing here; the deferred VPS backup job (plan section 8.1, and `db`'s contract) uploads one archive with one `PUT` and stays under that ceiling.
- **Upload size limits.** A presigned `PUT` cannot express a size range; only the signed headers constrain it. Enforcing a maximum later means either checking size after the upload and deleting what is too big, or a presigned POST policy where the provider supports one. Nothing here blocks either, and neither was verified against R2.
- **Choosing object keys.** The app owns its key layout. That is what keeps per-project and per-preview separation open: a preview environment is a key prefix or a bucket name, both of which are already parameters.
- **Public buckets, public URLs and CDN links.** Every URL this package produces expires. A permanently public object is a bucket policy question, not a package question.
- **Copying, moving, tagging, versioning and lifecycle rules.** Not in the plan entry; each is additive.
- **Bulk delete.** `deleteStoredObject` takes one key. `DeleteObjects` is additive if a caller ever needs it.
- **Endpoints with a base path** (`https://example.com/s3`). `STORAGE_ENDPOINT` must be an origin. Relaxing this later is additive and breaks nothing.
- **Reading `process.env` or owning `NODE_ENV`.** Config owns both. Because credentials arrive as call parameters and no client is cached between calls, the deferred secrets manager only has to repopulate the environment before the next call, and the deferred second VPS or region is only a different `StorageConnection` — neither is blocked by anything here.

## Decisions

The decisions the loop asked to be settled here rather than left to the implementor.

1. **Region is a fifth environment variable, `STORAGE_REGION`, optional, defaulting to `auto`.** The SDK requires a region even where the provider ignores it. A fixed constant would bake one provider's answer into shared code; a defaulted variable costs one line in `.env.example`, keeps the plan's four variables working unchanged, and follows guiding rule 4 (opinions live in scaffold flags and environment variables). It also leaves room for the cases that do care: MinIO configured with a site region, or any S3 provider that validates the value.
2. **`deleteStoredObject` is idempotent and `storage-object-not-found` belongs to `createPresignedDownloadUrl` alone.** S3 delete succeeds for a key that never existed. Making delete `HEAD` first would buy a failure mode by breaking retry semantics — a retried delete after a successful one would start failing — and would still race. Instead the download presign, which must confirm the object anyway to avoid handing a browser a URL that 404s, is where the failure lives. That also makes the plan's "delete it, confirm it is gone" gate direct: the confirmation is a download presign returning `storage-object-not-found`.
3. **An unreachable endpoint becomes `storage-endpoint-unreachable`, carrying the endpoint URL.** The raw error is an `AggregateError` whose message is empty, so passing it through would produce a failure nobody can act on. This variant is not in the plan entry's list of three; the plan's list is incomplete rather than restrictive.
4. **Presigned URLs default to 900 seconds and accept 1 to 604800.** 900 matches the SDK default. 604800 is seven days, the Signature Version 4 ceiling: above it the signer rejects with its own message, so the contract checks the range first and returns `storage-parameter-out-of-range` instead. Callers override per call. Expiry is enforced by the server, not advisory — an expired URL comes back 403 — and it is checked when the request starts, so a transfer already in flight is not cut off.
5. **This package requires a bucket to exist and never creates one.** Production buckets come from the OpenTofu module, which already names one per project. Gates create and destroy their own bucket with the SDK. That leaves one gap worth naming: a developer running `hearthkit dev` with `storage` installed gets a MinIO container with no bucket in it. Filling that gap belongs to the `cli` loop, not here — see the questions below.
6. **`contentType` is required and pinned into the upload signature; there is no size constraint.** The S3 presigner adds `content-type` to its unsignable set by default, so setting `ContentType` on the command alone would be decorative — the client could send anything. The implementation must therefore pass `signableHeaders: new Set(['content-type'])` to `getSignedUrl` as well, which is what makes the pin real, and return the header in `requiredRequestHeaders` so callers and gates do not guess. The cost is that a browser must set the header explicitly and the bucket's CORS policy must allow it. The benefit is that the server decides what type is stored, which is the only content constraint a presigned `PUT` can carry: a client-chosen `text/html` in a bucket someone later makes public is a stored-XSS hazard. A content-length range is not expressible in a presigned `PUT` at all, so size is out of scope above.
7. **The entry point is a fixed allowlist, not "everything the contract module exports".** Completion plan step 5 policy: an app imports the functions, the env fragment, the failure union, the connection input schema, the result schemas and the branded schemas it must construct to call a function. Gates and the implementation take message prefixes, defaults, maximums, range schemas and per-arm shapes from `storage-contract.ts` directly, so those never need a public name. A smaller surface means fewer symbols an app can couple to and fewer changesets for internal renames.

## Verified

Checked 2026-08-29 against current docs.

- `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` are both 3.1121.0, both requiring Node >= 20 — https://registry.npmjs.org/@aws-sdk/client-s3/latest and https://registry.npmjs.org/@aws-sdk/s3-request-presigner/latest
- `forcePathStyle` is a real S3 client option, declared in `ClientInputEndpointParameters` alongside `endpoint` and `region` — https://raw.githubusercontent.com/aws/aws-sdk-js-v3/main/clients/client-s3/src/endpoint/EndpointParameters.ts
- R2's S3 API uses region `auto` ("Required by SDK but not used by R2"), and an empty value or `us-east-1` aliases to it — https://developers.cloudflare.com/r2/api/s3/api/ and https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/
- R2 supported path-based routing first and added virtual-hosted style on 2022-05-16 as an alternative, so `forcePathStyle: true` serves R2 as well as MinIO — https://developers.cloudflare.com/r2/platform/release-notes/
- A presigned URL made with SigV4 may last up to 7 days; S3 checks expiry when the request starts, so a transfer that began in time completes — https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- R2 states the same window as "1 second to 7 days (604,800 seconds)" — https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- `MAX_PRESIGNED_TTL` is `60 * 60 * 24 * 7`, and `SignatureV4.presign` rejects a longer `expiresIn` with "Signature version 4 presigned URLs must have an expiration date less than one week in the future" — https://raw.githubusercontent.com/smithy-lang/smithy-typescript/main/packages/signature-v4/src/constants.ts and https://raw.githubusercontent.com/smithy-lang/smithy-typescript/main/packages/signature-v4/src/SignatureV4.ts
- `S3RequestPresigner.presign` defaults `expiresIn` to 900 and its `prepareRequest` calls `unsignableHeaders.add("content-type")`, so pinning a content type requires passing `signableHeaders` — https://raw.githubusercontent.com/aws/aws-sdk-js-v3/main/packages/s3-request-presigner/src/presigner.ts
- `getCanonicalHeaders` skips a header that is unsignable unless `signableHeaders` names it, which is why that override works — https://raw.githubusercontent.com/smithy-lang/smithy-typescript/main/packages/signature-v4/src/getCanonicalHeaders.ts
- R2's CORS guidance for browser uploads through presigned URLs lists `Content-Type` in `AllowedHeaders` — https://developers.cloudflare.com/r2/buckets/cors/
- `ListObjectsV2` returns at most 1000 keys, sends `NextContinuationToken` only when `IsTruncated` is true, filters on `Prefix`, and answers a missing bucket with `NoSuchBucket` / 404 — https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
- A single `PUT` uploads at most 5 GB on S3; R2 caps a single-part upload at 5 GiB — https://docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html and https://developers.cloudflare.com/r2/platform/limits/

Established by the orchestrator's spike against real MinIO on 2026-08-29 and built on rather than re-derived here: presigned `PUT` accepted from plain `fetch`; presigned `GET` round-tripping bytes; `forcePathStyle` required, giving `http://localhost:9000/<bucket>/<key>`; `ResponseContentDisposition` surviving presigning; list honouring `Prefix` and `MaxKeys` and returning a continuation token; an expired URL rejected with 403; `NoSuchBucket` / 404, `InvalidAccessKeyId` / 403 and `NotFound` / 404 for missing bucket, bad credentials and missing key; delete of a never-existing key succeeding; an unreachable endpoint throwing an `AggregateError` with an empty message.

## Questions for the orchestrator

Defaults were chosen so the gate-writer is not blocked; veto any of these and the contract will be revised.

1. **`STORAGE_REGION` adds a fifth variable to plan section 4.5.** Decisions 1 gives the reasoning. Confirm, or say the word and it becomes a fixed `auto` constant with no variable — in which case an operator whose MinIO validates a site region has no way out without a package change.
2. **`createPresignedDownloadUrl` performs a `HEAD` (and a second bucket-level `HEAD` on the 404 path).** That is what makes the plan's third failure mode real and what supplies the returned metadata, but it costs a round trip on every download URL and adds a time-of-check race. The alternative is a purely local download presign with no `storage-object-not-found` anywhere in the package. Confirm the round trip.
3. **Local buckets have no owner.** `hearthkit dev infra up` starts MinIO with no bucket in it, so a scaffolded app's first upload fails until someone creates one by hand. The gates work around this by creating their own. A fix belongs in the `cli` loop (a `mc mb` step, an init container in the generated compose, or a `hearthkit storage init` command) and should be recorded as an open item rather than smuggled into this package.
4. **Two extra failure modes beyond the plan's three**, both argued in Decisions 3 and 4: `storage-endpoint-unreachable` and `storage-parameter-out-of-range`, plus the `storage-request-failed` catch-all that keeps the "never throws" promise honest. Confirm the widened union.
5. **Step 5 follow-ups outside this agent's ownership.** `src/index.ts` still re-exports the four per-arm success schemas that are now module-private, so it will not compile until the implementor trims it to the allowlist above; `storage-env-schema-fragment.test.ts` lists those four names in its minimum-export list, so the gate-writer must drop them there. Neither file may be edited by the contract-author.
