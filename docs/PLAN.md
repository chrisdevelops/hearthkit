# hearthkit implementation plan

Version 2. Revised 2026-09-07 after the Phase 5 audit. Version 1 was based on the confirmed shared understanding of 2026-08-26; the audit findings and the rulings this version records are in `docs/COMPLETION-PLAN.md`.

## 1. What we are building

hearthkit is an opinionated development stack for shipping many small TypeScript web projects quickly. It has four parts:

| Part           | What it is                                                                                     | Where it lives                                    |
| -------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Packages       | Shared, versioned code for database, UI, auth, email, payments, storage, observability, config | `packages/*`, published to npm under `@hearthkit` |
| CLI            | `hearthkit` binary for project operations and VPS bootstrap                                    | `packages/cli`                                    |
| Scaffolder     | `pnpm create @hearthkit` generates a new project                                               | `packages/create`                                 |
| Infrastructure | OpenTofu module, shared-service compose files, VPS bootstrap, CI workflows                     | `infra/*`, `.github/*`                            |

Guiding rules that every decision below follows:

1. A project is a Dockerfile plus environment variables. Nothing platform-specific lives in a project repo.
2. Shared code is never copied into projects. It is imported from a versioned package so fixes propagate with `pnpm up`.
3. Everything runs locally with no cloud accounts, with two exceptions: Stripe test mode and OAuth client IDs.
4. Opinions live in exactly two places: scaffold flags and environment variables.
5. Deferred features are deferred, not prevented. Nothing is designed in a way that blocks them later.

## 2. Confirmed stack and versions

| Layer           | Choice                                             | Version at time of writing            |
| --------------- | -------------------------------------------------- | ------------------------------------- |
| Language        | TypeScript                                         | latest stable                         |
| Runtime         | Node LTS                                           | 24.20.0                               |
| Package manager | pnpm                                               | latest stable                         |
| Framework       | Next.js                                            | 16.3.3                                |
| Styling         | Tailwind v4, shadcn                                | latest                                |
| ORM             | Drizzle                                            | 0.45.2 stable. Upgrade to 1.0 when GA |
| Auth            | Better Auth                                        | 1.7.2                                 |
| Email           | Resend + React Email                               | latest                                |
| Payments        | Stripe                                             | latest SDK                            |
| Database        | PostgreSQL                                         | 17, official image                    |
| Storage         | Cloudflare R2, MinIO locally                       | n/a                                   |
| Deploy          | Dokploy on Ubuntu VPS                              | 0.30.2                                |
| Errors          | GlitchTip self-hosted                              | latest                                |
| Uptime          | Uptime Kuma self-hosted, Sentry free tier external | latest                                |
| Cloud           | OpenTofu, Cloudflare provider                      | latest                                |
| Testing         | Vitest, Playwright                                 | latest                                |
| Releases        | Changesets                                         | latest                                |

Pin exact versions in the repo. Renovate or a scheduled workflow proposes updates; gate tests decide whether they merge.

## 3. Repository layout

```
hearthkit/
  packages/
    config/           @hearthkit/config
    db/               @hearthkit/db
    ui/               @hearthkit/ui
    observability/    @hearthkit/observability
    auth/             @hearthkit/auth
    email/            @hearthkit/email
    payments/         @hearthkit/payments
    storage/          @hearthkit/storage
    cli/              @hearthkit/cli        (bin: hearthkit)
    create/           @hearthkit/create     (pnpm create @hearthkit)
  templates/
    app/              Next.js app template consumed by create
  infra/
    tofu/             Provider interface (PROVIDER-CONTRACT.md) and its implementations
      cloudflare/     The one v1 implementation: Cloudflare DNS, R2, token, CORS
    vps/              Shared-service compose files and bootstrap assets
  docs/
    PLAN.md           This file: what hearthkit is
    STATUS.md         Current position only, under 150 lines
    HISTORY.md        Journal of verified facts and traps; searched, not read
    COMPLETION-PLAN.md  Ordered path to v1.0.0; deleted at Phase 9
    theming.md, contracts, runbooks
  AGENTS.md           Canonical agent instructions (section 9)
  CLAUDE.md           Imports AGENTS.md, adds the build-loop rules for Claude Code
  .claude/            Agents, hooks and skills the build loop uses
  .changeset/
  .github/workflows/
  pnpm-workspace.yaml
  package.json
```

