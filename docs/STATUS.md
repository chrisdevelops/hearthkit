# hearthkit status

Updated by the orchestrator after every commit. A fresh session reads this first to resume. Keep it short. History lives in git and `.changeset/`.

## Position

- Phase: 4 (`templates/app`, Dockerfile, project CI workflows) — next, not started
- Package: none
- Step: not started
- Branch: main
- Last commit: 1047c7d squash-merge of PR #7 (`ui` cleanup round)

## Phase checklist

Phases and their definitions of done are in `docs/PLAN.md` section 11.

- [x] Phase 0: foundation (done directly in the main session, no loop)
- [x] Phase 1: `config` (merged, PR #1), `db` (merged, PR #2)
- [x] Phase 2: `cli` (merged, PR #3)
- [x] Phase 3: `ui` (merged, PR #4), `observability` (merged, PR #5), `docs/theming.md` + verified shadowed-component example
- [ ] Phase 4: `templates/app`, Dockerfile, project CI workflows
- [ ] Phase 5: `storage`, `email`, `auth`, `payments`
- [ ] Phase 6: `create`
- [ ] Phase 7: `infra/tofu`, `hearthkit vps bootstrap`, backups
- [ ] Phase 8: AI tooling, docs
- [ ] Phase 9: end-to-end verification, tag v1.0.0

## Package loop state

Only the current package is tracked here. Steps: contract, contract-review, gates, gates-review, implement, verify, commit.

| Package | Step | Implementor rounds | Notes                                              |
| ------- | ---- | ------------------ | -------------------------------------------------- |
| —       | —    | 0                  | `ui` cleanup merged (PR #7); Phase 4 not yet begun |

## Open issues

Items that blocked a loop and need a human decision. Remove when resolved.

- none

## Verified facts this session

- `ui` cleanup round completed 2026-08-28 (23/23 gates, workspace typecheck and lint exit 0,
  all orchestrator-run), closing the five gaps the theming-doc work recorded:
  1. `buttonVariants` is now in `hearthkitUiMinimumExportNames` — the only `*Variants` recipe in
     the package, so the rule is "any recipe the fork pattern makes public API is guaranteed".
  2. `packages/ui/components.json` and a `@/*` → `./src/*` alias now ship in the package;
     `shadcn add` writes to `src/components/ui/`. Documented contract surface.
  3. Not fixed, by design: CLI output still needs its class-merge import and `cn` call sites
     fixed by hand, and `--overwrite` still strips doc comments. Stated as accepted tension in
     `packages/ui/CONTRACT.md`; `docs/theming.md` gives the procedure.
  4. `hearthkitThemeCssImportSpecifier` (`'@hearthkit/ui/hearthkit-theme.css'`) is exported and
     guaranteed, so scaffolder, template, and docs stop hardcoding the string.
  5. Closed favourably — no change needed to `tailwindSourceDirectiveForUi`. Tailwind 4.3.3
     `@source` follows pnpm symlinks in BOTH layouts Phase 4 can hit: a `workspace:*` direct
     symlink to the source dir, and the registry-style `.pnpm` virtual-store chain. Verified
     with negative controls in each (removing `@source` dropped the package's utilities while the
     app's own control class still compiled) and through `@tailwindcss/postcss`, byte-identical
     to the CLI, which is the path `templates/app` will actually use. The remaining Phase 4 risk
     on that literal is path depth (`globals.css` one level below app root), not symlink
     resolution.
- Correction to `docs/theming.md` found during the `ui` cleanup round: the tsconfig snippet
  prescribed `baseUrl`, which TypeScript 7 has REMOVED — `error TS5102` fails the workspace
  typecheck (orchestrator-verified against tsc 7.0.2). `paths` alone is what shadcn CLI 4.19.0
  needs; proven with a positive and a negative run. The doc and the package now both omit
  `baseUrl`. Applies to every future tsconfig in this repo, not just `ui`.
- Gate-writing note (2026-08-28): Tailwind escapes arbitrary-value class names in compiled CSS
  (`.tracking-\[0\.31em\]`), so any future gate asserting on compiled CSS must match the escaped
  form or assert on the declaration value instead.
- Phase 3 DoD completed 2026-08-28: `docs/theming.md` written with every example verified live
  in the scratch app (shadowed `IconLeadingButton` rendered beside package `Button`, both bound
  to app token overrides; dropping `@source` shrank compiled CSS 37 KB → 11 KB with utilities
  gone but tokens present — components silently unstyled, not an error; shadcn CLI 4.19.0 run
  against a scratch copy of `packages/ui`).
- Phase 3 DoD scratch-app half verified 2026-08-28 on merged main (7a25800): a scratch Next
  16.1.4 app (file: deps on `ui` + `observability`, `transpilePackages`, ui-contract globals.css
  with `@source`) rendered themed shadcn markup (SSR HTML shows `data-slot="button"` with
  `bg-primary` etc.; compiled CSS defines the hearthkit tokens in `:root` + `.dark` and generates
  the bound utilities) and `/health` returned 200 `{"status":"ok"}` with a REAL `pg` check
  against compose Postgres 17 (85 ms). Phase 3 stays unticked: `docs/theming.md` and the
  shadowed-component example are still owed from the `ui` loop.
  **Phase 4 constraint found:** Next 16.1.4's `next.config.ts` loader needs the installed
  TypeScript's JS API, which `typescript@7.0.2` (tsgo native preview) does not provide
  (`Cannot read properties of undefined (reading 'fileExists')`); `typescript@5.9.3` in the app
  fixed it. `templates/app` must ship TS 5.x (or `next.config.mjs`), not the workspace's TS 7 pin.
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
