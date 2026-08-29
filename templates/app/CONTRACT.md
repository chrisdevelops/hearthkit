# templates/app — contract

## Purpose

`templates/app` is the Next.js App Router project that `@hearthkit/create` copies to make a new project. It is not a library: it has no public functions a caller imports. It is a **file tree with guaranteed paths** that, once copied and installed, boots into a container serving a themed home page and `/health`. Phase 4 wires exactly the three required packages — `@hearthkit/config`, `@hearthkit/ui`, `@hearthkit/observability` — plus a Dockerfile, a Playwright smoke test, and the two workflows every generated project gets. It is the executable version of the "App setup" section of `docs/theming.md`: if the document and the template disagree, one of them is a bug.

Because the tree is the deliverable, this contract's job is to say precisely **which files exist**, **which of them reach a user's project**, **what the running app must do**, and **how each of those can fail**. Phase 6's pruning, the template's own gates, and the batched container run all assert against the lists in `src/app-template-contract.ts` rather than against prose.

## Inputs

### 1. Scaffold-time input, consumed by `@hearthkit/create` in Phase 6

Exactly one value: the project name. It is `HearthkitProjectName` — the branded, lowercase-kebab-case name owned by `@hearthkit/cli` (`hearthkitProjectNameSchema`). This contract deliberately does not re-declare it (one concept, one spelling) and therefore takes no dependency on `@hearthkit/cli`; `create` validates it and passes it in.

The project name reaches exactly one file: the `name` field of `package.json`. `Dockerfile`, both workflows, and every source file are name-independent, so the scaffolder never rewrites them. The full set of things `create` must change instead of copying is `appTemplateScaffoldRewriteTargets`:

- `project-package-name` — `package.json` `name`: `@hearthkit/app-template` becomes the project name.
- `hearthkit-dependency-specifier` — every `@hearthkit/*` dependency: `workspace:*` becomes a published version range.
- `repo-only-script` — delete the scripts in `appTemplateRepoOnlyScriptNames` (`test`, `verify:container`).
- `repo-only-dependency` — delete the dev dependencies in `appTemplateRepoOnlyDependencyNames` (`vitest`, `zod`).
- `gitignore-file-rename` — write `gitignore` as `.gitignore`, because npm strips a nested `.gitignore` from a published tarball (see **Verified**).

Optional-package selection is **not** an input in Phase 4. The template has no conditional sections; each Phase 5 package adds its own during its own loop.

### 2. Environment variables the running app reads

Declared by the packages that own them and composed by `@hearthkit/config`. The names are `appTemplateEnvVariableNames`, and `.env.example` documents exactly this set.

