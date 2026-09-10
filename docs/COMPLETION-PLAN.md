# hearthkit completion plan

Written 2026-09-07 from the audit of `main` at `f2c26d8` and the decisions confirmed the same day.
`docs/PLAN.md` remains the authority on what hearthkit is. This file is the ordered path from the
current position to `v1.0.0`. Delete it when Phase 9 is ticked.

## Where we are

Phases 0 to 5 are built and merged. On a clean checkout with Docker services up:

| Check                       | Result                                     |
| --------------------------- | ------------------------------------------ |
| `pnpm typecheck`            | pass, 10 projects                          |
| `pnpm lint`                 | pass, 172 warnings                         |
| `pnpm --recursive run test` | 308 gates pass, 0 failed, 0 skipped        |
| Published packages          | none, every package at 0.0.0               |
| Remaining plan phases       | 6 (`create`), 7 (infra), 8 (AI tooling), 9 |

The audit found no deviation from the concept. It found scale drift and a short list of defects:

- Five packages (`observability`, `storage`, `email`, `auth`, `payments`) import `@hearthkit/config`
  at runtime but declare it only under `devDependencies`. Works by workspace hoisting, breaks on
  first published install.
- CI has no changeset check (plan section 10), no Node pin (plan says 24.20.0), no `release.yml`.
- Public export surface is 10 to 30 times the plan's named outputs: auth 113 values, payments 127.
  Third-party error strings and HTTP statuses are exported as contract so gates can assert on them.
- Phase 6 pruning logic lives in `templates/app/src` and is exported for a `create` package that
  does not exist.
- `docs/STATUS.md` is 2095 lines, 93 percent journal, and its position section contradicts itself.
- `.ai/` holds one 65-line file nothing reads; the real tooling is in `.claude/`.
- `payments sync` is missing from the CLI though `payments` has merged.
- `docs/PLAN.md` disagrees with the code in known places (section 6 auth row, Phase 5 DoD, section
  9 location, email signature, health-check wiring).

## Decisions this plan implements

All confirmed 2026-09-07. Rationale is in the audit conversation; the rulings are what matter here.

| Topic         | Ruling                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Sequencing    | Small fixes now. Export refactor after Phase 6 lands, before Phase 7. Then Phases 7 to 9.                               |
| Export policy | Public surface = plan-named outputs, input/output schemas, failure union, env fragment. Gate-only constants → fixtures. |
| Gates         | Keep package gates, cap growth. Delete the template's structural tests when scaffold gates land.                        |
| Pruning logic | Moves to `packages/create`. Template keeps only the section manifest (data).                                            |
| Publishing    | Changesets fixed group. 0.1.0 when `create` lands, 1.0.0 at Phase 9. npm trusted publishing via GitHub OIDC.            |
| Phase 7 shape | One Cloudflare implementation under `infra/tofu/cloudflare/` behind a documented provider interface.                    |
| `create` UX   | Flags first; interactive prompts only as a TTY fallback for missing flags.                                              |
| Agent tooling | `AGENTS.md` is canonical. `CLAUDE.md` imports it. Skills in one shared location. `.ai/` deleted.                        |
| STATUS        | Position only, under 150 lines. Journal moves to `docs/HISTORY.md`. Skill gains a pruning rule.                         |
| Plan          | Revised to Version 2 by the orchestrator, recording every decision here.                                                |
| Build loop    | Kept, with caps: CONTRACT.md under 200 lines, under 20 gates per package, hook loosened to the repo boundary.           |
| Lint          | `no-unsafe-type-assertion` and `no-unnecessary-type-assertion` off for tests and fixtures. Fix the 32 in source.        |
| Repo          | Public at first publish.                                                                                                |

## Ground rules for every step

- One PR per step unless the step says otherwise. Branch names as given.
- Every package change carries a changeset. Every PR is green on the branch head, identified by
  `gh run list --json databaseId,headSha,status` matching `git rev-parse HEAD`.
- The orchestrator re-runs `pnpm --recursive --if-present run test`, `pnpm typecheck` and
  `pnpm lint` itself before merging. Subagent summaries are not evidence.
