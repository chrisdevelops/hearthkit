# @hearthkit/cli

## 0.2.0

### Patch Changes

- @hearthkit/config@0.2.0
  - @hearthkit/db@0.2.0
  - @hearthkit/payments@0.2.0

## 0.1.2

### Patch Changes

- 87ed532: Every package is licensed under MIT: a `LICENSE` file ships in each tarball and the manifest carries `"license": "MIT"`.
- Updated dependencies [87ed532]
  - @hearthkit/config@0.1.2
  - @hearthkit/db@0.1.2
  - @hearthkit/payments@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [49983c4]
  - @hearthkit/config@0.1.1
  - @hearthkit/db@0.1.1
  - @hearthkit/payments@0.1.1

## 0.1.0

### Minor Changes

- c0ecb6d: `hearthkit dev infra up` now starts Postgres and Mailpit for a project that depends on `@hearthkit/auth`. It previously started **nothing** for such a project and reported success with an empty service list, so auth failed at runtime with a connection error that pointed nowhere near the manifest.

  The cause was a gap between two things that were each individually reasonable. The package-to-service map had no `@hearthkit/auth` entry, and `readInfraServicesFromDependencies` reads a project's **direct** `dependencies` and `devDependencies` only — it never walks transitive ones. So `@hearthkit/auth` depending on `@hearthkit/db` and `@hearthkit/email` internally did not help: neither name appeared in the project's own manifest.

  **Breaking:** `localInfraServiceByHearthkitPackage` is renamed to `localInfraServicesByHearthkitPackage` and its values become lists, because `@hearthkit/auth` needs two services where every other package needs one:

  ```ts
  export const localInfraServicesByHearthkitPackage = {
    '@hearthkit/db': ['postgres'],
    '@hearthkit/storage': ['minio'],
    '@hearthkit/email': ['mailpit'],
    '@hearthkit/auth': ['postgres', 'mailpit'],
  } as const satisfies Record<string, readonly LocalInfraServiceName[]>
  ```

  Both changes land in one edit per call site: nothing compiles through `'postgres'` becoming `['postgres']`, so a consumer updating the shape updates the identifier on the same line. The rename was taken deliberately rather than kept singular — a public name saying _one service per package_ when it means several is a permanent inaccuracy, and the doc comment that would have compensated for it is weaker than a name that does not need compensating.

  Two properties are unchanged and now stated in the contract: the derived set collapses duplicates, so a project listing both `@hearthkit/auth` and `@hearthkit/db` gets `postgres` once; and emission order comes from `localInfraServiceNameSchema.options`, never from the map's key order or the manifest's. Both consumers re-normalize independently, which makes those guarantees impossible to violate observably — so the redundant normalization is intentional and must not be simplified away on the grounds that the derivation already guarantees it.

  Three gates added, 39 to 42. One drives `dev infra up` end to end from a manifest listing only `@hearthkit/auth` and asserts both containers start; the other two need no containers.

  This mapping is deliberately robust to what Phase 6's `create` does. If `create` writes `@hearthkit/db` and `@hearthkit/email` into a project that selects `auth`, the `auth` entry is redundant and harmless because duplicates collapse. If it does not, auth still works. `docs/PLAN.md` section 6's table has no `auth` row and needs one.

- 96b5271: `hearthkit dev infra up` now creates a bucket in the MinIO it starts, closing a gap that failed late and quietly. A generated project installing `@hearthkit/storage` previously got a MinIO with no bucket in it: the app booted because `STORAGE_BUCKET` is only a validated string, presigning succeeded because signing never contacts the server, and the browser's PUT was the first thing to see a 404. Production has no such gap, because Phase 7's OpenTofu module creates the R2 bucket, its scoped token and its CORS rules.

  Whenever the generated compose file contains `minio`, and only then, it gains a `minio-init` container that waits for MinIO to be healthy and runs `mc mb --ignore-existing`. The `minio` service gains a healthcheck so that wait means something.

  **The init container stays running on purpose, and this is the least obvious thing in the change.** `docker compose up --wait` returns exit 1 when any service it started has exited, whatever that service's exit code, and `dev infra up` passes `--wait` unconditionally. A container that created the bucket and exited 0 would therefore make every `dev infra up` — fresh or repeated — report `infra-compose-failed` while the bucket was created perfectly. The entrypoint ends `tail -f /dev/null` to prevent that, a gate pins the `tail` on its own, and the emitted compose file carries a comment explaining it so a reader does not "fix" the idle container. Three alternatives were tested and rejected: stating `restart: 'no'` changes nothing, a `profiles` entry leaves a plain `docker compose up` with no bucket, and MinIO's own healthcheck cannot create the bucket because the server image's built-in alias is unauthenticated.

  Failures still surface: the `&&` chain short-circuits before `tail`, so a bucket that cannot be created exits nonzero and is reported through the existing `infra-compose-failed`.

  `deriveLocalStorageBucketName` is exported so `@hearthkit/create` writes the identical `<project>-uploads` string to `STORAGE_BUCKET` instead of re-deriving it and drifting. It is pure and total — every name `hearthkitProjectNameSchema` accepts yields a valid bucket name, with truncation rather than an error for long names — so it has no failure mode. `deriveHearthkitProjectName` is promoted to the public surface for the same reason: without it a caller cannot reach the project name the bucket name is built from.

  A project wanting a different bucket name needs no new CLI code. `resolveLocalInfraComposeFile` never overwrites an existing compose file, so it owns its own and edits the `mc mb` line.

