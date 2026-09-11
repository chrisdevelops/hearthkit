Read CLAUDE.md, docs/STATUS.md and docs/COMPLETION-PLAN.md, then do step 6.2 only: branch `infra/vps-bootstrap` from an up-to-date main, through the next-package loop with the role mapping below. Stop after the PR is green and merged and STATUS is updated. Do not start 6.3 or step 7. Delete docs/next-session-vps.md in the same PR; it is this brief and nothing else reads it.

## One question for the user, asked once, before any subagent runs

At the end of the 6.1 session the orchestrator proposed four cuts to shorten the remaining path. The user has not ruled on them. Ask all four in one message, recommend accepting all four, and write the accepted ones into docs/COMPLETION-PLAN.md in this PR:

1. Run 6.2 with a collapsed loop: the orchestrator writes the contract itself (one contract-author round at most, for review), one implementor, one gate-runner. A compose file and a shell script do not need four roles.
2. Do 6.3 and step 8 in one sitting on the same VPS; both deploy a throwaway project to a real host.
3. Step 7's definition of done drops to one fresh agent session (Claude Code), not two.
4. Skip the template Playwright re-run when a step changes no route and no spec under `templates/app`.

If the user declines cut 1, run the full loop as CLAUDE.md describes.

## What 6.2 builds (plan section 8, lines 293 to 303, and COMPLETION-PLAN 6.2)

- `infra/vps/docker-compose.yml`: Postgres 17 on an external Docker network `hearthkit-shared` with no published port, GlitchTip, Uptime Kuma. Plain compose, outside Dokploy, so Dokploy can be replaced without touching the database.
- `infra/vps/bootstrap.sh`: idempotent. Installs Docker, creates the network, starts the shared services, installs Dokploy last, prints the admin Postgres connection details and the two URLs.
- `hearthkit vps bootstrap <host>`: copies `infra/vps/` over SSH and runs the script, prints what the script prints. Ships in the cli tarball the way `tofu/cloudflare` does (`files` in packages/cli/package.json).
- Backups: a systemd timer on the VPS runs `hearthkit db backup` for every project database and uploads each archive to R2 with the same S3 client `@hearthkit/storage` uses. The plan does not name the command that does "every database, then upload"; the contract decides (a `hearthkit vps backup` command, or a script the timer calls). Restore is `hearthkit db restore <name> <file>`, which exists.

## Gates (plan 6.2)

1. Bootstrap against a throwaway `ubuntu:24.04` container with Docker-in-Docker in CI: after `bootstrap.sh`, the `hearthkit-shared` network exists and Postgres answers on it. Decide in the contract whether the gate reaches the container over SSH (needs sshd in the image) or by `docker exec`; `docker exec` is simpler and proves the same script.
2. Backup and restore against the compose Postgres and MinIO at the repo root: back up a seeded database, upload to a MinIO bucket, download, restore into a fresh database, assert the rows.

## Role mapping

- contract-author: `infra/vps/VPS-CONTRACT.md` (under 200 lines, packages/config/CONTRACT.md format) and the additive amendments to packages/cli/CONTRACT.md and packages/cli/src/cli-contract.ts (`vps bootstrap <host>`, the backup command, env-variable-name constants, success results, failure kinds with unique literal prefixes). The ownership hook at .claude/hooks/enforce-file-ownership.sh allows `infra/tofu/PROVIDER-CONTRACT.md` by name only; before dispatching, widen both the contract-author allow line and the implementor block line to `infra/*/*-CONTRACT.md` and say so in the PR body.
- gate-writer: gates in `packages/cli/src/*.test.ts` and fixtures in `packages/cli/test-fixtures/`.
- implementor: `infra/vps/*` (or `packages/cli/vps/*` if the contract puts the shipped copy there, mirroring `tofu/`), the two cli commands, the systemd unit files, `.github/workflows/ci.yml` for the Docker-in-Docker job. The orchestrator reviews the ci.yml diff line by line.
- gate-runner and the orchestrator run cli; `create` and the template only if `create` changes.

