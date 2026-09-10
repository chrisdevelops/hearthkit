# @hearthkit/auth

## 0.4.0

### Minor Changes

- 9e3f1f6: Trim the public surface of `@hearthkit/auth` to a fixed allowlist (completion plan step 5). The `.` entry now exports exactly 35 values, down from 113: the twelve functions, `hearthkitAuthDrizzleSchema`, the env fragment, the failure union, `authRuntimeConfigSchema`, the ten result schemas, `authApiBasePath`, `hearthkitAuthTableNames`, and the seven branded schemas an app constructs. The `./auth-contract` subpath now resolves to `src/auth-contract-entry.ts` and carries the 22 contract values plus every public type, down from 100. Error prefixes, Better Auth literals, HTTP statuses, limits, options schemas, per-variant failure schemas and per-arm success schemas are no longer exported; a consumer that imported one must narrow the result union on `kind` instead. Type exports are unchanged. `CONTRACT.md` is rewritten from 1043 lines to 193.

### Patch Changes

- @hearthkit/config@0.4.0
  - @hearthkit/db@0.4.0
  - @hearthkit/email@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [27ec2e4]
  - @hearthkit/email@0.3.0
  - @hearthkit/config@0.3.0
  - @hearthkit/db@0.3.0

## 0.2.0

### Patch Changes

- @hearthkit/config@0.2.0
  - @hearthkit/db@0.2.0
  - @hearthkit/email@0.2.0

## 0.1.2

### Patch Changes

- 87ed532: Every package is licensed under MIT: a `LICENSE` file ships in each tarball and the manifest carries `"license": "MIT"`.
- Updated dependencies [87ed532]
  - @hearthkit/config@0.1.2
  - @hearthkit/db@0.1.2
  - @hearthkit/email@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [49983c4]
  - @hearthkit/config@0.1.1
  - @hearthkit/db@0.1.1
  - @hearthkit/email@0.1.1

## 0.1.0

### Minor Changes

- c0ecb6d: New `@hearthkit/auth` package (Phase 5): Better Auth 1.7 wired to `@hearthkit/db`'s Drizzle client and `@hearthkit/email`'s transport. Ships the server auth instance, the Next.js route handler, the browser client carrying the session hooks, a session reader, and the Drizzle table definitions for the seven auth tables. Email and password and magic link are always enabled; Google and GitHub only when both halves of their credential pair are set. Twelve functions, nine failure variants, all returned as values — nothing throws for a failure mode it names.

  The organization tables exist in **every** project, whether or not the `organizations` scaffold flag is on. The flag selects which endpoints exist, not which tables do, because switching a project between user scope and org scope later would be a data migration. `verifyAuthTablesExist` makes that a checkable claim rather than a comment.

  The OAuth both-or-neither rule is enforced by `resolveAuthRuntimeConfig` at boot rather than by a refinement on the env fragment, because `composeEnvSchemaFragments` rebuilds a fresh `z.object` from a fragment's shape and **silently discards** an attached `.refine` — a half-filled Google pair would otherwise boot as though no rule had been written.

  Reading this library correctly matters more than usual, because its recurring shape is that the obvious spelling returns a wrong answer rather than an error. The contract therefore pins the access paths: the error code is at `error.body?.code` and `error.code` is always `undefined`; a magic-link rejection carries no code at all and lives in `error.headers.get('location')`, where the property spelling `error.headers.location` yields `undefined`; database failures arrive as raw Drizzle errors with the real code exactly one `.cause` hop down. Error-code constants are exported and matched by exact equality because the library ships plausible decoys beside the real ones — `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` is thrown, not `USER_ALREADY_EXISTS`, and `ORGANIZATION_ALREADY_EXISTS`, not `ORGANIZATION_SLUG_ALREADY_TAKEN`.

  Two dependencies are load-bearing in ways their absence hides. `next` is a devDependency because `nextCookies()` rethrows a missing-package error it does not recognise, failing every cookie-setting call. `@types/pg` pins the peer-suffixed drizzle-orm resolution so `@hearthkit/db`'s client stays assignable; without it pnpm materialises a second copy and TypeScript reports a `PgSession.dialect` error that reads like a Drizzle bug.

  40 gates against real Postgres and a Mailpit container the suite starts on reserved ports of its own — never the repo's shared one, whose inbox other packages' gates clear wholesale.

### Patch Changes

- 8fa8810: `@hearthkit/config` is now a runtime `dependency` of `observability`, `storage`, `email`, `auth` and `payments`. Each imported it from `src/` but declared it only under `devDependencies`, which resolved through workspace hoisting and would fail on the first published install.

  Node is pinned to exactly `24.20.0` in `.nvmrc` and every `engines` field, matching the plan. CI reads the version from `.nvmrc`. The template ships its own `.nvmrc` and the same pin, and `appTemplateNodeVersion` carries the value in the template contract.

  Every `@hearthkit/*` package now versions as one fixed group, so a release bumps all of them together.

  Lint is now warning-free. Two small behaviour changes came with removing unsafe casts: `asEnvVariableName` in `config` throws on a key that is not SCREAMING_SNAKE_CASE, and `createHealthRouteHandler` in `observability` throws at boot when a caller bypasses the types with a health check whose name the contract rejects, instead of running it unvalidated.

- 1bc044f: Release tooling for the first publish (completion plan step 4.1). Every manifest gains `repository` and `homepage` pointing at the public repo, and a `prepublishOnly` guard that stops a publish when the package is private, still at 0.0.0, missing `src/index.ts`, or has an `exports` or `bin` target that does not exist or is outside `files`. The guard accepts the one JavaScript module `@hearthkit/config` ships. No runtime behaviour changes.
- Updated dependencies [08c9000]
- Updated dependencies [f44ed69]
- Updated dependencies [08c9000]
- Updated dependencies [886785b]
- Updated dependencies [6a8dbb5]
- Updated dependencies [8fa8810]
- Updated dependencies [1bc044f]
  - @hearthkit/config@0.1.0
  - @hearthkit/db@0.1.0
  - @hearthkit/email@0.1.0