- Read the test counts, not the exit code. `No projects matched the filters` exits 0 and proves
  nothing. A skipped gate is not a passing gate.
- Steps 1 and 2 are orchestrator work in the main session. Steps 3, 5, 6 and 7 go through the
  `next-package` loop. Steps 4 and 8 are orchestrator work with user runbook steps.

---

## Step 1: hygiene

Branch `chore/hygiene`. No package behaviour changes. One changeset per touched package (patch).

### 1.1 Runtime dependency fix

Move `@hearthkit/config` from `devDependencies` to `dependencies` with `workspace:*` in
`packages/{observability,storage,email,auth,payments}/package.json`. Run
`pnpm install` so the lockfile updates.

Verify: `node -e` over each manifest shows `@hearthkit/config` in `dependencies`; `pnpm install
--frozen-lockfile` exits 0.

### 1.2 Node pin

Add `.nvmrc` containing `24.20.0`. Set `engines.node` to `24.20.0` in root and every package. Set
`node-version-file: .nvmrc` in `.github/workflows/ci.yml` and in
`templates/app/.github/workflows/ci.yml`. Add `.nvmrc` to the template's guaranteed paths.

Verify: `rg '"node": ' --glob package.json` shows one value; CI uses the file.

### 1.3 Changeset check in CI

Add a step to `ci.yml` after install: `pnpm changeset status --since=origin/main`. It fails when
`packages/**` or `templates/**` changed without a changeset. Fetch depth must be 0 for the
comparison; set `fetch-depth: 0` on the checkout step.

Verify: a throwaway branch touching a package file without a changeset goes red on that step.

### 1.4 Changesets fixed group

In `.changeset/config.json`, set `"fixed": [["@hearthkit/*"]]` so every publishable package
versions together. `templates/app` is private and stays out.

Verify: `pnpm changeset status` lists all nine packages moving to the same version.

### 1.5 Lint scoping

In `.oxlintrc.json`, add an override for `**/*.test.ts`, `**/test-fixtures/**`, `**/e2e/**` that
turns off `typescript/no-unsafe-type-assertion` and `typescript/no-unnecessary-type-assertion`. Fix
the 32 source warnings by hand; most are in `packages/config/src/load-hearthkit-config.ts`,
`packages/observability/src/create-health-route-handler.ts` and the branded ID helpers. Where a
cast is genuinely needed, use a Zod parse instead.

Verify: `pnpm lint` reports 0 warnings.

### 1.6 STATUS split