Naming rules for every file and export follow the write-discoverable-code skill. In short:

- No bare-role filenames. `env-schema.ts` not `schema.ts`, `stripe-webhook-handler.ts` not `handlers.ts`.
- Exported symbols use 2 to 4 words with a domain word. `createProjectDatabase`, not `create`.
- No barrel files and no `export *`. Re-export by name or import from the source module.
- Error messages start with a unique literal prefix.
- Tests sit next to the code they test.

## 4. Package contracts

Each package is a black box with a defined input, output, and failure modes. Integration tests ("gates") exercise the public contract against real dependencies. There are a handful per package, not hundreds. Gates are written before implementation.

Export policy: a package's public surface is the outputs named in its contract below, its input and output schemas, its failure union, its `envSchemaFragment`, the Drizzle schema object where one exists, and the branded ID schemas an app must construct. Nothing else leaves `index.ts`. Third-party error strings, HTTP status constants and every constant whose only reader is a gate live in `test-fixtures/`.

Loop caps, checked at the orchestrator's review steps: `CONTRACT.md` under 200 lines, at most 20 gates and 3 fixture files per package, exports limited to the policy above. A contract or gate set over a cap is rejected. Packages merged before this version exceed the caps and are trimmed by the export-surface refactor in `docs/COMPLETION-PLAN.md` step 5.

Dependency graph, used by the scaffolder:

```
config   (no deps)
ui       (no deps)
observability -> config
db       -> config
storage  -> config
email    -> config
auth     -> config, db, email
payments -> config, db, auth
```

Choosing `auth` pulls in `db` and `email`. Choosing `payments` pulls in `auth`. The scaffolder enforces this without asking.

### 4.1 `@hearthkit/config` (required)

Purpose: one validated schema for all environment variables, shared by local and production.

- Input: `process.env` plus a per-package schema fragment contributed by each installed package.
- Output: a typed, frozen config object. Boot fails with a message naming every missing or invalid variable.
- Failure modes: missing required variable, wrong type, invalid URL.
- Gates: valid env resolves; missing variable fails with the variable name in the message; optional package fragments are only required when that package is installed.
- Notes: implemented with Zod. Every other package exports an `envSchemaFragment` that `config` composes.

### 4.2 `@hearthkit/db` (optional, pulled in by auth and payments)

Purpose: Drizzle client, migration runner, and project-database lifecycle.

- Input: `DATABASE_URL`.
- Output: a typed Drizzle client, plus functions `createProjectDatabase`, `dropProjectDatabase`, `backupProjectDatabase`, `restoreProjectDatabase`, `runDatabaseMigrations`.
- Failure modes: unreachable server, database already exists, insufficient privileges, migration conflict.
- Gates: against a real Postgres container. Create a database and role, connect with the scoped role, confirm the role cannot see other databases, run migrations, back up, drop, restore, verify data.
- Notes: `createProjectDatabase` creates both a database and a role scoped to it, and returns the connection string. The same function serves local and VPS; only the admin connection differs.

### 4.3 `@hearthkit/ui` (required)

Purpose: shadcn components, base theme, layout primitives, light and dark mode.

- Input: none at runtime. Apps import components and a base CSS file.
- Output: React components, `hearthkit-theme.css` defining all tokens as CSS variables.
- Failure modes: not applicable at runtime. Build-time type errors are the contract.
- Gates: components render in a Vitest browser or jsdom environment; theme token overrides in a test CSS file change computed styles; dark mode toggle switches the class.
- Theming rules (documented in `docs/theming.md`):
  1. Apps customize by overriding CSS variables in their own `globals.css`. Never edit package component files from an app.
  2. Apps must include `@source` pointing at the `ui` package so Tailwind scans its classes.
  3. When a structural change is needed, copy that single component into the app and import it locally. This is the only case where component code lives in an app.
  4. New components are added to the package via the shadcn CLI, then published.

