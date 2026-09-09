# @hearthkit/db

## 0.1.0

### Minor Changes

- 886785b: New package: Drizzle client, migration runner, and project-database lifecycle for Postgres 17. `createProjectDatabase` provisions a database plus a same-named scoped login role (PUBLIC connect revoked) and returns the connection string once; drop, backup (pg_dump custom format), and restore (into an existing database) complete the lifecycle. `runDatabaseMigrations` applies drizzle-kit migrations and detects edited-history conflicts by sha256. All failure modes are returned as a discriminated union, never thrown.

### Patch Changes

- 08c9000: `@types/pg` and `@types/nodemailer` move from `devDependencies` to `dependencies`. Both packages ship TypeScript source, so a project's `tsc` and `next build` compile that source and need the type packages present in the project's own tree; the first scaffolded project's typecheck failed with `TS7016` on `pg` and `nodemailer` until they were installed by hand.
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