## Facts to carry over, verified during the 6.1 session on 2026-09-11

- Every `@hearthkit/*` package is at 0.5.0 on npm (PR #37). The fixed group versions together; this step's Version Packages PR bumps everything to 0.6.0. Do not merge that PR; the user does. `npm view` can lag the release log by three minutes.
- `packages/db` exports `backupProjectDatabase` and `restoreProjectDatabase` (pg_dump custom format; failure kinds `backup-file-*`, `postgres-tool-missing`). `hearthkit db backup <name>` and `hearthkit db restore <name> <file>` exist in the cli. `@hearthkit/storage` wraps `@aws-sdk/client-s3`; the cli may depend on storage (dependency graph in CLAUDE.md allows it: storage -> config only).
- The cli command-path union and failure union are additive; `payments sync` (step 3.4) and `infra apply` (6.1) are the patterns, including env-name constants in cli-contract.ts and the named re-exports in src/index.ts. Commands shell out through `run-child-process-command.ts` and never read `process.env` implicitly; `run-infra-apply-command.ts` shows the check-then-run shape and the secret scrub. Doctor checks are `{ checkName, status, detail }` in run-doctor-checks.ts; `tofu-cli-available` is the newest example. packages/cli/CONTRACT.md is 333 lines, over the cap since step 5; additive amendments are accepted, restructuring is not this step's job.
- CI: `.github/workflows/ci.yml` has one `checks` job (Postgres service, MinIO and Mailpit from compose, OpenTofu 1.12.6 via `opentofu/setup-opentofu@v1` with `tofu_wrapper: false`) and a `scaffold` job. The Docker-in-Docker bootstrap gate likely needs its own job. Find the run by `headSha` equal to `git rev-parse HEAD`; strip ANSI with `perl -pe 's/\e\[[0-9;]*m//g'`; today the log holds 12 vitest `Tests N passed (N)` lines and 3 Playwright `N passed` lines, no skipped segment. Export the root `.env` before the cli gates or the Stripe gate skips.
- Run before the PR: `pnpm --filter @hearthkit/cli test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `tofu fmt -check -recursive packages/cli/tofu` (unchanged, but cheap), and the Playwright flows only if cut 4 is declined or a template route or spec changed. The flows harness is `run-template-flows.ts` in the 6.1 session scratchpad; it is not in the repo, so rebuild it from the COMPLETION-PLAN appendix if needed (isolated Mailpit on 1125/8125, database `hk_flows_<suffix>`, port 3100, expect 6 passed).
- Squash-merge with `--delete-branch`. Commit trailers per the session's attribution reminder. `pnpm exec prettier --write` on every subagent-written file; the contract-author has no shell, so the orchestrator formats its files.

## Facts to verify before dispatching, not from memory

- GlitchTip self-hosted compose: current image tag, required environment (`SECRET_KEY`, `DATABASE_URL`, Redis or Valkey, `PORT`), and whether it needs a worker container. Read glitchtip.com/documentation/install.
- Uptime Kuma: current image tag and volume path.
- Dokploy: the current install command from docs.dokploy.com, the ports it takes (3000 and Traefik's 80/443), and that it initialises Docker Swarm; the shared services must not conflict with that.
- Docker-in-Docker on GitHub Actions: whether a `docker:dind` service container with `privileged: true` is enough to run `bootstrap.sh` inside an `ubuntu:24.04` container, and the time it takes; the gate must stay under the job's budget.
- systemd timer syntax for a daily `OnCalendar` unit and how the timer reaches the cli (a global install of `@hearthkit/cli` under Node 24 on the VPS, or `npx`; Node itself must be installed by the bootstrap script).

## Known but out of scope

6.3 (real VPS, runbooks), step 7, a second provider, Dokploy configuration beyond installing it, off-VPS alerting (Sentry uptime monitor is 6.3). The 6.1 items listed under STATUS "Open issues" stay open until 6.3. After 6.2 merges, STATUS points Next at 6.3, or at the combined 6.3 + step 8 sitting if cut 2 was accepted.