### 4.4 `@hearthkit/observability` (default on, opt-out)

Purpose: error reporting to GlitchTip, structured logging, health endpoint.

- Input: optional `GLITCHTIP_DSN`, `LOG_LEVEL`.
- Output: initialized Sentry-compatible SDK, a pino logger, a `/health` route handler for Next.js.
- Failure modes: none fatal. Without a DSN, error reporting is a no-op and logs go to stdout.
- Gates: with no DSN, `captureError` does not throw; with a DSN pointed at a local mock endpoint, an event is sent; `/health` returns 200 with no checks registered and 503 when a registered check throws or times out.
- Notes: SDK sample rates are set conservatively by default to prevent a runaway loop filling GlitchTip's disk. Health checks are supplied by the app, not the package: `createHealthRouteHandler` takes a list of named checks and knows nothing about `db`. The template's `app-health-checks.ts` registers a one-round-trip database check inside its `auth` section, because `auth` is what brings `db` into a template project; a project that adds another dependency appends a check there.

### 4.5 `@hearthkit/storage` (optional)

Purpose: S3-compatible object storage with presigned uploads.

- Input: `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`.
- Output: `createPresignedUploadUrl`, `createPresignedDownloadUrl`, `deleteStoredObject`, `listStoredObjects`.
- Failure modes: bucket missing, credentials rejected, object not found.
- Gates: against MinIO in compose. Presign an upload, PUT a file with plain fetch, presign a download, GET it back, delete it, confirm it is gone.
- Notes: the server never handles file bytes. R2 and MinIO both speak S3, so the only difference is the endpoint.

### 4.6 `@hearthkit/email` (optional)

Purpose: send transactional email from React Email templates through a swappable transport.

- Input: `EMAIL_TRANSPORT` = `smtp` or `resend`, plus transport credentials. `EMAIL_FROM`.
- Output: `sendTransactionalEmail(options)`, where the one options object carries the transport config, the template, its props, the recipient and an optional subject override; template components.
- Failure modes: transport rejects, template render error, invalid recipient.
- Gates: against Mailpit in compose. Send a template, query Mailpit's API, confirm subject and body. Resend transport is covered by a contract test with a mocked HTTP layer only, since it cannot run offline.

### 4.7 `@hearthkit/auth` (optional)

Purpose: Better Auth wired to Drizzle and the email package.

- Input: `AUTH_SECRET`, `AUTH_BASE_URL`, optional `GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`. Scaffold flag `organizations: true | false`.
- Output: server auth instance, Next.js route handler, client hooks, session helpers, Drizzle schema for auth tables.
- Methods enabled: email and password, magic link. Google and GitHub enabled only when their IDs are set.
- Failure modes: invalid credentials, expired magic link, missing OAuth config when a provider is requested.
- Gates: against Postgres and Mailpit. Sign up with password, sign in, request magic link, read it from Mailpit, complete sign in, read session. With `organizations: true`, create an org and add a member.
- Notes: the package supports both user-scoped and org-scoped modes from the start. The scaffold flag only selects which one a project uses, because changing it later changes the data model.

### 4.8 `@hearthkit/payments` (optional)

Purpose: Stripe subscriptions and one-time purchases, webhooks, hosted customer portal, products defined in code.