- `NODE_ENV` — `development`, `test`, or `production`. Optional, defaults to `development`. Example: `production`. Owned by `@hearthkit/config`.
- `GLITCHTIP_DSN` — an http(s) URL in Sentry DSN form. Optional; unset means error reporting is a no-op. Example: `https://abc123@glitchtip.example.com/1`. Owned by `@hearthkit/observability`.
- `LOG_LEVEL` — one of `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Optional, defaults to `info`. Example: `debug`. Owned by `@hearthkit/observability`.

**No variable is required in Phase 4.** That is a fact about this template, not about the mechanism: `db`'s `DATABASE_URL` makes a required variable reachable in Phase 5 without any change here. Empty string counts as unset, per config's rule.

Two more variables are read by the Next standalone server itself and never validated by config (`appTemplateContainerEnvVariableNames`):

- `PORT` — optional, defaults to `3000`, set by `ENV PORT` in the Dockerfile.
- `HOSTNAME` — optional, but must be `0.0.0.0` inside a container, set by `ENV HOSTNAME` in the Dockerfile.

### 3. Test-time input

`SMOKE_TEST_BASE_URL` (`appSmokeBaseUrlEnvVariableName`). When set, the Playwright smoke test runs against that already-running server and starts nothing itself; that is how the same spec runs against both `next start` in project CI and the container in the batched verify. When unset it defaults to `appSmokeDefaultBaseUrl` and Playwright's `webServer` starts the app.

### 4. Named exports inside the tree

The template has no importable package entry, but the gates import these names by path, so they are contract surface and the implementor may not rename them.

- `requireAppRuntimeConfig` in `app-runtime-config.ts` — `(options?: { env?: EnvSource }) => AppRuntimeConfig`. Passes the fragment list to `requireHearthkitConfig` and returns the frozen config, or throws. `env` defaults to `process.env` and exists so a gate can prove the boot-failure path without a container.
- `appEnvSchemaFragments` in `app-runtime-config.ts` — `readonly EnvSchemaFragment[]`, which is `[configEnvSchemaFragment, observabilityEnvSchemaFragment]` in Phase 4. The extension point for every Phase 5 package.
- `appHealthCheckRegistry` in `app-health-checks.ts` — `AppHealthCheckRegistry`, that is `readonly NamedHealthCheck[]`, empty in Phase 4.
- `register` and `onRequestError` in `instrumentation.ts` — Next's own file convention; behavior is in the running-app section below.
- `GET` in `app/health/route.ts` — `(request: Request) => Promise<Response>`, produced by `createHealthRouteHandler`. A gate calls it directly.

## Outputs

### The template tree

`appTemplateGuaranteedPaths` — 23 literal paths that must exist in `templates/app`:

```
.dockerignore                   app/globals.css          next.config.ts
.env.example                    app/health/route.ts      package.json
.github/workflows/ci.yml        app/layout.tsx           playwright.config.ts
.github/workflows/deploy.yml    app/page.tsx             postcss.config.mjs
.oxlintrc.json                  docs/theming.md          public/.gitkeep
Dockerfile                      e2e/app-smoke.spec.ts    tsconfig.json
README.md                       gitignore
app-health-checks.ts            instrumentation.ts
app-runtime-config.ts
```

The split between what ships and what stays here is one rule plus two files:

- **Copied:** everything not listed below. The Dockerfile, both workflows, `playwright.config.ts`, and `e2e/app-smoke.spec.ts` are project deliverables even though the smoke spec is also a hearthkit gate.
- **hearthkit-only:** everything under the directories in `appTemplateRepoOnlyDirectoryNames` — `src/` (this contract, the shape gates, the container verify script) and `test-fixtures/` (gate fixtures, which may not exist yet; the prune rule must tolerate an absent directory) — plus `CONTRACT.md` and `vitest.config.mts` (`appTemplateRepoOnlyPaths`).
- **Never copied:** `node_modules`, `.next`, `test-results`, `playwright-report` (`appTemplateNeverCopiedDirectoryNames`).

**The invariant that makes pruning safe: no file outside the repo-only directories may import from them.** Deleting `src/` and `test-fixtures/` therefore cannot break the app. Runtime files that need a value this contract also holds (the fragment list, the health registry) declare it themselves, and the gate asserts the two agree.

`appGeneratedProjectGuaranteedPaths` is the same list with the renames applied, which is what a Phase 6 gate asserts against a scaffolded project.

`public/.gitkeep` is a guaranteed path for two reasons: the runner stage of the Dockerfile copies `public/` unconditionally, and `COPY` fails the build when the directory is absent (Next never creates one); and a real app wants somewhere to put a favicon on day one. Unlike `.gitignore`, `.gitkeep` matches nothing in npm's always-excluded list, so it survives publishing without a rename.

### `package.json`

`name: '@hearthkit/app-template'`, `private: true`, `version: 0.0.0`, `packageManager: 'pnpm@10.33.0'`, `engines.node: '>=24'`. **No `type` field** — the standalone `server.js` Next emits is CommonJS and sits next to a copy of this manifest, and `"type": "module"` is a long-standing standalone breakage (see **Verified**). Every source file is `.ts` or `.tsx` compiled by Next, and `postcss.config.mjs` carries an explicit ESM extension, so nothing needs the field.

Dependencies: the three packages in `appTemplateRequiredPackageNames` at `workspace:*`, plus `next` at `appTemplateNextVersion` and `react`/`react-dom` 19 matching the versions `@hearthkit/ui` develops against. Dev dependencies: `typescript` at `appTemplateTypescriptVersion`, `tailwindcss` and `@tailwindcss/postcss` at `appTemplateTailwindVersion`, `@playwright/test` at `appTemplatePlaywrightVersion`, `oxlint` and `oxlint-tsgolint` matching the repo, the `@types/*` packages TypeScript 7 does not auto-include, and the repo-only `vitest` and `zod`.

Scripts — `appTemplateGuaranteedScriptNames` ship, `appTemplateRepoOnlyScriptNames` do not:

- `dev` is `next dev` (ships).
- `build` is `next build` (ships).
- `start` is `next start` (ships).
- `lint` is `oxlint --type-aware .` (ships).
- `typecheck` is `next typegen && tsc --noEmit` (ships).
- `test:e2e` is `playwright test` (ships).
- `test` is `vitest run`, the fast shape gates (hearthkit-only).
- `verify:container` runs `appTemplateVerifyContainerScriptPath`, the batched Docker and smoke run (hearthkit-only).

`test` must stay the fast gates: the repo-root CI runs `pnpm --recursive --if-present run test` on every pull request, and Playwright must never run there. `typecheck` regenerates `next-env.d.ts` first because that file is gitignored on Next's own instruction.

### Configuration files

- **`next.config.ts`** — `output: 'standalone'` (`appNextConfigOutputMode`) and `transpilePackages` containing every name in `appTemplateRequiredPackageNames`, because those packages ship TypeScript source. Nothing else is required; the implementor may add `serverExternalPackages` if the build demands it, but never for a package already in `transpilePackages`. `experimental.useTypeScriptCli` must **not** be set: it is already the default in 16.3.3. `outputFileTracingRoot` must **not** be set: a generated project is its own tracing root, and the workspace build path is handled by materializing a self-contained directory instead.
- **`tsconfig.json`** — self-contained, **no `extends`**, because a generated project cannot reach `../../tsconfig.base.json`. It mirrors the base's meaningful options (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `skipLibCheck`, `forceConsistentCasingInFileNames`, `resolveJsonModule`, `types: ['node']`, `allowImportingTsExtensions`, `erasableSyntaxOnly`) and adds what Next needs: `jsx: 'react-jsx'`, `module: 'preserve'`, `moduleResolution: 'bundler'`, a `lib` including DOM, `noEmit`, and an `include` containing `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, and `.next/dev/types/**/*.ts`. `jsx` and the `.next/dev/types` entry are pre-set so `next build` does not rewrite the file. **No `baseUrl`** — TypeScript 7 removed it and it fails the workspace typecheck with TS5102.
- **`postcss.config.mjs`** — `{ plugins: { '@tailwindcss/postcss': {} } }`, exactly as `docs/theming.md` shows.
- **`app/globals.css`** — `appTemplateGlobalsCssRequiredLines` in order: `@import 'tailwindcss';`, then the theme import built from `hearthkitThemeCssImportSpecifier`, then the literal `tailwindSourceDirectiveForUi`. Both come from `@hearthkit/ui/ui-contract`, the package's JSX-free subpath; neither is retyped here. The `@source` literal is why `globals.css` sits at `app/globals.css`, exactly one level below the app root, and why the template must not use the `src/app` layout.
- **`.oxlintrc.json`** — the repo's rule set, so a generated project lints itself the same way hearthkit does.
- **`gitignore`** — must ignore at least `node_modules/`, `.next/`, `next-env.d.ts`, `.env`, `.env.local`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.DS_Store`.

