# hearthkit status

Updated by the orchestrator after every commit. A fresh session reads this first to resume. Keep it short. History lives in git and `.changeset/`.

## Position

- Phase: 3 (`ui` merged; `observability` in progress)
- Package: `observability`
- Step: commit (PR open, awaiting merge)
- Branch: pkg/observability
- Last commit: d3e4743 (`@hearthkit/observability` implementation on pkg/observability)

## Phase checklist

Phases and their definitions of done are in `docs/PLAN.md` section 11.

- [x] Phase 0: foundation (done directly in the main session, no loop)
- [x] Phase 1: `config` (merged, PR #1), `db` (merged, PR #2)
- [x] Phase 2: `cli` (merged, PR #3)
- [ ] Phase 3: `ui` (merged, PR #4), `observability`
- [ ] Phase 4: `templates/app`, Dockerfile, project CI workflows
- [ ] Phase 5: `storage`, `email`, `auth`, `payments`
- [ ] Phase 6: `create`
- [ ] Phase 7: `infra/tofu`, `hearthkit vps bootstrap`, backups
- [ ] Phase 8: AI tooling, docs
- [ ] Phase 9: end-to-end verification, tag v1.0.0

## Package loop state

Only the current package is tracked here. Steps: contract, contract-review, gates, gates-review, implement, verify, commit.

| Package         | Step   | Implementor rounds | Notes                                         |
| --------------- | ------ | ------------------ | --------------------------------------------- |
| `observability` | commit | 1                  | 14/14 gates pass after two gate-fixture fixes |

## Open issues

Items that blocked a loop and need a human decision. Remove when resolved.

- none

## Verified facts this session

- `observability` verified 2026-08-28 on pkg/observability: 14/14 gates (real compose
  Postgres for the db-reachability check; in-process node:http Sentry ingest mock), workspace
  typecheck and lint exit 0 (orchestrator-run; gate-runner reports in `.reports/observability-*.txt`).
  Implementor round 1 surfaced two gate-fixture defects (envelope path compared with the
  protocol's auth query string attached; an `import()` type annotation violating
  `consistent-type-imports`) — fixed by gate-writer, no assertion weakened, implementation
  untouched. Known accepted warnings: one `no-unsafe-type-assertion` in
  `create-health-route-handler.ts` caused by `z.input` stripping the `HealthCheckName` brand
  from option types (contract property, unreachable branch for type-correct callers).
- `observability` contract approved 2026-08-28 (orchestrator decisions, user may veto):
  `errorSampleRate` defaults 1, `tracesSampleRate` defaults 0 (conservative = no tracing volume;
  never silently sample out errors); `/health` failed checks expose the first line (max 200
  chars) of the thrown error in all environments (single-maintainer stack; production stripping
  is additive later); error reporting uses module-level singleton state matching the Sentry SDK
  global model, last `initializeErrorReporting` call wins. Health checks are app-wired named
  functions so observability never imports `@hearthkit/db`; the Phase 4 template owns the db
  ping wiring. `flushErrorReporting` added beyond the plan entry (capture is async under the
  hood; gates and graceful shutdown need it).
- `ui` verified 2026-08-28 on merged main (108367b): 23/23 gates (jsdom, no services),
  workspace typecheck and lint exit 0 (orchestrator-run; gate-runner reports in
  `.reports/ui-*.txt`), CI green after a STATUS.md-only prettier fix. Notable implementation
  facts: unified `radix-ui` package (current shadcn registry output) instead of per-primitive
  `@radix-ui/react-*`; `packages/ui/tsconfig.json` deviates from base NodeNext with
  `module: preserve` + `moduleResolution: bundler` (bundler-consumed package; NodeNext
  mis-models `@testing-library/user-event` types); doc comments on shadcn-generated exports
  would be stripped by a future `shadcn add --overwrite` (standing tension, unresolved).
  `docs/theming.md` + shadowed-component example still owed for the Phase 3 DoD.
- `ui` contract approved 2026-08-27 (orchestrator decisions, user may veto): shadcn-generated
  components keep canonical single-word names (`Button`, `Card` …) — renaming would break the
  plan-mandated shadcn-CLI workflow; hearthkit-authored exports follow the 2–4-word rule.
  Component set: button, card, input, label, dialog, dropdown-menu families + `PageContainer`,
  `PageHeader`, theme-mode trio, `mergeTailwindClasses`. `--destructive-foreground` omitted per
  current shadcn vocabulary (additive if needed). `tailwindSourceDirectiveForUi` literal assumes
  `app/globals.css` one level below app root; Phase 4 template must match.
- Phase 2 definition of done verified 2026-08-27 on merged main (7fd2b2d): in a scratch app
  (deps `@hearthkit/db` + Next 16.1.4, no docker-compose.yml), `hearthkit dev` run as bare
  `node .../hearthkit-bin.ts dev` generated the compose file, brought `postgres:17` up healthy,
  and started Next (page served 200). `dev infra down` removed container and network cleanly;
  repo compose restored after, db gates re-verified 24/24.
- `cli` verified 2026-08-27: 25/25 gates pass against compose Postgres 17 + Docker
  (orchestrator-run), workspace typecheck and lint exit 0 (lint warnings only, all in test
  fixtures). Gate-runner reports in `.reports/cli-*.txt`.
- User decision 2026-08-27 (hybrid TS execution): relative import specifiers are written
  `.ts`, not `.js`, in every package; `tsconfig.base.json` adds `allowImportingTsExtensions`,
  `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`. Bare `node` runs any source file
  directly (the `hearthkit` bin is `src/hearthkit-bin.ts`, shebang + executable bit, no
  resolver hook). Verified on Node 24.20.0 + TS 7.0.2, including symlinked workspace packages.
  Constraint (Node policy, all versions through 26): TS in a REAL `node_modules` dir is refused
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so registry installs of Node-executed
  packages (`cli`, later `create`) need a publish-time build (`rewriteRelativeImportExtensions`
  emits clean `.js`) — deferred until publishing starts. Next-consumed packages need no build
  (`transpilePackages`). New relative imports must use `.ts`; typecheck will NOT catch a stray
  `.js` specifier (NodeNext maps it silently) — only bare-node execution or `rg` does.
- `cli` contract approved 2026-08-27 with these defaults: admin URL precedence is
  `--admin-database-url` flag > `HEARTHKIT_ADMIN_DATABASE_URL` env > compose default
  `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`; `db create` prints the
  connection string once, writes nothing; `db drop` has no confirmation prompt (scriptable;
  `--confirm` layer is additive later); generated compose goes to project-root
  `docker-compose.yml`, never overwriting an existing file; MinIO image pinned to the last
  Docker Hub community tag, final choice deferred to Phase 5.
- Phase 1 definition of done verified 2026-08-27: on merged main (886785b), local gates pass
  (config 12/12, db 24/24 against compose Postgres 17) and CI run 33121562483 on main is
  green with a Postgres 17 service container, PGDG `postgresql-client-17` (PATH-prepended —
  the runner's v16 client shadows v17 otherwise), and the workspace test step.
- Root lint flag `--no-error-on-unmatched-pattern` removed after Phase 1 landed; `pnpm lint`
  exits 0 without it.
- `db` contract approved 2026-08-27 with these decisions: admin connection is always an
  explicit `adminDatabaseUrl` parameter, never env; `DATABASE_URL` is always project-scoped;
  `createDrizzleClient` returns `{ drizzleClient, closeDatabaseClient }`; restore requires an
  existing target database (create-then-restore after a drop); credentials are returned once
  in the connection string and never persisted (persistence is future CLI scope).
- User decision 2026-08-27: backup/restore shell out to host `pg_dump`/`pg_restore` in all
  environments. Installed `postgresql@17` (17.11) via brew and force-linked it locally.
  CI must install `postgresql-client-17` and add a Postgres 17 service container plus a test
  step. Phase 7 `hearthkit vps bootstrap` must install `postgresql-client-17` on the VPS.
- Repo-root `docker-compose.yml` created (orchestrator, plan section 6): Postgres 17,
  admin URL `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`. Verified running
  (17.11).
- User decision 2026-08-27: staying with Zod (Valibot/TypeBox considered and rejected —
  server-side only, Better Auth brings Zod transitively anyway). Zod pinned exact 4.4.3
  in `@hearthkit/config`.
- `config` contract defaults accepted: config owns `NODE_ENV` (default `development`);
  empty-string env values are unset; `configEnvSchemaFragment` is passed explicitly,
  never auto-included. Downstream packages and the scaffolder must follow these.

Things checked against current docs that later steps can rely on. Clear when a phase completes.

- Switched to TypeScript 7.0.2 + oxlint 1.80.0 (user decision 2026-08-27), dropping
  eslint/typescript-eslint/jiti. oxlint-tsgolint 7.0.2001 provides type-aware rules
  (no-floating-promises verified working) and is versioned in lockstep with TS 7.
- TS 7 migration facts: `@types/node` is not auto-included — `tsconfig.base.json` sets
  `"types": ["node"]`, so every package must add `@types/node` as a dev dependency. Emit
  requires an explicit `rootDir` in each package tsconfig (error TS5011 otherwise).
  Declaration emit verified working.
- Root `typecheck` is now only `pnpm -r --if-present run typecheck` (no root tsconfig; there
  are no root TS files).
- Changesets is now 3.0.1 (config schema `@changesets/config@4.0.0`); `changeset init` is
  interactive-only, so `.changeset/config.json` was written by hand from the package's defaults.
- CI actions: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` are current
  majors (v4 triggers a Node 20 deprecation annotation).
