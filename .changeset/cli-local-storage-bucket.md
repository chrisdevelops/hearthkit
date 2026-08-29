---
'@hearthkit/cli': minor
---

`hearthkit dev infra up` now creates a bucket in the MinIO it starts, closing a gap that failed late and quietly. A generated project installing `@hearthkit/storage` previously got a MinIO with no bucket in it: the app booted because `STORAGE_BUCKET` is only a validated string, presigning succeeded because signing never contacts the server, and the browser's PUT was the first thing to see a 404. Production has no such gap, because Phase 7's OpenTofu module creates the R2 bucket, its scoped token and its CORS rules.

Whenever the generated compose file contains `minio`, and only then, it gains a `minio-init` container that waits for MinIO to be healthy and runs `mc mb --ignore-existing`. The `minio` service gains a healthcheck so that wait means something.

**The init container stays running on purpose, and this is the least obvious thing in the change.** `docker compose up --wait` returns exit 1 when any service it started has exited, whatever that service's exit code, and `dev infra up` passes `--wait` unconditionally. A container that created the bucket and exited 0 would therefore make every `dev infra up` — fresh or repeated — report `infra-compose-failed` while the bucket was created perfectly. The entrypoint ends `tail -f /dev/null` to prevent that, a gate pins the `tail` on its own, and the emitted compose file carries a comment explaining it so a reader does not "fix" the idle container. Three alternatives were tested and rejected: stating `restart: 'no'` changes nothing, a `profiles` entry leaves a plain `docker compose up` with no bucket, and MinIO's own healthcheck cannot create the bucket because the server image's built-in alias is unauthenticated.

Failures still surface: the `&&` chain short-circuits before `tail`, so a bucket that cannot be created exits nonzero and is reported through the existing `infra-compose-failed`.

`deriveLocalStorageBucketName` is exported so `@hearthkit/create` writes the identical `<project>-uploads` string to `STORAGE_BUCKET` instead of re-deriving it and drifting. It is pure and total — every name `hearthkitProjectNameSchema` accepts yields a valid bucket name, with truncation rather than an error for long names — so it has no failure mode. `deriveHearthkitProjectName` is promoted to the public surface for the same reason: without it a caller cannot reach the project name the bucket name is built from.

A project wanting a different bucket name needs no new CLI code. `resolveLocalInfraComposeFile` never overwrites an existing compose file, so it owns its own and edits the `mc mb` line.
