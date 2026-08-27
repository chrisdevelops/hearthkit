# hearthkit status

Updated by the orchestrator after every commit. A fresh session reads this first to resume. Keep it short. History lives in git and `.changeset/`.

## Position

- Phase: 1 (`config` merged, `db` in progress)
- Package: `db`
- Step: commit (PR #2 open, awaiting CI and merge)
- Branch: `pkg/db`
- Last commit: 862aa72 `feat(db): implement @hearthkit/db contract`

## Phase checklist

Phases and their definitions of done are in `docs/PLAN.md` section 11.

- [x] Phase 0: foundation (done directly in the main session, no loop)
- [ ] Phase 1: `config` (merged, PR #1), `db` (PR #2 open)
- [ ] Phase 2: `cli` (db commands, dev, dev infra, doctor)
- [ ] Phase 3: `ui`, `observability`
- [ ] Phase 4: `templates/app`, Dockerfile, project CI workflows
- [ ] Phase 5: `storage`, `email`, `auth`, `payments`
- [ ] Phase 6: `create`
- [ ] Phase 7: `infra/tofu`, `hearthkit vps bootstrap`, backups
- [ ] Phase 8: AI tooling, docs
- [ ] Phase 9: end-to-end verification, tag v1.0.0

## Package loop state

Only the current package is tracked here. Steps: contract, contract-review, gates, gates-review, implement, verify, commit.

| Package | Step      | Implementor rounds | Notes                                                                               |
| ------- | --------- | ------------------ | ----------------------------------------------------------------------------------- |
| db      | commit    | 1                  | 24/24 gates green, typecheck and lint clean (verified by orchestrator); PR #2 open  |

## Open issues

Items that blocked a loop and need a human decision. Remove when resolved.

- none

## Verified facts this session

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
- Root lint uses `--no-error-on-unmatched-pattern` because the workspace has no TS files yet;
  consider removing the flag once Phase 1 lands.
- Root `typecheck` is now only `pnpm -r --if-present run typecheck` (no root tsconfig; there
  are no root TS files).
- Changesets is now 3.0.1 (config schema `@changesets/config@4.0.0`); `changeset init` is
  interactive-only, so `.changeset/config.json` was written by hand from the package's defaults.
- CI actions: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` are current
  majors (v4 triggers a Node 20 deprecation annotation).