- 7fd2b2d: New package: the `hearthkit` bin (Phase 2 scope). `db create|drop|migrate|backup|restore` wrap `@hearthkit/db` and map results to exit codes, one machine-readable stdout line, and prefixed stderr messages; `db create` prints the connection string once and persists nothing. `dev infra up|down` uses an existing `docker-compose.yml` or generates one from the project's hearthkit dependencies (Postgres 17 / MinIO / Mailpit, pinned images); `dev` brings infra up then runs the project's `next dev`, propagating its exit code. `doctor` runs eight environment checks with a `--json` report. All failure modes are a returned discriminated union, never thrown; the bin runs the workspace's TypeScript source directly on Node 24 via a registered resolver hook.

### Patch Changes

- 08c9000: Node 24 refuses to strip types from `.ts` files under `node_modules`, so an installed `hearthkit` bin was unrunnable in a generated project. `@hearthkit/config` now ships one JavaScript module, exported as `@hearthkit/config/register-node-modules-type-stripping`, that registers a module load hook stripping types for exactly that set; it is a no-op inside the workspace where packages resolve to real paths. The `hearthkit` bin is now a small JavaScript entry that imports the hook and then the TypeScript bin. The `create` bin and the template's Playwright `test:e2e` script preload the same module. It lives in `config` rather than `cli` because every project depends on `config`, while an empty package selection prunes `cli`.
- 08c9000: `hearthkit payments sync [--catalog <path>]` pushes a project's `payments-catalog.ts` to Stripe test mode through `syncPaymentsCatalog` from `@hearthkit/payments`, and prints one `hearthkit payments sync complete:` line with created, replaced and unchanged counts. New failure kinds: `cli-payments-catalog-not-found`, `cli-payments-catalog-unloadable`, and `cli-payments-sync-failed` wrapping the payments failure verbatim. `@hearthkit/payments` is now a runtime dependency.
- 6a8dbb5: Add `@hearthkit/email`: send transactional email from React Email templates through a swappable
  transport, Mailpit over SMTP locally and Resend in production, chosen by one environment variable.

  One template produces both parts of every message, so the HTML and plain text bodies cannot drift
  apart. Ships a magic-link and a password-reset template for `@hearthkit/auth` to send. Every call
  returns its failure as a value rather than throwing, and credentials never appear in a failure, a
  log line, or a send result.

  The `cli` change is test-only: the repo's new Mailpit holds host ports 1025 and 8025, so the
  generated-compose gates remap their published ports the way they already do for MinIO. Fixing that
  uncovered a real defect in the existing MinIO guard, which used a substring check and so accepted
  `19000:9000` as if it were `9000:9000` and silently rewrote it into a nonsense port. Both guards now
  match on digit boundaries.

- 8fa8810: `@hearthkit/config` is now a runtime `dependency` of `observability`, `storage`, `email`, `auth` and `payments`. Each imported it from `src/` but declared it only under `devDependencies`, which resolved through workspace hoisting and would fail on the first published install.

  Node is pinned to exactly `24.20.0` in `.nvmrc` and every `engines` field, matching the plan. CI reads the version from `.nvmrc`. The template ships its own `.nvmrc` and the same pin, and `appTemplateNodeVersion` carries the value in the template contract.

  Every `@hearthkit/*` package now versions as one fixed group, so a release bumps all of them together.

  Lint is now warning-free. Two small behaviour changes came with removing unsafe casts: `asEnvVariableName` in `config` throws on a key that is not SCREAMING_SNAKE_CASE, and `createHealthRouteHandler` in `observability` throws at boot when a caller bypasses the types with a health check whose name the contract rejects, instead of running it unvalidated.

- 1bc044f: Release tooling for the first publish (completion plan step 4.1). Every manifest gains `repository` and `homepage` pointing at the public repo, and a `prepublishOnly` guard that stops a publish when the package is private, still at 0.0.0, missing `src/index.ts`, or has an `exports` or `bin` target that does not exist or is outside `files`. The guard accepts the one JavaScript module `@hearthkit/config` ships. No runtime behaviour changes.
- Updated dependencies [08c9000]
- Updated dependencies [f44ed69]
- Updated dependencies [08c9000]
- Updated dependencies [886785b]
- Updated dependencies [8fa8810]
- Updated dependencies [6b88e0f]
- Updated dependencies [1bc044f]
  - @hearthkit/config@0.1.0
  - @hearthkit/db@0.1.0
  - @hearthkit/payments@0.1.0
