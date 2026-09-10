# @hearthkit/storage

## 0.2.0

### Minor Changes

- 96d5395: Trim the public entry point of `@hearthkit/storage` to a fixed allowlist of 15 values: the four functions, the env schema fragment, the failure union schema, the connection schema, the four result schemas, and the four branded schemas an app parses user input through (object key, key prefix, content type, download file name). Error-message prefixes, default and maximum constants, connection-part schemas, options schemas, per-arm success schemas, and the listing piece schemas are no longer exported from the package. Import types as before; type exports are unchanged.

### Patch Changes

- @hearthkit/config@0.2.0

## 0.1.2

### Patch Changes

- 87ed532: Every package is licensed under MIT: a `LICENSE` file ships in each tarball and the manifest carries `"license": "MIT"`.
- Updated dependencies [87ed532]
  - @hearthkit/config@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [49983c4]
  - @hearthkit/config@0.1.1

## 0.1.0

### Minor Changes

- f387155: New `@hearthkit/storage` package: S3-compatible object storage with presigned uploads and downloads, MinIO locally and Cloudflare R2 in production. The application server never handles file bytes — it signs a URL and the browser talks to the object store directly. Four functions: `createPresignedUploadUrl`, `createPresignedDownloadUrl`, `deleteStoredObject`, `listStoredObjects`. Every call takes its connection as a parameter and destroys its client before returning, so no credentials are cached and no ambient AWS credential chain is ever consulted.

  **The upload presign pins the content type into the signature, and that pin is load-bearing.** The S3 presigner adds `content-type` to its unsignable set by default, so setting `ContentType` on the command alone is decorative: a URL signed for `text/plain` accepts a `text/html` upload with 200 and stores it as `text/html`. Passing `signableHeaders: new Set(['content-type'])` is what makes the pin real, turning that mismatch into a 403. This matters because a client-chosen `text/html` in a bucket someone later makes public is a stored-XSS hazard. `createPresignedUploadUrl` returns the exact header map the client must send, so callers and gates never guess.

  `createPresignedDownloadUrl` confirms the object with a HEAD before signing, which is why `storage-object-not-found` exists at all and why the returned value already carries size, content type and modified time. A HEAD response has no XML body, so a missing key and a missing bucket both arrive as a bare 404 with no S3 error code; the implementation disambiguates with a second bucket-level HEAD rather than guessing.

  Failure modes are a discriminated union returned, never thrown, each with a unique literal message prefix. Three go beyond the plan entry's list and each earns its place: `storage-endpoint-unreachable` exists because the SDK surfaces a dead endpoint as an `AggregateError` with an empty message, `storage-parameter-out-of-range` because range-checking with a throwing parse would break the never-throws promise, and `storage-request-failed` as the catch-all that keeps that promise honest. Deleting a key that never existed succeeds, because S3 delete is idempotent — the contract says so rather than inventing a failure that cannot occur.

  `STORAGE_REGION` joins the four environment variables the plan lists. The SDK requires a region even where the provider ignores its value, so it defaults to `auto` (what R2 documents) and stays overridable for a MinIO deployment configured with a site region.

### Patch Changes

- 8fa8810: `@hearthkit/config` is now a runtime `dependency` of `observability`, `storage`, `email`, `auth` and `payments`. Each imported it from `src/` but declared it only under `devDependencies`, which resolved through workspace hoisting and would fail on the first published install.

  Node is pinned to exactly `24.20.0` in `.nvmrc` and every `engines` field, matching the plan. CI reads the version from `.nvmrc`. The template ships its own `.nvmrc` and the same pin, and `appTemplateNodeVersion` carries the value in the template contract.

  Every `@hearthkit/*` package now versions as one fixed group, so a release bumps all of them together.

  Lint is now warning-free. Two small behaviour changes came with removing unsafe casts: `asEnvVariableName` in `config` throws on a key that is not SCREAMING_SNAKE_CASE, and `createHealthRouteHandler` in `observability` throws at boot when a caller bypasses the types with a health check whose name the contract rejects, instead of running it unvalidated.

- 1bc044f: Release tooling for the first publish (completion plan step 4.1). Every manifest gains `repository` and `homepage` pointing at the public repo, and a `prepublishOnly` guard that stops a publish when the package is private, still at 0.0.0, missing `src/index.ts`, or has an `exports` or `bin` target that does not exist or is outside `files`. The guard accepts the one JavaScript module `@hearthkit/config` ships. No runtime behaviour changes.
- Updated dependencies [08c9000]
- Updated dependencies [f44ed69]
- Updated dependencies [8fa8810]
- Updated dependencies [1bc044f]
  - @hearthkit/config@0.1.0