1. Create `docs/HISTORY.md` with a two-line header ("Journal of verified facts and traps, oldest
   at the bottom. Search it; do not read it top to bottom.") and move lines 141 to 2095 of
   `docs/STATUS.md` into it unchanged.
2. Rewrite `docs/STATUS.md` to: Position (phase, package, step, branch, last commit, 10 lines),
   Phase checklist (tick Phase 5 once step 2 merges), Package loop state, Open issues, and a new
   "Traps" section of at most 12 one-line entries linking into `docs/HISTORY.md` by heading. Fix the
   PR #14 contradiction.
3. In `.claude/skills/next-package/SKILL.md` step 4, change "record the result under Verified facts
   this session" to "record the result in `docs/HISTORY.md` and add at most one line to STATUS
   Traps if a new failure shape was found. STATUS stays under 150 lines."

Verify: `wc -l docs/STATUS.md` under 150.

### 1.7 Ownership hook

`.claude/hooks/enforce-file-ownership.sh` blocks writes outside the repo. Loosen it: any path that
does not resolve inside the repo root is allowed for every role, so a gate-writer can prove
satisfiability with a throwaway implementation in the scratchpad. Repo-internal rules unchanged.

Verify: run the hook by hand with a scratchpad path and each role; exit 0.

### 1.8 Loop caps

In the four agent files and `SKILL.md`, add hard caps: `CONTRACT.md` under 200 lines, at most 20
gates per package, at most 3 fixture files per package, public exports limited to the export policy
above. The orchestrator's review step rejects a contract or gate set that exceeds a cap.

### 1.9 `.ai/` removal

Delete `.ai/`. Its content is superseded by step 7.

Definition of done for step 1: all verifications above pass, full gate run still 308 passed
(counts may shift only if step 1.5 rewrote a test), PR merged.

---

## Step 2: plan Version 2

Branch `docs/plan-v2`. Orchestrator edits `docs/PLAN.md` directly, authorized 2026-09-07.

Edits, each a small diff rather than a rewrite:

1. Header: "Version 2. Revised 2026-09-07 after the Phase 5 audit."
2. Section 3 layout: replace `.ai/` with `AGENTS.md`, `CLAUDE.md` and `.claude/`; add
   `docs/HISTORY.md`, `docs/COMPLETION-PLAN.md`; show `infra/tofu/cloudflare/`.
3. Section 4 intro: add the export policy as a rule. Add the loop caps.
4. Section 4.4 observability: health checks are supplied by the app; the template wires a
   `select 1` check when `db` is installed.
5. Section 4.6 email: `sendTransactionalEmail` takes one options object carrying transport config,
   template, props and recipient.
6. Section 4.8 payments: gates run live against Stripe test mode locally and on CI via the
   `STRIPE_SECRET_KEY` secret; they do not skip.
7. Section 4.9 CLI: add `hearthkit infra apply` reads `HEARTHKIT_INFRA_PROVIDER`, accepting only
   `cloudflare` in v1.
8. Section 4.10 create: flags first, prompts as TTY fallback; owns pruning; list the flags.
9. Section 6 table: add the `auth` row (Postgres and Mailpit) and the MinIO bucket-init container.
10. Section 7: CI also runs the changeset check; `release.yml` publishes via trusted publishing;
    fixed version group.
11. Section 8.2: rename to "Infrastructure provider interface". State inputs (project name, zone,
    host IP) and outputs (hostname, storage endpoint, bucket, access key, secret) as the contract;
    Cloudflare is the one implementation.
12. Section 9: rewrite for `AGENTS.md` as canonical with `CLAUDE.md` importing it, skills in one
    shared directory, MCP config in `.mcp.json`; note that exact directories are verified at Phase 8.
13. Section 11 Phase 5 DoD: narrow to the superset per the 2026-09-06 decision; move "render
    conditionally" to Phase 6. Phase 6 DoD adds "0.1.0 published, `pnpm create @hearthkit` works
    from the registry". Phase 7 DoD unchanged. Phase 8 DoD adds "the same skills work from
    opencode".
14. Section 14: strike items already verified (Next standalone, Tailwind `@source`, Better Auth
    adapter and plugins); add npm trusted publishing steps, skills directory conventions, GlitchTip
    MCP availability.

Then in `docs/STATUS.md` tick Phase 5 and delete `docs/phase-5-template-sections.md`.

Definition of done: no statement in `docs/PLAN.md` known to disagree with `main`. Reviewed by
reading every section against the audit findings list at the top of this file.

---

## Step 3: Phase 6, `create`

Branch `pkg/create`, through the loop. Largest remaining package; expect the full three-round cap
to be available and do not spend it on scope.

### 3.1 Contract (contract-author, under 200 lines)

Input: `hearthkitCreateOptions` with `projectName` (branded, kebab-case), `packages`
(`storage | email | auth | payments`, set), `organizations` (boolean, only meaningful with `auth`),
`targetDirectory`, `install` (boolean, default true), `startInfra` (boolean, default true),
`packageVersion` (string, default: the version of `@hearthkit/create` itself), `interactive`
(boolean, default: stdin is a TTY).

Behaviour: resolve dependencies (`auth` pulls `db`, `email`; `payments` pulls `auth`); copy
`templates/app`; prune paths and section blocks; apply the nine scaffold rewrites already declared in
`appTemplateScaffoldRewriteTargets`; write `.env.example`, `docker-compose.yml` via the CLI's
generator, `Dockerfile`, `infra/tofu.tfvars`; run `pnpm install`, `hearthkit dev infra up`,
`hearthkit db create` when `db` is included; print next steps.

Output: the written tree summary and the commands that ran. Failure modes: target exists and is not
empty, invalid project name, unknown package name, `organizations` without `auth`, install failed,
infra up failed.

Interactive path: when a required flag is absent and `interactive` is true, prompt for it. When
absent and not interactive, fail with `create-option-missing`.

### 3.2 Move the pruning logic

Implementor moves `decide-template-path-prune.ts`, `prune-optional-section-blocks.ts` and the
manifest rewrite from `templates/app/src` into `packages/create/src`, keeping the tests that cover
them (`app-template-prune-decision`, `app-template-section-blocks`, `app-template-empty-selection-
project`) by moving them too and pointing them at `create`. `materialize-app-template-project.ts`
becomes a thin call into `create` with `packages: []`. The template keeps
`app-template-contract.ts` as the section manifest.

### 3.3 Template test pruning

Delete from `templates/app/src`: `app-template-tree`, `app-template-package-manifest`,
`app-template-build-config`, `app-workflow-content`, `app-container-image` (the Dockerfile text
half; keep the build-and-poll half inside `verify:container`), `app-template-section-routes`,
`app-template-optional-sections`. Keep: `app-health-route`, `app-runtime-boot`,
`app-payments-webhook-status`, `app-theme-wiring`, `app-contract-bare-node-import`,
`app-template-section-flows`. Target: template under 20 gates.

### 3.4 Scaffold gates (gate-writer)

Three variants per plan 4.10: every package, none, `auth` only with organizations. Each variant
scaffolds into the scratchpad against packed tarballs (the mechanism `verify:container` already
uses), then installs, typechecks, boots, and runs the Playwright smoke plus the flows for its chosen
packages. The empty variant also builds the Dockerfile. Gates are the slowest in the repo; mark them
with a `scaffold` tag and run them in CI in a second job that depends on `checks`.

Plus: `payments sync` in the CLI, calling `syncPaymentsCatalog` from `@hearthkit/payments` with the
project's `payments-catalog.ts`. Two gates: sync a catalog against Stripe test mode, and fail with
`cli-payments-catalog-not-found` when the file is absent.

### 3.5 Definition of done

Three scaffold variants install, boot and pass Playwright locally and on CI. `pnpm --filter
@hearthkit/create test` shows the count. Template gate count under 20. `hearthkit payments sync`
gated. Changesets: minor for `create` (new), patch for `cli`, patch for `app-template`.

---

## Step 4: first release

Branch `chore/release-workflow`, then user runbook, then the release itself.

### 4.1 Workflow

`.github/workflows/release.yml` on push to `main`: checkout with `fetch-depth: 0`, install, run
`changesets/action` with `publish: pnpm changeset publish` and `version: pnpm changeset version`,
permissions `contents: write`, `pull-requests: write`, `id-token: write`. No `NPM_TOKEN`. Node from
`.nvmrc`. Requires npm CLI 11.5 or later on the runner for OIDC; add a step that prints
`npm --version` and asserts it.

Add a `prepublishOnly` guard in each package that fails if `src/index.ts` is missing, since the
packages ship source and nothing else validates the tarball. Add `repository` and `homepage` fields
to every package manifest pointing at the public repo.

### 4.2 User runbook

These require your accounts. Do them in this order.

1. Make the repo public: `gh repo edit chrisdevelops/hearthkit --visibility public --accept-visibility-change-consequences`.
   Before running it, confirm `git log -p | rg -c 'sk_live'` is 0 and that no secret ever landed in
   history. The audit found none in the working tree.
2. Merge the `chore/release-workflow` PR. The changesets action opens a "Version Packages" PR.
3. The first publish of each package cannot use trusted publishing, because the package does not
   exist on npm yet. Run once from your machine, logged in as the scope owner:
   `pnpm changeset version && pnpm changeset publish`. This publishes 0.1.0 for all nine packages.
   Commit the version bump and push.
4. On npmjs.com, for each of the nine packages: Settings → Trusted publishing → add GitHub Actions
   publisher with repository `chrisdevelops/hearthkit`, workflow `release.yml`, environment blank.
   Verify the exact UI path at the time; it changed in 2025.
5. Confirm by pushing an empty changeset (`pnpm changeset --empty`) and checking that the release
   workflow publishes 0.1.1 with no token. If it fails, the fallback is a granular `NPM_TOKEN` secret
   with publish scope, set via `gh secret set NPM_TOKEN`, and `NODE_AUTH_TOKEN` in the workflow.

### 4.3 Definition of done

`pnpm create @hearthkit@0.1.x my-app --packages auth` succeeds from an empty directory with no
workspace present. `npm view @hearthkit/create version` prints the published version.

---

## Step 5: export-surface refactor

One branch per package, in dependency order so downstream packages compile against the trimmed
upstream: `refactor/exports-storage`, `-email`, `-ui`, `-auth`, `-payments`. Each through the loop
with the contract-author revising `CONTRACT.md` first, then gate-writer moving constants, then the
implementor trimming `index.ts`. Each is a minor changeset (breaking within 0.x).

Policy applied to every package:

- `index.ts` exports: the plan's named functions, the env schema fragment, the Drizzle schema
  object where one exists, the input schema, the output schema, the failure union schema, and the
  branded ID schemas an app must construct. Nothing else.
- Third-party error strings, HTTP status constants, per-arm success schemas, minimum-export-name
  lists, subpath lists, and every constant whose only reader is a test move to `test-fixtures/`.
- The `*-contract` subpath export stays only where a downstream package imports it (`auth` uses
  `email-contract`, `payments` uses `auth-contract`); it exports the same trimmed set.
- Doc comments stay on every surviving export.

Targets, measured by counting value exports in `index.ts`:

| Package  | Today | Target                                                                    |
| -------- | ----- | ------------------------------------------------------------------------- |
| storage  | 44    | ≤ 15                                                                      |
| email    | 60    | ≤ 15                                                                      |
| ui       | 59    | ≤ 47 (42 components, hooks and helpers are plan-named; 5 contract values) |
| auth     | 113   | ≤ 30                                                                      |
| payments | 127   | ≤ 30                                                                      |

Definition of done per package: gate count unchanged or lower, every gate still passes, the
template still typechecks and its flows still pass, export count at or under target, CONTRACT.md
under 200 lines (rewrite auth's 1043 and payments' 1304 to the format config uses at 92).

---

## Step 6: Phase 7, infrastructure

Two branches through the loop, plus a real-VPS verification the orchestrator runs with you.

### 6.1 Provider interface and Cloudflare module, branch `infra/tofu-cloudflare`

`infra/tofu/PROVIDER-CONTRACT.md` (under 200 lines): inputs `project_name`, `zone_name`,
`host_ip`; outputs `hostname`, `storage_endpoint`, `storage_bucket`, `storage_access_key_id`,
`storage_secret_access_key`, `dsn_hint`. `infra/tofu/cloudflare/` implements it: DNS A record, R2
bucket, scoped R2 token, CORS rule for presigned browser PUT, state in a dedicated R2 bucket with
OpenTofu state encryption. HCL is allowed here only.

Gates (TypeScript, in `packages/cli`): `tofu validate` and `tofu plan` against the module with a
dummy token succeed; the plan output names exactly the four resources. Applying against a real zone
is the definition of done, not a gate.

CLI: `hearthkit infra apply` reads `HEARTHKIT_INFRA_PROVIDER` (only `cloudflare`), `CLOUDFLARE_API_TOKEN`,
and the project's `infra/tofu.tfvars`, runs `tofu init` and `tofu apply`, and writes the outputs as
the storage variables into `.env.production.example` for the user to copy into Dokploy.

### 6.2 VPS bootstrap and backups, branch `infra/vps-bootstrap`

`infra/vps/docker-compose.yml`: Postgres 17 on the `hearthkit-shared` network with no published
port, GlitchTip, Uptime Kuma. `infra/vps/bootstrap.sh` idempotent. `hearthkit vps bootstrap <host>`
copies the files over SSH and runs the script, then prints admin Postgres details and the two URLs.
Installs Dokploy last. Backup: a systemd timer on the VPS running `hearthkit db backup` for every
database and uploading to R2 with the same S3 client the storage package uses.

Gates: bootstrap against a throwaway `ubuntu:24.04` container with Docker-in-Docker in CI, asserting
the shared network exists and Postgres answers on it. Backup and restore gated against the compose
Postgres and MinIO.

### 6.3 Real verification runbook

You provide: an Ubuntu 24.04 VPS with root SSH, a domain in a Cloudflare zone, a Cloudflare API
token with DNS edit and R2 admin, a Sentry free-tier account.

1. `hearthkit vps bootstrap <host>` from your machine. Save the printed admin connection string.
2. Scaffold a throwaway project with every package, push it to a new public repo.
3. `hearthkit infra apply` in it. Copy the printed variables into a Dokploy application created
   from the GHCR image, attached to `hearthkit-shared`, with a domain matching the DNS record and
   Let's Encrypt on.
4. Merge to main in the throwaway repo; confirm `deploy.yml` builds, pushes and triggers Dokploy.
5. Open the site over HTTPS. Hit a route that throws; confirm the event in GlitchTip.
6. Add the `/health` URL to Uptime Kuma. Add Uptime Kuma's URL to a Sentry uptime monitor. Stop
   Uptime Kuma; confirm the Sentry alert. Start it again.
7. Trigger the backup timer by hand; confirm an object in R2; restore it into a fresh database.

Definition of done: every item above observed, recorded in `docs/HISTORY.md` with timestamps.
`docs/runbooks/deploy.md` and `docs/runbooks/restore.md` written from what actually happened.

---

## Step 7: Phase 8, agent tooling and docs

Branch `docs/agent-tooling`. Orchestrator work, with a subagent per package skill.

Facts to verify first, then record in PLAN section 9: which directories Claude Code, opencode and
Codex read for skills and instructions today, and whether the Agent Skills format is shared. Do not
guess; read each tool's current docs.

Then:

1. `AGENTS.md` at the repo root: stack summary, five rules, one line per package contract, where
   things live, commands. `CLAUDE.md` becomes the repo-specific loop instructions plus a first line
   `@AGENTS.md` so Claude Code reads both.
2. Skills, one per package plus `theming` and `testing-method`, in the shared directory found
   above, each under 80 lines, written from `CONTRACT.md` and the template's usage of the package.
   If two tools need different directories, one is the source and the other is a symlink committed
   to git.
3. `.mcp.json` with Postgres MCP for the local database and GlitchTip MCP if one exists; if it does
   not, record that in PLAN section 14 and leave a Sentry-compatible fallback.
4. `templates/app` gains `AGENTS.md`, the `CLAUDE.md` import line, the skills directory, and
   `.mcp.json`. `create` copies them; `create` also filters skills to the chosen packages.
5. `docs/`: `contracts.md` (one paragraph per package linking its CONTRACT.md), `testing-method.md`,
   the two runbooks from step 6.3, and `theming.md` reviewed against the ui export trim.

Definition of done, the plan's, measured: a fresh Claude Code session and a fresh opencode session,
each in a scaffolded project, add a "send a welcome email on sign-up" feature using `auth` and
`email` without opening `node_modules/@hearthkit`. Record both transcripts' tool calls as evidence.

---

## Step 8: Phase 9, end-to-end and 1.0.0

1. Delete the throwaway project from step 6, scaffold a fresh one, and time the path from
   `pnpm create @hearthkit` to a TLS-served deploy. Criterion 1 is under 30 minutes of human
   attention; log the wall clock and the human steps.
2. Criterion 2: make a one-line fix in a package, release it, run `pnpm up` in the project, confirm
   the fix arrives.
3. Criterion 3: deploy the same image to a second Dokploy application with different env vars only.
4. Criterion 4: already observed in step 6.3; repeat on the fresh project.
5. Criterion 5: `hearthkit dev` on a laptop with no cloud credentials except Stripe test and OAuth;
   every flow passes.
6. Fix whatever misses, through the loop. Then a `major` changeset, merge, and the release workflow
   publishes 1.0.0 for every package. Tag `v1.0.0`.
7. Delete this file. Update STATUS to "released".

---

## Order and dependencies

| Step | Depends on | Why                                                             |
| ---- | ---------- | --------------------------------------------------------------- |
| 1    | nothing    |                                                                 |
| 2    | 1          | STATUS split and `.ai/` removal are referenced by the plan edit |
| 3    | 1, 2       | dependency fix for tarballs; plan defines `create` flags        |
| 4    | 3          | `create` must exist to publish                                  |
| 5    | 4          | trims are breaking; land after 0.1.0, before any consumer       |
| 6    | 4          | a scaffolded project must install real packages                 |
| 7    | 3, 6       | skills copy via `create`; runbooks come from the real deploy    |
| 8    | 5, 6, 7    | everything                                                      |

Steps 5 and 6 are independent of each other and can interleave.

## Things that stop the plan

Report to the user rather than work around:

- Any implementor round that would exceed the three-round cap.
- A gate that cannot be satisfied without exceeding a loop cap.
- npm trusted publishing failing after the runbook, before falling back to a token.
- The VPS or Cloudflare token not being available when step 6.3 is reached. Steps 5 and 7 can
  proceed; step 6.3 waits.
- Any second provider request. That is a v1.1 decision.

## Appendix: running the template's Playwright flows locally

Recorded from the step 1 run on 2026-09-07. Every step that touches the template's e2e specs or
routes must re-run this; the vitest gates do not exercise the flows.

1. Services: `docker compose up -d --wait` at the repo root gives Postgres, MinIO and the shared
   Mailpit. Do not point the flows at that Mailpit: `packages/email`'s gates assert exact message
   counts on it. Start an isolated one:
   `docker run -d --rm --name hk-flows-mailpit -p 1125:1025 -p 8125:8025 axllent/mailpit:v1.31`.
2. Database: `docker compose exec -T postgres createdb -U hearthkit hk_flows_<suffix>`.
3. Bucket: the repo compose has no bucket-init container. Create `hearthkit-app` on MinIO with a
   short `@aws-sdk/client-s3` script from `packages/storage` (endpoint `http://127.0.0.1:9000`,
   credentials `hearthkit`/`hearthkit`, `forcePathStyle: true`).
4. Migrations, from `templates/app` with `DATABASE_URL` set to the new database:
   `pnpm db:generate` then `pnpm exec hearthkit db migrate --migrations-folder ./drizzle`. Delete
   `templates/app/drizzle` afterwards; it is not tracked.
5. Port: `playwright.config.ts` reuses any server already on port 3000 outside CI, and an unrelated
   app on this machine has been found listening there. Build and start on another port yourself,
   then hand Playwright the URL so it starts nothing:
   `PORT=3100 pnpm start` after `pnpm build`, and `SMOKE_TEST_BASE_URL=http://127.0.0.1:3100 pnpm test:e2e`.
6. Environment for both the server and the specs, beyond `DATABASE_URL`: `NODE_ENV=production`,
   the five `STORAGE_*` variables pointing at MinIO and the bucket above, `EMAIL_TRANSPORT=smtp`,
   `EMAIL_FROM`, `EMAIL_SMTP_HOST=127.0.0.1`, `EMAIL_SMTP_PORT=1125`,
   `MAILPIT_API_BASE_URL=http://127.0.0.1:8125`, `AUTH_SECRET` (any long value),
   `AUTH_BASE_URL` equal to the server URL, and `STRIPE_SECRET_KEY` plus `STRIPE_WEBHOOK_SECRET`
   from the git-ignored root `.env`. Without the Stripe key the payments flow skips, and a skipped
   flow is not a passing flow.
7. Expect `6 passed`. Then stop the server, `docker rm -f hk-flows-mailpit`, drop the database, and
   confirm `git status` shows no untracked files under `templates/app`.
