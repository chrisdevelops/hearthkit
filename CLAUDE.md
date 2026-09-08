# hearthkit

Opinionated stack for shipping many small TypeScript web projects. Full plan: `docs/PLAN.md`. Current position: `docs/STATUS.md`. Path to v1.0.0: `docs/COMPLETION-PLAN.md`, one step per session. Read all three before doing anything; each session does exactly one step and stops.

## Guiding rules

1. A project is a Dockerfile plus environment variables. Nothing platform-specific lives in a project repo.
2. Shared code is never copied into projects. It is imported from a versioned `@hearthkit/*` package.
3. Everything runs locally with no cloud accounts, except Stripe test mode and OAuth client IDs.
4. Opinions live in exactly two places: scaffold flags and environment variables.
5. Deferred features are deferred, not prevented. Do not design anything that blocks them.

## Stack

TypeScript, Node 24 LTS, pnpm, Next.js 16, React, Tailwind v4, shadcn, Drizzle 0.45 (stable), Postgres 17, Better Auth 1.7, Resend + React Email, Stripe, Cloudflare R2 (MinIO locally), Vitest, Playwright, Changesets, OpenTofu, Dokploy. Exact versions are pinned in `package.json` files. Do not upgrade without a Changeset and passing gates.

## Repo layout

- `packages/<name>/` — one `@hearthkit/<name>` package each. See `docs/PLAN.md` section 3 for the full tree.
- `templates/app/` — Next.js app template consumed by `@hearthkit/create`.
- `infra/tofu/`, `infra/vps/` — OpenTofu module and VPS shared-service compose files.
- `docs/` — plan, status, contracts, theming, runbooks.
- `.reports/` — gate run output. Git-ignored.

## Package anatomy

Every package has:

- `CONTRACT.md` — plain-language contract: purpose, inputs, outputs, failure modes, dependencies.
- `src/<name>-contract.ts` — Zod schemas for input and output, failure modes as a discriminated union. This is the source of truth the gates and the implementation both derive from.
- `src/*.test.ts` — gates. Integration tests against real services (Postgres, MinIO, Mailpit from `docker-compose.yml` at the repo root). A handful per package, covering every input path and every failure mode. No unit tests unless internal complexity demands one.
- `src/` — implementation.

Dependency graph (packages only depend downward, only through public exports):

```
config, ui              (no deps)
observability, db, storage, email -> config
auth     -> config, db, email
payments -> config, db, auth
```

## Build loop

Work happens one package at a time, in this order. The main session orchestrates. Subagents do the work. See `.claude/skills/next-package/SKILL.md` for the exact procedure.

1. **contract-author** writes `CONTRACT.md` and `*-contract.ts`.
2. Orchestrator reviews the contract against `docs/PLAN.md` section 4. Loop back if it drifts.
3. **gate-writer** writes gates from the contract. Gates must fail against an empty implementation.
4. Orchestrator reviews gates: every input path, every failure mode, real services, no mocks except third-party HTTP that cannot run offline.
5. **implementor** implements the contract until gates pass. Never edits gates or contract files.
6. **gate-runner** runs gates, typecheck, lint; writes output to `.reports/`; returns a pass/fail table.
7. Orchestrator re-runs `pnpm --filter @hearthkit/<name> test`, `pnpm typecheck`, `pnpm lint` itself. A subagent summary is not evidence. Command output is.
8. Orchestrator adds a Changeset, commits on a `pkg/<name>` branch, opens a PR with `gh`, updates `docs/STATUS.md`.

Cap: three implementor rounds on one package without passing gates means the contract, the gates, or the plan is wrong. Stop and report to the user. Do not start a fourth round.

## Ownership

| Role                        | May edit                                                                                 | Must not edit                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| contract-author             | `packages/*/CONTRACT.md`, `packages/*/src/*-contract.ts`                                 | everything else                                                                             |
| gate-writer                 | `packages/*/src/*.test.ts`, `packages/*/test-fixtures/**`, `packages/*/vitest.config.ts` | implementation, contracts                                                                   |
| implementor                 | implementation, package config, docs inside the package                                  | `*.test.ts`, `*-contract.ts`, `CONTRACT.md`, `.claude/**`, `docs/PLAN.md`, `docs/STATUS.md` |
| gate-runner                 | `.reports/**` only                                                                       | everything else                                                                             |
| orchestrator (main session) | `docs/STATUS.md`, `.changeset/**`, git                                                   | package source (delegate instead)                                                           |

If a role believes a file outside its ownership is wrong, it reports that and stops. It does not edit the file.

## Naming and code rules

- No bare-role filenames: `env-schema.ts` not `schema.ts`, `stripe-webhook-handler.ts` not `handlers.ts`. `index.ts` only as a thin named re-export.
- Exported symbols use 2 to 4 words including a domain word: `createProjectDatabase`, not `create`.
- No barrel files. No `export *`. Re-export by name or import from the source module.
- One-line doc comment on every export stating the constraint the signature cannot show, written in plain searchable words.
- Error messages start with a unique literal prefix. No template-built error codes or event names.
- Brand primitive IDs with Zod `.brand<'ProjectName'>()` and similar.
- Model state with discriminated unions, not clusters of nullable fields.
- Tests sit next to the code they test.

## Tooling rules

- `pnpm`, never `npm` or `yarn`.
- Search with `rg`, never `grep`.
- Git via `gh` where possible. No `Co-Authored-By` trailers.
- TypeScript for every script. HCL only inside `infra/tofu/`.
- Do not claim success without command output that shows it.

## Verify before relying on memory

These change often. Check the current docs when a package first touches them: Next 16 standalone output and route handlers; Tailwind v4 `@source` for workspace packages; Better Auth 1.7 Drizzle adapter, organization plugin, Stripe plugin scope; Dokploy 0.30 webhook format and external Docker networks; Cloudflare provider resource names for R2 and API tokens.