### The running app

- **`instrumentation.ts`** exports `register()` and `onRequestError`. `register()` calls `requireAppRuntimeConfig()`, then `initializeErrorReporting({ glitchtipDsn, reportingEnvironment: NODE_ENV })`, then logs exactly one line through `createStructuredLogger({ logLevel })` whose message is `appStartupLogMessage`, that is `hearthkit app started`, as newline-delimited JSON on stdout. `onRequestError` forwards the thrown value to `captureError` with the request path, method, and router context as error context. A boot with an invalid variable must fail loudly: the config message reaches stderr and the process does not serve a 200. Next does not document what a throwing `register()` does to the process, so the implementor may exit explicitly to guarantee it.
- **`app/layout.tsx`** imports `./globals.css`, sets `suppressHydrationWarning` on the `html` element, and wraps children in `ThemeModeProvider`.
- **`app/page.tsx`** renders `PageContainer` and `PageHeader` with `ThemeModeToggle` in the actions slot, and a `Card` containing a package `Button`. Its only job is to prove the ui wiring end to end.
- **`app/health/route.ts`** exports `GET = createHealthRouteHandler({ healthChecks: appHealthCheckRegistry })`. No route segment config: GET handlers have been dynamic by default since Next 15, so `/health` is evaluated per request without `force-dynamic`. Body and status codes are observability's `HealthReport`: 200 with `{"status":"ok","checks":[]}` in Phase 4, 503 when a registered check fails.
- **`app-health-checks.ts`** exports `appHealthCheckRegistry`, empty in Phase 4 (`appTemplateHealthCheckNames`). This is the file a Phase 5 package edits — for example `db` appending `{ healthCheckName: 'database', runHealthCheck }` — which is how a dependency ping reaches `/health` without `@hearthkit/observability` importing `@hearthkit/db`.

### The container image

