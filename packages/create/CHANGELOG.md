# @hearthkit/create

## 0.4.0

### Patch Changes

- @hearthkit/cli@0.4.0
  - @hearthkit/config@0.4.0
  - @hearthkit/db@0.4.0
  - @hearthkit/observability@0.4.0
  - @hearthkit/ui@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [5518613]
  - @hearthkit/ui@0.3.0
  - @hearthkit/cli@0.3.0
  - @hearthkit/config@0.3.0
  - @hearthkit/db@0.3.0
  - @hearthkit/observability@0.3.0

## 0.2.0

### Patch Changes

- @hearthkit/cli@0.2.0
  - @hearthkit/config@0.2.0
  - @hearthkit/db@0.2.0
  - @hearthkit/observability@0.2.0
  - @hearthkit/ui@0.2.0

## 0.1.2

### Patch Changes

- 87ed532: Every package is licensed under MIT: a `LICENSE` file ships in each tarball and the manifest carries `"license": "MIT"`.
- Updated dependencies [87ed532]
  - @hearthkit/cli@0.1.2
  - @hearthkit/config@0.1.2
  - @hearthkit/db@0.1.2
  - @hearthkit/observability@0.1.2
  - @hearthkit/ui@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [49983c4]
  - @hearthkit/config@0.1.1
  - @hearthkit/cli@0.1.1
  - @hearthkit/db@0.1.1
  - @hearthkit/observability@0.1.1
  - @hearthkit/ui@0.1.1

## 0.1.0

### Minor Changes

- 08c9000: New package: the `pnpm create @hearthkit` scaffolder. `createHearthkitProject(options)` takes every choice as an option (project name, packages, organizations, target directory, install, start infra, package version, interactive), resolves package dependencies without asking (`auth` pulls `db` and `email`, `payments` pulls `auth`), copies `templates/app` with the unselected paths and `hearthkit-section` blocks pruned, applies the ten scaffold rewrites the template manifest declares, writes `docker-compose.yml` through the CLI's generator and `infra/tofu.tfvars`, runs `pnpm install`, `hearthkit dev infra up` and `hearthkit db create` when enabled, and prints next steps. Prompts exist only as a fallback for a required option missing while stdin is a TTY; otherwise `create-option-missing`.

  The pruning logic (`decideTemplatePathPrune`, `pruneOptionalSectionBlocks`) moves here from the template, which keeps only the section manifest as data. Three scaffold variants (every package, none, `auth` with organizations) are gated end to end: install, typecheck, boot, Playwright smoke and flows, behind `HEARTHKIT_SCAFFOLD_GATES=1`.

### Patch Changes

- 1bc044f: Release tooling for the first publish (completion plan step 4.1). Every manifest gains `repository` and `homepage` pointing at the public repo, and a `prepublishOnly` guard that stops a publish when the package is private, still at 0.0.0, missing `src/index.ts`, or has an `exports` or `bin` target that does not exist or is outside `files`. The guard accepts the one JavaScript module `@hearthkit/config` ships. No runtime behaviour changes.
- Updated dependencies [c0ecb6d]
- Updated dependencies [08c9000]
- Updated dependencies [96b5271]
- Updated dependencies [7fd2b2d]
- Updated dependencies [08c9000]
- Updated dependencies [f44ed69]
- Updated dependencies [08c9000]
- Updated dependencies [886785b]
- Updated dependencies [6a8dbb5]
- Updated dependencies [8fa8810]
- Updated dependencies [7a25800]
- Updated dependencies [1bc044f]
- Updated dependencies [1047c7d]
- Updated dependencies [cf0e84d]
- Updated dependencies [108367b]
  - @hearthkit/cli@0.1.0
  - @hearthkit/config@0.1.0
  - @hearthkit/db@0.1.0
  - @hearthkit/observability@0.1.0
  - @hearthkit/ui@0.1.0