- Input: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, a `payments-catalog.ts` file in the app defining products and prices.
- Output: `createCheckoutSession`, `createCustomerPortalSession`, `handleStripeWebhook`, `syncPaymentsCatalog`, Drizzle schema for customers, subscriptions, and purchases.
- Failure modes: webhook signature mismatch, unknown price, customer not found.
- Gates: against Stripe test mode over the Stripe SDK. Sync a catalog, confirm prices exist in Stripe, create a checkout session, post a locally signed `checkout.session.completed` event through the webhook handler, confirm the subscription row exists. The live gates read `STRIPE_SECRET_KEY` locally and, on CI, from the repository secret; they refuse a live-mode key. Without the key they report as skipped, and a run with a skip segment is not a passing run: the merge criterion is every gate passed, none skipped.
- Notes: billing scope (user or org) follows the `auth` scaffold flag. Better Auth's Stripe plugin covers subscriptions only (verified 2026-09-06 against the installed package), so one-time purchases are implemented directly with the Stripe SDK.

### 4.9 `@hearthkit/cli` (bin `hearthkit`)

Purpose: the single entry point for project and VPS operations. Commands are thin and call into the package that owns the logic.

```
hearthkit db create <name>       creates database and role, prints DATABASE_URL
hearthkit db drop <name>
hearthkit db migrate
hearthkit db backup <name>
hearthkit db restore <name> <file>
hearthkit dev                    starts local compose infra then next dev
hearthkit dev infra up|down      compose infra only
hearthkit payments sync          syncs catalog to Stripe
hearthkit infra apply            runs tofu apply for this project
hearthkit vps bootstrap <host>   provisions a fresh Ubuntu VPS
hearthkit doctor                 checks env, Docker, versions, connectivity
```

- Gates: each command runs end to end against local compose. `vps bootstrap` is gated in CI against a throwaway Ubuntu container.
- `infra apply` reads `HEARTHKIT_INFRA_PROVIDER` and accepts only `cloudflare` in v1. Any other value fails before OpenTofu runs. The provider interface is in section 8.2.

### 4.10 `@hearthkit/create`

Purpose: scaffold a new project.

Flags first. Every option is a flag, so a script or an agent can scaffold without a terminal. Interactive prompts exist only as a fallback: when a required flag is absent and stdin is a TTY, `create` prompts for it; when absent and not a TTY, it fails with `create-option-missing`.

| Flag                 | Meaning                                                              | Default                                         |
| -------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| `<project-name>`     | Positional. Kebab-case, branded                                      | required                                        |
| `--packages`         | Optional packages to include: `storage`, `email`, `auth`, `payments` | required (prompted, or `create-option-missing`) |
| `--organizations`    | Enable Better Auth organizations. Only meaningful with `auth`        | `false`                                         |
| `--target-directory` | Where to write the project                                           | `./<project-name>`                              |
| `--no-install`       | Skip `pnpm install`                                                  | install runs                                    |
| `--no-start-infra`   | Skip `hearthkit dev infra up` and `hearthkit db create`              | infra starts                                    |
| `--package-version`  | `@hearthkit/*` version written into `package.json`                   | the version of `@hearthkit/create`              |
| `--interactive`      | Force prompts on or off                                              | on when stdin is a TTY                          |

Steps:

1. Resolve dependencies without asking: `auth` pulls `db` and `email`; `payments` pulls `auth`. Reject `--organizations` without `auth` and any unknown package name.
2. Copy `templates/app`. Prune the paths and the `hearthkit-section` blocks that belong to packages not chosen, and apply the scaffold rewrites the template's manifest declares (`appTemplateScaffoldRewriteTargets`). The pruning logic lives in `packages/create`; the template keeps only the section manifest, as data, in `app-template-contract.ts`.
3. Write `.env.example`, `docker-compose.yml` through the CLI's generator with only the needed services, `Dockerfile`, and `infra/tofu.tfvars` with the project name.
4. Run `pnpm install`, `hearthkit dev infra up`, `hearthkit db create <name>` if `db` is included, and print next steps.

- Output: the written tree and the commands that ran.
- Failure modes: target exists and is not empty, invalid project name, unknown package name, `organizations` without `auth`, a required option missing outside a TTY, install failed, infra up failed.
- Gates: scaffold with every package, with none, and with `auth` only plus organizations; each result installs, typechecks, boots, and passes its Playwright smoke test and the flows for its chosen packages.

## 5. App template