`Dockerfile`: multi-stage on an exactly pinned `node:24.x-slim` base, `corepack enable pnpm` with `pnpm install --frozen-lockfile`, `next build` in a builder stage **with no environment variables set**, then a runner stage that copies `.next/standalone`, `.next/static`, and `public` (Next copies neither of the last two itself), sets `ENV PORT` and `ENV HOSTNAME=0.0.0.0`, runs `USER node` (`appContainerRunAsUserName`), declares a `HEALTHCHECK` that requests `appHealthRoutePath` on the loopback interface using the image's own Node runtime rather than `curl` or `wget`, and starts `node server.js`.

The image build consumes the project's committed `pnpm-lock.yaml`. The template itself ships none, since the workspace lockfile covers it, which is why the image can only be built from a **materialized project directory**: a copy with the repo-only files pruned, the renames applied, and dependency specifiers that resolve without the workspace. Nothing may symlink outside that directory, or output file tracing drops the hearthkit packages from `.next/standalone`.

### The two workflows

Written in full, at `.github/workflows/` inside the template, so they are inert in the hearthkit repo and live in a generated project. Their required content is pinned as literal strings so a step cannot silently disappear.

- **`ci.yml`** — on pull request: checkout, pnpm, Node 24, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, install the Chromium browser, `pnpm test:e2e`. Every string in `appTemplateCiWorkflowRequiredContent` must appear in the file.
- **`deploy.yml`** — on push to `main`: build the image and push it to `ghcr.io` (`appContainerRegistryHost`) tagged with the commit SHA and `latest`, using the repository's own `GITHUB_TOKEN` with `packages: write`, then call the Dokploy deploy webhook held in the `DOKPLOY_DEPLOY_WEBHOOK_URL` secret (`appDokployWebhookSecretName`). Every string in `appTemplateDeployWorkflowRequiredContent` must appear in the file.

**The webhook step runs only when that secret is set**, which is what keeps build-and-push testable on a throwaway repository with no Dokploy instance. The `secrets` context is not available in any `if` key, so the guard is the documented two-part pattern: map the secret into `env` (allowed in `jobs.<job_id>.env` and step `env`), then condition the step on `env.DOKPLOY_DEPLOY_WEBHOOK_URL != ''`. Both halves are in `appTemplateDeployWorkflowRequiredContent`, so removing either one fails a gate.

### The batched container verify command

`pnpm --filter @hearthkit/app-template run verify:container` runs `appTemplateVerifyContainerScriptPath`. It is implementor-owned code with an observable contract, in this order:

1. Materialize a self-contained project directory in a temporary location: copy the template, drop the repo-only directories and files, apply the renames, delete the repo-only scripts and dev dependencies, and replace every `workspace:*` specifier with something that resolves without the workspace. Packing the three packages and installing the tarballs is the mechanism that most closely rehearses the published path; the requirement is only that no dependency resolves through a symlink escaping the directory.
2. `pnpm install` in that directory, which also produces the `pnpm-lock.yaml` the image build consumes.
3. `docker build`. On a nonzero exit, print a last stderr line starting with `appImageBuildFailedErrorPrefix` carrying the exit code, and exit 1.
4. Run the container with a published port and poll `appHealthRoutePath` until it answers 200. If it never does within the wait, print a last stderr line starting with `appContainerNotHealthyErrorPrefix` carrying the elapsed milliseconds, dump the container logs, and exit 1.
5. Assert the container's stdout contains `appStartupLogMessage`, which proves config loading, logging, and the standalone server all ran.
6. Run the Playwright smoke against the container with `SMOKE_TEST_BASE_URL` pointing at it.
7. Remove the container and the temporary directory whether or not the run passed, then exit 0 on success and 1 on any failure.

The script and the materializer it calls in step 1 import `src/app-template-contract.ts` directly, so the pruning lists, the health route, the startup log line, and the error prefixes have exactly one source of truth. The mirror module that used to re-declare those values by hand, with a text-substring drift check standing in for a real import, is gone. That is only possible because `@hearthkit/ui/ui-contract` is importable from bare Node: the contract file takes its two theme constants from that subpath rather than from the `@hearthkit/ui` entry point, which resolves through `.tsx` modules that `node` refuses outright (`ERR_UNKNOWN_FILE_EXTENSION`). If the contract ever imports the package entry again, or `@hearthkit/ui` breaks the JSX-free rule on `src/ui-contract.ts`, this script stops being able to read its own contract.

`appVerifyContainerFailedErrorPrefix` — `hearthkit app verify container failed:` — is the prefix the script prints for **its own** failures: a failed `pnpm install`, `docker run`, or `pnpm pack`, a container with no published port, a Playwright run that exited nonzero. It is deliberately **not** a variant of `AppTemplateFailure`: it reports the verification harness failing, not the template artifact being wrong. It is distinct from the two template prefixes named in steps 3 and 4, `appImageBuildFailedErrorPrefix` and `appContainerNotHealthyErrorPrefix`, which do describe a broken artifact.

