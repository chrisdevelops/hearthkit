# @hearthkit/config

## 0.1.2

### Patch Changes

- 87ed532: Every package is licensed under MIT: a `LICENSE` file ships in each tarball and the manifest carries `"license": "MIT"`.

## 0.1.1

### Patch Changes

- 49983c4: Confirms the release workflow publishes through npm trusted publishing with no token (completion plan step 4.2).

## 0.1.0

### Minor Changes

- f44ed69: New package: one validated Zod schema for all environment variables. Composes per-package env schema fragments, validates process.env in a single pass, and returns a typed frozen config object. Boot failures name every missing or invalid variable in one aggregate message. Failure modes: missing variable, wrong type, invalid URL, fragment conflict.

### Patch Changes

- 08c9000: Node 24 refuses to strip types from `.ts` files under `node_modules`, so an installed `hearthkit` bin was unrunnable in a generated project. `@hearthkit/config` now ships one JavaScript module, exported as `@hearthkit/config/register-node-modules-type-stripping`, that registers a module load hook stripping types for exactly that set; it is a no-op inside the workspace where packages resolve to real paths. The `hearthkit` bin is now a small JavaScript entry that imports the hook and then the TypeScript bin. The `create` bin and the template's Playwright `test:e2e` script preload the same module. It lives in `config` rather than `cli` because every project depends on `config`, while an empty package selection prunes `cli`.
- 8fa8810: `@hearthkit/config` is now a runtime `dependency` of `observability`, `storage`, `email`, `auth` and `payments`. Each imported it from `src/` but declared it only under `devDependencies`, which resolved through workspace hoisting and would fail on the first published install.

  Node is pinned to exactly `24.20.0` in `.nvmrc` and every `engines` field, matching the plan. CI reads the version from `.nvmrc`. The template ships its own `.nvmrc` and the same pin, and `appTemplateNodeVersion` carries the value in the template contract.

  Every `@hearthkit/*` package now versions as one fixed group, so a release bumps all of them together.

  Lint is now warning-free. Two small behaviour changes came with removing unsafe casts: `asEnvVariableName` in `config` throws on a key that is not SCREAMING_SNAKE_CASE, and `createHealthRouteHandler` in `observability` throws at boot when a caller bypasses the types with a health check whose name the contract rejects, instead of running it unvalidated.

- 1bc044f: Release tooling for the first publish (completion plan step 4.1). Every manifest gains `repository` and `homepage` pointing at the public repo, and a `prepublishOnly` guard that stops a publish when the package is private, still at 0.0.0, missing `src/index.ts`, or has an `exports` or `bin` target that does not exist or is outside `files`. The guard accepts the one JavaScript module `@hearthkit/config` ships. No runtime behaviour changes.