`templates/app` is a Next.js App Router project wired to `config` and `ui`, with conditional sections for each optional package.

- Dockerfile: multi-stage, Node 24, `output: 'standalone'`, non-root user, `/health` used as the container healthcheck.
- Playwright: one smoke test always (home page renders, health returns 200), plus one flow per optional package (sign in, upload a file, complete test checkout).
- `docs/` inside the template: a short README pointing to hearthkit docs, and the theming rules.

## 6. Local development

`hearthkit dev` starts compose infrastructure and then `next dev` on the host. Compose contains only what the chosen packages need:

| Service                 | Included when | Purpose                                                           |
| ----------------------- | ------------- | ----------------------------------------------------------------- |
| Postgres 17             | `db`          | Local database server                                             |
| MinIO                   | `storage`     | S3 stand-in                                                       |
| MinIO bucket init       | `storage`     | One-shot `minio-init` container that creates the project's bucket |
| Mailpit                 | `email`       | SMTP catcher with web UI and API                                  |
| Postgres 17 and Mailpit | `auth`        | Pulled in through `db` and `email`; sign-in and magic-link flows  |

Stripe uses `stripe listen` from the official CLI to forward webhooks. Observability is a no-op without a DSN. OAuth needs real client IDs; password and magic link do not.

## 7. CI and releases

Workflows in the hearthkit repo:

| Workflow      | Trigger       | Steps                                                                                                                                            |
| ------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ci.yml`      | pull request  | pnpm install, changeset check, lint, typecheck, package gates with services as GitHub Actions service containers, scaffold gates in a second job |
| `release.yml` | merge to main | Changesets version PR, then publish to npm through trusted publishing (GitHub OIDC, no long-lived token)                                         |

Workflows written into each generated project:

| Workflow     | Trigger       | Steps                                                                                   |
| ------------ | ------------- | --------------------------------------------------------------------------------------- |
| `ci.yml`     | pull request  | lint, typecheck, Playwright smoke                                                       |
| `deploy.yml` | merge to main | build image, push to GHCR tagged with git SHA and `latest`, call Dokploy deploy webhook |

Rollback is redeploying a previous SHA tag from Dokploy.

Both repos read Node from `.nvmrc`. The changeset check (`pnpm changeset status --since=origin/main`) fails a PR that changes `packages/**` or `templates/**` without a changeset. Every `@hearthkit/*` package is in one Changesets fixed group and moves to the same version; `templates/app` is private and excluded. The first publish is 0.1.0 when `create` lands, and 1.0.0 at Phase 9.

## 8. Infrastructure

### 8.1 VPS bootstrap

`hearthkit vps bootstrap <host>` over SSH:

1. Install Docker and Compose.
2. Create a shared Docker network `hearthkit-shared`.
3. Start shared services from `infra/vps/`: Postgres 17 (not exposed publicly, on the shared network), GlitchTip, Uptime Kuma.
4. Install Dokploy for app deployments only.
5. Print the admin Postgres connection details and the GlitchTip and Uptime Kuma URLs.

Shared services are plain compose, run outside Dokploy, so Dokploy can be replaced without touching the database. Dokploy-deployed apps join `hearthkit-shared` so they reach Postgres by container name.

Backups: a scheduled job on the VPS runs `hearthkit db backup` for every database and uploads to an R2 bucket. Restore is tested as part of the initial bootstrap verification.

### 8.2 Infrastructure provider interface

`infra/tofu/PROVIDER-CONTRACT.md` defines the contract every provider implements. The CLI and the generated project depend on the contract, not on a provider.

- Inputs: `project_name`, `zone_name`, `host_ip`.
- Outputs: `hostname`, `storage_endpoint`, `storage_bucket`, `storage_access_key_id`, `storage_secret_access_key`, `dsn_hint`.

`infra/tofu/cloudflare/` is the one implementation in v1, selected by `HEARTHKIT_INFRA_PROVIDER=cloudflare`. It creates:

- A DNS record pointing the project's hostname at the VPS.
- An R2 bucket named after the project.
- A scoped R2 API token, output as the storage credentials.
- CORS rules on the bucket for presigned browser uploads.

State stored in an R2 bucket dedicated to OpenTofu state, encrypted with OpenTofu's state encryption. HCL is allowed only under `infra/tofu/`. A second provider is a v1.1 decision; the interface is what keeps it open.

### 8.3 Monitoring

- Every app reports errors to the VPS GlitchTip via its DSN.
- Uptime Kuma checks every app's `/health`.
- One Sentry free-tier uptime monitor checks Uptime Kuma's URL, so a VPS outage still alerts.

## 9. AI tooling

In the hearthkit repo and, trimmed to the chosen packages by `create`, in each generated project:

- `AGENTS.md` at the root is canonical and tool-neutral: stack summary, the five guiding rules, package contracts in one line each, where things live, commands.
- `CLAUDE.md` imports it with a first line `@AGENTS.md` and adds only what is specific to Claude Code (in this repo, the build loop).
- Skills: one per package describing how to use it correctly, plus theming rules and the testing method, each under 80 lines, in one shared directory read by every supported tool. If two tools need different directories, one is the source and the other a symlink committed to git.
- `.mcp.json`: Postgres MCP for local database inspection, and GlitchTip's MCP server for reading production errors if one exists (section 14).

The exact directories each tool reads (Claude Code, opencode, Codex) are verified at Phase 8, from each tool's current docs, and recorded here then.

## 10. Conventions

- Tests: integration gates per package against real dependencies. No unit tests unless a package's internals demand one. Gates written from the input/output schema before implementation.
- Changesets: any PR touching a package adds a changeset. CI blocks merge without one when package files changed.
- Versions: exact pins. Updates arrive as PRs that must pass gates.
- Commits: no `Co-Authored-By` trailers. Use `gh` for repo operations.

## 11. Phased implementation

Each phase ends with a verifiable definition of done. Do not start the next phase until the current one's checks pass.

### Phase 0: foundation

- Register `@hearthkit` npm scope (done).
- Create the repo, pnpm workspaces, TypeScript base config, oxlint (chosen over ESLint 2026-08-27 to unblock TypeScript 7), Prettier, Changesets, a first `CLAUDE.md` draft (then under `.ai/`, since removed).
- Done when: `pnpm install`, `pnpm lint`, `pnpm typecheck` succeed on an empty workspace and CI runs green.

### Phase 1: config and db

- `config` gates then implementation.
- `db` gates against Postgres then implementation, including create, drop, backup, restore, migrate.
- Done when: gates pass locally and in CI with a Postgres service container.

### Phase 2: cli and local dev

- `cli` with `db *`, `dev`, `dev infra`, `doctor`.
- Compose generation for the local infra set.
- Done when: `hearthkit dev` on a scratch app brings up Postgres and starts Next.

### Phase 3: ui and observability

- `ui` with shadcn install, theme tokens, dark mode, theming docs, one shadowed-component example.
- `observability` with no-op mode, pino, `/health`.
- Done when: gates pass; a scratch app renders themed components and `/health` returns 200.

### Phase 4: app template, Dockerfile, CI

- `templates/app` wired to the required packages.
- Dockerfile builds and runs; Playwright smoke passes against the container.
- Project `ci.yml` and `deploy.yml` written and tested against a throwaway repo.
- Done when: an image builds in CI and runs with `/health` green.

### Phase 5: optional packages

Order: `storage`, `email`, `auth`, `payments`. Each gates-first. `auth` supports both user and org mode from the start.

- Done when: each package's gates pass against compose (Stripe against test mode), and the template, as the superset, carries a section and a Playwright flow per optional package and both pass. Rendering the sections conditionally is Phase 6, proven by the three scaffold variants (decision of 2026-09-06).

### Phase 6: scaffolder

- `create` with package selection, dependency resolution, compose and Dockerfile generation, tfvars.
- Done when: the three scaffold gate variants install, boot, and pass Playwright; 0.1.0 is published; `pnpm create @hearthkit` works from the registry.

### Phase 7: cloud and VPS

- OpenTofu module with Cloudflare DNS, R2, token, CORS, encrypted state.
- `vps bootstrap` with shared services and Dokploy.
- Backup job to R2 and a verified restore.
- Done when: a real VPS is bootstrapped, a scaffolded project is deployed via Dokploy with TLS on a real domain, an error appears in GlitchTip, and stopping Uptime Kuma triggers a Sentry alert.

### Phase 8: AI tooling and docs

- Skills per package, MCP config, project-level CLAUDE.md template.
- `docs/` filled: contracts, theming, testing method, deploy runbook, restore runbook.
- Done when: a fresh Claude Code session in a scaffolded project can add a feature using a package without reading package source, and the same skills work from opencode.

### Phase 9: end-to-end verification

- Scaffold a throwaway project and measure against the success criteria in section 12.
- Fix whatever misses, then tag `v1.0.0` across all packages.

## 12. Success criteria

1. A new project scaffolds, runs locally, passes its gates, and deploys to the VPS with a custom domain and TLS in under 30 minutes of human attention.
2. A bug fix in a package reaches an existing project via one version bump and one `pnpm up`.
3. The same project image deploys to a second host by changing env vars only.
4. An error in production appears in GlitchTip. A VPS outage triggers a Sentry alert.
5. A project runs end to end on a laptop with no cloud accounts, except Stripe test mode and OAuth.

## 13. Deferred, and how the design keeps them open

| Deferred                    | What keeps it open                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------- |
| Preview environments per PR | `db create` and the tofu module already take a name; a preview is a name with a suffix |
| Usage-based billing         | `payments` stores subscription state; metering is an additive table and webhook        |
| Passkeys                    | Better Auth plugin; add to the methods list                                            |
| Secrets manager             | `config` reads `process.env`; a manager just populates it                              |
| Postgres per project        | `DATABASE_URL` is the only coupling                                                    |
| Second VPS or multi-region  | Shared services are plain compose; bootstrap takes a host argument                     |
| Org billing per project     | Supported in packages now; flag at scaffold time                                       |

## 14. Verify at build time

Facts to confirm when each phase starts, since they can change:

- Drizzle 1.0 GA date; migration path from 0.45.
- Dokploy 0.30 deploy webhook format and how to attach a service to an external Docker network. The webhook call in `deploy.yml` is untested until Phase 7.
- npm trusted publishing: the exact npmjs.com steps to add a GitHub Actions publisher per package, and the npm CLI version the runner needs for OIDC (11.5 or later at time of writing). The first publish of a new package cannot use it and runs from a maintainer's machine.
- Skills directory conventions: which directories Claude Code, opencode and Codex read for skills and instructions, and whether the Agent Skills format is shared.
- Whether a GlitchTip MCP server exists; if not, record that here and use a Sentry-compatible fallback.
- Cloudflare provider resource names for R2 buckets and scoped tokens in the current OpenTofu registry.

Verified and struck from this list: Next 16 standalone output and route handlers (Phase 4), Tailwind v4 `@source` for a workspace package (Phase 3), Better Auth 1.7 Drizzle adapter and organization plugin (Phase 5), Stripe plugin scope (subscriptions only, 2026-09-06). `docs/HISTORY.md` holds the evidence.

## 15. Risks and mitigations

| Risk                                             | Mitigation                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Postgres major upgrade hits all projects at once | Backup job plus tested restore; upgrade runbook in docs; schedule during low traffic |
| Next.js churn breaks the template                | Exact pins; scaffold gates catch breakage before publish                             |
| GlitchTip shares the VPS failure domain          | Sentry external check                                                                |
| Runaway error loop fills disk                    | Conservative SDK sample rates; disk alert in Uptime Kuma                             |
| Package boundaries drawn wrong early             | Contracts documented before code; gates make redraws safe to attempt                 |
| Single maintainer                                | Docs and AI tooling are first-class deliverables, not afterthoughts                  |