This command is what makes the Phase 4 definition of done reproducible, and step 1 is a dry run of what `@hearthkit/create` does in Phase 6 from the same lists.

## Failure modes

One discriminated union, `AppTemplateFailure`, on `kind`. Where the app itself emits the failure, the owning package's message is passed through verbatim; where a gate or the verify command observes it, the prefix is what that tool prints.

- **`app-template-path-missing`** — a path in `appTemplateGuaranteedPaths` is absent; carries `missingPath`. Prefix `hearthkit app template path missing:`. Observed by the shape gate.
- **`app-template-repo-only-path-copied`** — a file under a repo-only directory, or `CONTRACT.md`, or `vitest.config.mts`, reached a generated project; carries `copiedPath`. Prefix `hearthkit app template repo-only path copied:`. Observed by the Phase 6 scaffold gate.
- **`app-scaffold-rewrite-missing`** — a rewrite target was skipped, for example a `workspace:*` specifier survived scaffolding; carries `rewriteTarget`. Prefix `hearthkit app template scaffold rewrite missing:`. Observed by the Phase 6 scaffold gate.
- **`app-theme-wiring-missing`** — `globals.css` lost a line of `appTemplateGlobalsCssRequiredLines`, or the layout lost the provider; carries `missingLine`. Prefix `hearthkit app theme wiring missing:`. The app still returns 200 and renders unstyled, so nothing else catches it; observed by the shape gate and by the smoke test's computed-style assertion.
- **`app-workflow-content-missing`** — `ci.yml` or `deploy.yml` lost a required literal, including either half of the webhook guard; carries `workflowPath` and `missingLine`. Prefix `hearthkit app workflow content missing:`. Observed by the shape gate.
- **`app-boot-config-invalid`** — boot rejected the environment. The message is config's own, not re-worded, so it starts with `hearthkit config invalid:` (`configInvalidErrorPrefix`). Observed by a gate calling `requireAppRuntimeConfig({ env })` and by the container run.
- **`app-image-build-failed`** — `docker build` exited nonzero; carries the exit code and a stderr excerpt. Prefix `hearthkit app image build failed:`. Observed by `verify:container`.
- **`app-container-not-healthy`** — the container started but `/health` never returned 200 within the wait; carries `waitedMs`. Prefix `hearthkit app container not healthy:`. Observed by `verify:container`.
- **`app-health-dependency-unavailable`** — `/health` returned 503 with failed or timed-out checks; carries them as observability `HealthCheckResult` values. Prefix `hearthkit app health dependency unavailable:`. Observed by the smoke test, and by Uptime Kuma from Phase 7.

Four notes on coverage, stated rather than hidden:

- `app-boot-config-invalid` is reachable in Phase 4 only through an **invalid value** such as `LOG_LEVEL=nope` or `GLITCHTIP_DSN=not-a-url`, because no variable is required yet. The missing-variable path is the same code path in `@hearthkit/config`, already gated there, and becomes reachable here when a Phase 5 package contributes a required variable.
- `app-health-dependency-unavailable` is **structurally unreachable in Phase 4**: the registry is empty, so `/health` is always 200. Its 503 behavior is already gated inside `@hearthkit/observability`; this template gates the 200 path and the emptiness of the registry, and the 503 path becomes reachable in Phase 5 with the first registered check.
- `app-image-build-failed` and `app-container-not-healthy` are **observed by running `verify:container`, not by a separate gate**. Both live in implementor-owned code, and forcing them would mean deliberately breaking a Docker build or a health endpoint on every run, which costs minutes for no signal the positive path does not already give. The gates assert the script exists at `appTemplateVerifyContainerScriptPath` and that `verify:container` invokes it; the failure behavior itself is verified by reading the two prefixes in the script's output when a real build breaks. This is stated under-coverage, deliberately chosen over fabricated coverage.
- Everything else in this list is asserted by the fast gates or by a Phase 6 gate written from the same constants.

### How this is gated

Two tiers, because the slow ones must not run per change.

