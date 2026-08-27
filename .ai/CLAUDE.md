# hearthkit — AI working context

First draft. This file ships (trimmed) into every generated project so an AI session knows the
stack without reading package source. The full plan lives in `docs/PLAN.md`.

## What this is

An opinionated stack for shipping many small TypeScript web projects: shared `@hearthkit/*`
packages, a `hearthkit` CLI, a `pnpm create @hearthkit` scaffolder, and OpenTofu + VPS
infrastructure.

## Guiding rules

1. A project is a Dockerfile plus environment variables. Nothing platform-specific lives in a project repo.
2. Shared code is never copied into projects. It is imported from a versioned `@hearthkit/*` package.
3. Everything runs locally with no cloud accounts, except Stripe test mode and OAuth client IDs.
4. Opinions live in exactly two places: scaffold flags and environment variables.
5. Deferred features are deferred, not prevented. Do not design anything that blocks them.

## Stack

TypeScript, Node 24 LTS, pnpm, Next.js 16, Tailwind v4 + shadcn, Drizzle 0.45, Postgres 17,
Better Auth 1.7, Resend + React Email, Stripe, R2/MinIO, Vitest, Playwright, Changesets,
OpenTofu, Dokploy. Exact versions are pinned in `package.json` files.

## Packages, one line each

| Package                    | Purpose                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `@hearthkit/config`        | One validated Zod env schema; boot fails naming every bad variable                     |
| `@hearthkit/db`            | Drizzle client, migrations, project database lifecycle (create, drop, backup, restore) |
| `@hearthkit/ui`            | shadcn components, theme tokens as CSS variables, dark mode                            |
| `@hearthkit/observability` | GlitchTip error reporting, pino logging, `/health` route                               |
| `@hearthkit/storage`       | S3-compatible presigned uploads and downloads (R2 in prod, MinIO locally)              |
| `@hearthkit/email`         | React Email templates through a swappable SMTP/Resend transport                        |
| `@hearthkit/auth`          | Better Auth on Drizzle: password, magic link, optional Google/GitHub, optional orgs    |
| `@hearthkit/payments`      | Stripe subscriptions and one-time purchases, webhooks, catalog in code                 |
| `@hearthkit/cli`           | `hearthkit` binary: db, dev, payments sync, infra apply, vps bootstrap, doctor         |
| `@hearthkit/create`        | Scaffolds a new project from `templates/app` with only the chosen packages             |

Dependency graph: `auth -> config, db, email`; `payments -> config, db, auth`;
`db`, `storage`, `email`, `observability -> config`; `config`, `ui` have no deps.

## Where things live

- `packages/<name>/` — one package each: `CONTRACT.md`, `src/<name>-contract.ts` (Zod schemas),
  `src/*.test.ts` (gates against real services), implementation in `src/`.
- `templates/app/` — the Next.js app template the scaffolder copies.
- `infra/tofu/`, `infra/vps/` — Cloudflare OpenTofu module and VPS compose files.
- `docs/` — plan, status, contracts, theming, runbooks.

## Commands

- `pnpm install` / `pnpm lint` / `pnpm typecheck` — workspace checks.
- `pnpm --filter @hearthkit/<name> test` — run one package's gates.
- `pnpm exec changeset` — add a changeset (required for any package change).
- `hearthkit dev` — local compose infra plus `next dev` (Phase 2+).

## Conventions

- Integration gates per package against real local services (Postgres, MinIO, Mailpit). Gates are
  written before implementation and derive from the contract schemas.
- No barrel files, no `export *`. Descriptive multi-word export names and filenames.
- Error messages start with a unique literal prefix so they are greppable.
- `pnpm` never `npm`; `rg` never `grep`; git via `gh`; no `Co-Authored-By` trailers.