- **Fast** (`pnpm --filter @hearthkit/app-template test`, Vitest, no services): the path lists; the repo-only split and the no-import-from-repo-only-directories invariant; `package.json` scripts, dependency specifiers and version pins; `next.config.ts` imported and inspected for `output` and `transpilePackages`; `tsconfig.json` keys; `globals.css` required lines; both workflows' required content; `.env.example` matching `appTemplateEnvVariableNames`; `gitignore` entries; Dockerfile text assertions covering the non-root user, the healthcheck, `ENV PORT` and `HOSTNAME`, the pinned base image, and the `public` copy; `app/health/route.ts` imported and its `GET` called directly, parsing the body with `healthReportSchema`; `requireAppRuntimeConfig` with a bad `env` throwing config's prefixed message.
- **Batched** (`pnpm --filter @hearthkit/app-template run verify:container`, Docker required): the seven steps above. Run once at the Verify step before committing. In CI this runs on manual trigger and on push to `main` only, never on pull requests. The accepted trade-off is that the local run is the real gate and `main` is checked after merge.

Known untested surface: the Dokploy webhook call in `deploy.yml` cannot be exercised until Phase 7 provisions a Dokploy instance. Build and GHCR push are testable now against a throwaway repository.

## Dependencies

- **Packages (runtime):** `@hearthkit/config`, `@hearthkit/observability`, `@hearthkit/ui`, all at `workspace:*`. No `@hearthkit/db`, `storage`, `email`, `auth`, or `payments`, and no `@hearthkit/cli` — with none of `db`, `storage`, or `email` installed there is no local infra service to start, so `dev` is plain `next dev` and the CLI enters the template with the Phase 5 section that needs it.
- **Third-party (runtime):** `next` 16.3.3, `react` and `react-dom` 19.
- **Third-party (dev):** `typescript` 7.0.2, `tailwindcss` and `@tailwindcss/postcss` 4.3.3, `@playwright/test` 1.62.1, `oxlint` and `oxlint-tsgolint` matching the repo, `vitest`, `zod`, and the `@types/*` packages TypeScript 7 does not auto-include.
- **Services for gates:** none for the fast gates. The batched run needs Docker and a Chromium download for Playwright. No Postgres, MinIO, Mailpit, or Stripe — the Phase 4 template has no external dependency, which is also why the health registry is empty.
- **Contract file imports:** `src/app-template-contract.ts` imports only from the three packages the template already depends on, so it adds no dependency of its own. Importing it evaluates schemas and constants and does nothing else.

## Out of scope

- **Optional-package sections (`storage`, `email`, `auth`, `payments`).** Deliberately absent; each lands in its own Phase 5 loop against a real contract. Nothing here blocks them, and each has a named extension point: a fragment added to `appEnvSchemaFragments` in `app-runtime-config.ts`, a check appended to `appHealthCheckRegistry` in `app-health-checks.ts`, a package name added to `transpilePackages` and to `appTemplateRequiredPackageNames`, a variable added to `.env.example` and `appTemplateEnvVariableNames`, a flow added under `e2e/`, and any new file added to `appTemplateGuaranteedPaths`. Two rules must survive those additions: **no required environment variable may be read during `next build`**, since the image builds with an empty environment, and **no file outside the repo-only directories may import from them**.
- **Conditional or templated file content.** No placeholder tokens anywhere. The scaffolder rewrites JSON fields and deletes files; it never string-substitutes source. Pruning by file is what `create` implements.
- **Generating `docker-compose.yml`, `.env`, or `infra/tofu.tfvars`.** `@hearthkit/create` generates those (plan 4.10), reusing `generateLocalInfraCompose` from `@hearthkit/cli`. The template ships `.env.example` only, and never a real `.env`.
- **Deployment topology.** Joining the `hearthkit-shared` Docker network, TLS, domains, and the Dokploy application itself are configured on the VPS in Phase 7. Guiding rule 1 holds: a project is a Dockerfile plus environment variables, so none of that lives in the project repo.
- **A shared logger singleton, `paths` aliases, form libraries, or app-owned shadcn components.** Not needed by the home page and all additive later. Component changes follow `docs/theming.md`: token overrides in `globals.css`, then a single copied component, never an edit inside the package.
- **Publishing.** The template is private and never published. How its files reach the published `@hearthkit/create` tarball is a Phase 6 decision; the path lists here make either approach checkable, and the `gitignore` rename already accounts for npm's ignore-file handling.
- **Deferred features (plan section 13).** Preview environments stay open because nothing in the tree encodes an environment name: the image is promoted by tag and configured by variables. Secrets manager, per-project Postgres, multi-region, passkeys, usage billing, and org billing are all invisible to the template because every setting arrives as an environment variable at run time, not at build time.

## Verified

Checked 2026-08-28 against Next.js docs at version 16.3.3.

- `output: 'standalone'` writes `.next/standalone` with a minimal `server.js`; `public` and `.next/static` are **not** copied automatically and must be copied manually; the server reads `PORT` and `HOSTNAME`; in a monorepo the tracing root defaults to the project directory — https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- `instrumentation.ts` lives at the project root, or in `src` when the app uses that layout; `register()` runs once when a server instance is initiated and must complete before requests are served; `onRequestError(error, request, context)` is stable since 15.0.0 — https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
- Route handlers use Web `Request` and `Response`, and **the default caching for `GET` handlers changed from static to dynamic in 15.0.0-RC**, so `/health` needs no `dynamic = 'force-dynamic'` — https://nextjs.org/docs/app/api-reference/file-conventions/route
- `transpilePackages` is the documented opt-in for a `node_modules` dependency that ships raw TypeScript, and a package may not appear in both `transpilePackages` and `serverExternalPackages`, since Next throws at build start — https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages
- **TypeScript 7 is documented as supported:** "Next.js uses the project-local `tsc` CLI by default, so no additional configuration is required", and `experimental.useTypeScriptCli` is the opt-**out**, set to `false` to use the JS compiler API. This confirms the settled decision not to set the flag. The same page: `next-env.d.ts` is regenerated by `next dev`, `next build`, or `next typegen`, its contents are an implementation detail, and it should be **added to `.gitignore`**, which is why `typecheck` runs `next typegen` first and the file is not a guaranteed path — https://nextjs.org/docs/app/api-reference/config/typescript
- The official Next Docker example uses `node:24.x-slim`, `corepack enable pnpm && pnpm install --frozen-lockfile`, `USER node`, `ENV PORT=3000`, `ENV HOSTNAME="0.0.0.0"`, and `CMD ["node", "server.js"]` — https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile
- `"type": "module"` with `output: 'standalone'` produces a CommonJS `server.js` next to an ESM manifest and fails at runtime; open since 2022 — https://github.com/vercel/next.js/issues/41258 and https://github.com/vercel/next.js/issues/62521
- npm applies a nested `.gitignore` as an ignore filter and strips it, along with `.npmrc`, from a published tarball, which is why template repositories store the file dotless and rename it at scaffold time. The always-excluded list is `*.orig`, `.*.swp`, `.DS_Store`, `._*`, `.git`, `.hg`, `.lock-wscript`, `.npmrc`, `.svn`, `.wafpickle-N`, `CVS`, `config.gypi`, `node_modules`, `npm-debug.log`, and the lockfiles; `.gitkeep` matches none of those, so `public/.gitkeep` needs no rename — https://github.com/npm/cli/wiki/Files-&-Ignores and https://docs.npmjs.com/cli/v11/configuring-npm/package-json
- The `secrets` context is **not available** in `jobs.<job_id>.if` or in step-level `if`; it is available in `jobs.<job_id>.env` and step `env`, which is why the deploy guard maps the secret into `env` and tests `env.DOKPLOY_DEPLOY_WEBHOOK_URL != ''` — https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
- Playwright `webServer` takes `command`, `url`, `reuseExistingServer`, and `timeout`, and pairs with `use.baseURL`; latest `@playwright/test` is 1.62.1 — https://playwright.dev/docs/test-webserver and https://registry.npmjs.org/@playwright/test/latest
- Current versions: `next` latest is **16.3.3** with peer `react ^19.0.0`, and `tailwindcss` and `@tailwindcss/postcss` are **4.3.3** — https://registry.npmjs.org/next/latest, https://registry.npmjs.org/tailwindcss/latest, https://registry.npmjs.org/@tailwindcss/postcss/latest
- Current GitHub Actions majors for the deploy workflow: `docker/build-push-action@v7`, `docker/login-action@v4`, `docker/setup-buildx-action@v4` — https://github.com/docker/build-push-action. `actions/checkout@v7`, `actions/setup-node@v7`, and `pnpm/action-setup@v6` are already recorded in `docs/STATUS.md`.
- **Partially verified — Dokploy.** The documented CI-triggerable endpoint is `POST https://<host>/api/application.deploy` with an `x-api-key` header and an `applicationId` body. The refresh-token webhook URL is referenced but its exact format and HTTP method are not published — https://docs.dokploy.com/docs/core/auto-deploy. This is why `deploy.yml` calls a full URL held in a secret and skips when it is absent; Phase 7 confirms the format against a real instance, per plan section 14.

Verified by the orchestrator and not to be re-hedged:

- **Relative `.ts` and `.tsx` import specifiers work in a Next 16.3.3 app build** (2026-08-28). A page importing `'../app-runtime-config.ts'` and `'../components/probe-card.tsx'`, with `allowImportingTsExtensions`, `erasableSyntaxOnly`, and `verbatimModuleSyntax` set, passed `tsc --noEmit`, `next build`, and served HTTP 200 from the standalone server rendering the imported component. The repo-wide specifier rule therefore holds inside the template with no exception.
- **Prettier does not rewrite the `@source` literal** (2026-08-28). Running the repo's Prettier config over a `globals.css` containing all three required lines produced byte-identical output with the double quotes preserved. No Prettier override is needed and the exact-literal assertion is safe.
- **`vitest.config.mts`, not `.ts`** (2026-08-28). Vite's `configLoader: 'native'` warns on ESM syntax in a file loaded as CommonJS and that loader becomes the default in a future major. Since `"type": "module"` is ruled out by the standalone `server.js` constraint above, the extension is the fix, and the file is named in `appTemplateRepoOnlyPaths` accordingly. This is the gate-writer's file.

Taken from `docs/STATUS.md` and not re-derived: Next 16.3.3 with `typescript@7.0.2`, `next.config.ts`, and `output: 'standalone'` builds, typechecks, and serves; `next build` rewrites `jsx` to `react-jsx` and appends `.next/dev/types/**/*.ts` to `include`; Tailwind 4.3.3 `@source` follows pnpm symlinks in both layouts Phase 4 can hit, through `@tailwindcss/postcss`; `baseUrl` is removed in TypeScript 7, failing with TS5102.

Not yet verifiable: `templates/app` has no `package.json`, so the imports in `src/app-template-contract.ts` resolve once the implementor adds the three workspace dependencies and `zod@4.4.3`. The imports are schemas and constants only, so importing the contract file still does nothing.

## Decisions

No open questions. Round-1 review resolved all seven, and round 2 closed six gaps found while writing the gates.

Round 1, resolved by the orchestrator on 2026-08-28:

1. `docs/theming.md` was corrected: the TypeScript 5.x paragraph is gone, replaced with the TypeScript 7 and Next 16.3.3 position and a warning not to set `experimental.useTypeScriptCli`. The template and the document now agree.
2. The root `.gitignore` gained `test-results/`, `playwright-report/`, and `next-env.d.ts`, which the template's dotless `gitignore` cannot cover in-repo.
3. Implementor access to `templates/app` was already in place; the ownership hook additionally now blocks the implementor from `e2e/*.spec.ts` and `playwright.config.ts`, which are gate-writer files even though they ship to projects.
4. `.oxlintrc.json` stays in the template.
5. `SMOKE_TEST_BASE_URL` and `DOKPLOY_DEPLOY_WEBHOOK_URL` are accepted names.
6. Relative TypeScript-extension specifiers are settled as working; see **Verified**.
7. The Prettier and `@source` concern is disproven; see **Verified**.

Round 2, six gaps closed:

1. `test-fixtures/` would have shipped into generated projects. The single `appTemplateRepoOnlyDirectoryName` became `appTemplateRepoOnlyDirectoryNames` (`src`, `test-fixtures`), and the no-import invariant now covers both directories.
2. `public/.gitkeep` joined `appTemplateGuaranteedPaths`, so the Dockerfile's `COPY` of `public/` is unconditional and a new project has somewhere to put a favicon.
3. `appTemplateTailwindVersion` and `appTemplatePlaywrightVersion` were added, so the manifest gate no longer retypes a pin that lived only in prose.
4. `verify:container` gained an observable contract: an ordered seven-step definition, exit codes, and the two prefixes it prints. Its two failure modes are stated as observed-by-running rather than separately gated.
5. `appTemplateCiWorkflowRequiredContent` and `appTemplateDeployWorkflowRequiredContent` pin the workflow lines that matter, with a new `app-workflow-content-missing` failure mode. The webhook guard cannot evaporate silently, and its two-part `env` form is required because the `secrets` context is unavailable in `if`.
6. `vitest.config.ts` became `vitest.config.mts` in `appTemplateRepoOnlyPaths`, ahead of Vite's native config loader becoming the default.

Round 3 (2026-08-29), one change: the contract now imports its two theme constants from the new JSX-free `@hearthkit/ui/ui-contract` subpath, which makes it importable from bare `node`, so `verify:container` reads the contract directly and the hand-written mirror module is deleted. `appVerifyContainerFailedErrorPrefix` moved into this contract as the harness's own error prefix; no failure-union, path-list, or template-behavior change.
