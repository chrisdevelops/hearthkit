# @hearthkit/cli — contract (Phase 2 scope)

## Purpose

The `hearthkit` binary: one entry point for project operations. Commands are thin — all database logic lives in `@hearthkit/db`; the CLI only resolves inputs (arguments, flags, environment), calls the owning package, and maps the result to an exit code, one machine-readable stdout line, and human guidance on stderr. Phase 2 covers the `db` lifecycle commands, `dev`, `dev infra up|down`, `doctor`, and generation of the local-infra compose file that `dev infra` needs. The command registry is a plain extensible union so later phases add `payments sync`, `infra apply`, and `vps bootstrap` without touching existing commands.

## Inputs

### Environment variables

| Name                           | Type                    | Required                                                            | Example                                                     | Owner                                   |
| ------------------------------ | ----------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `HEARTHKIT_ADMIN_DATABASE_URL` | Postgres connection URL | optional                                                            | `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit` | this package (`cliEnvSchemaFragment`)   |
| `DATABASE_URL`                 | Postgres connection URL | optional (required by `db migrate` when `--database-url` is absent) | `postgresql://myapp:s3cret@localhost:5432/myapp`            | `@hearthkit/db` (`dbEnvSchemaFragment`) |

`HEARTHKIT_ADMIN_DATABASE_URL` is an operator variable read by the CLI itself at command time; apps never pass `cliEnvSchemaFragment` to `@hearthkit/config` at boot. Empty string counts as unset, matching config's rule.

**Admin URL resolution** (used by `db create|drop|backup|restore` and doctor's reachability check), highest precedence first:

1. `--admin-database-url <url>` flag
2. `HEARTHKIT_ADMIN_DATABASE_URL` environment variable
3. `defaultLocalAdminDatabaseUrl` = `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit` — the repo/generated compose admin connection.

Per the db contract, the admin URL is always an explicit `adminDatabaseUrl` parameter to `@hearthkit/db`; this resolution is the CLI's answer to "where it comes from".

### Commands (Phase 2 registry)

| Command                              | Arguments and flags                                                                                                                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hearthkit db create <name>`         | `<name>`: `ProjectDatabaseName` (db contract's branded name). `--admin-database-url <url>` optional.                                                                                                                                                                              |
| `hearthkit db drop <name>`           | Same as create. No confirmation prompt — scripts and the scaffolder call this non-interactively.                                                                                                                                                                                  |
| `hearthkit db migrate`               | `--database-url <url>` (falls back to `DATABASE_URL` env; project-scoped, never admin). `--migrations-folder <path>` default `./drizzle`.                                                                                                                                         |
| `hearthkit db backup <name>`         | `--admin-database-url` as above. `--backup-file <path>` default `./backups/<name>-<YYYYMMDDTHHMMSSZ>.dump` (UTC). The `backupFilePath` in the result (and stdout line) is the flag value verbatim when given; the default path is returned as an absolute path resolved from cwd. |
| `hearthkit db restore <name> <file>` | `<file>`: path to a pg_dump custom-format archive. `--admin-database-url` as above. Target database must already exist (db contract: create-then-restore after a drop).                                                                                                           |
| `hearthkit dev`                      | No arguments. Runs the `dev infra up` behavior, then the project's own `next dev` (from `node_modules/.bin`), streaming its stdio.                                                                                                                                                |
| `hearthkit dev infra up`             | No arguments. See compose resolution below.                                                                                                                                                                                                                                       |
| `hearthkit dev infra down`           | No arguments. `docker compose down`, volumes kept. No compose file in cwd is a no-op success.                                                                                                                                                                                     |
| `hearthkit doctor`                   | `--json` optional: print the report as JSON instead of the human table.                                                                                                                                                                                                           |

An unknown command path, unknown flag, missing argument, or an argument that fails its schema (for example an uppercase database name) is a usage failure, exit 2.

### Compose file resolution and generation (`dev`, `dev infra up`)

1. If `docker-compose.yml` exists in the working directory, use it as-is. Never overwrite it.
2. Otherwise read `./package.json` and map installed hearthkit packages (in `dependencies` or `devDependencies`) to local infra services per plan section 6: `@hearthkit/db` → `postgres`, `@hearthkit/storage` → `minio`, `@hearthkit/email` → `mailpit`. Missing `package.json` is a `project-manifest-missing` failure.
3. If at least one service is needed, generate the compose file with `generateLocalInfraCompose` and write it to `./docker-compose.yml`, then run `docker compose up -d --wait`. If none is needed, succeed with zero services and write nothing.

The compose project name is derived from the manifest `name`: strip a leading `@scope/`, lowercase, replace every character outside `[a-z0-9-]` with `-`; fall back to `hearthkit-app` if nothing remains.

`startedInfraServices` in the `dev-infra-up-succeeded` result is the service list reported by `docker compose config --services`, filtered to the known `localInfraServiceName` values (`postgres`, `minio`, `mailpit`). An existing hand-written compose file naming only unknown services therefore yields an empty list even though compose started them. When the CLI generated the file, the list naturally equals the manifest-derived set.

Docker availability is checked first (`docker` on PATH and `docker info` exits 0); otherwise `docker-unavailable`.

### Generated compose content

`generateLocalInfraCompose({ hearthkitProjectName, infraServices })` is pure and deterministic. Images come from the exported constant `localInfraServiceImageByName` (single place to bump):

| Service    | Image                                      | Host ports                     | Notes                                                                                                                                                                         |
| ---------- | ------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `postgres:17`                              | 5432                           | `POSTGRES_USER/PASSWORD/DB` = `hearthkit`/`hearthkit`/`hearthkit`, matching `defaultLocalAdminDatabaseUrl`; named volume `<project>-postgres-data`; `pg_isready` healthcheck. |
| `minio`    | `minio/minio:RELEASE.2025-09-07T16-13-09Z` | 9000 (S3), 9001 (console)      | `MINIO_ROOT_USER/PASSWORD` = `hearthkit`/`hearthkit`; `server /data --console-address :9001`; named volume `<project>-minio-data`.                                            |
| `mailpit`  | `axllent/mailpit:v1.31`                    | 1025 (SMTP), 8025 (UI and API) | No volume.                                                                                                                                                                    |

Container names are `<project>-postgres`, `<project>-minio`, `<project>-mailpit`. Host ports are fixed; two projects running infra simultaneously clash (see Out of scope).

### Doctor checks

Each check reports `pass`, `fail`, or `skip` (skipped when a prerequisite check failed) plus a one-line detail:

| Check name                        | What it verifies                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `node-version-supported`          | Running Node major >= 24.                                                                                         |
| `pnpm-command-available`          | `pnpm` on PATH.                                                                                                   |
| `docker-cli-available`            | `docker` on PATH.                                                                                                 |
| `docker-daemon-running`           | `docker info` exits 0 (skip if CLI missing).                                                                      |
| `docker-compose-plugin-available` | `docker compose version` exits 0 (skip if CLI missing).                                                           |
| `postgres-client-tools-version`   | `pg_dump` and `pg_restore` on PATH with major version 17 (a v16 client shadowing v17 fails this check by design). |
| `admin-database-reachable`        | A connection with the resolved admin URL answers `SELECT 1`.                                                      |
| `cli-env-variables-valid`         | `HEARTHKIT_ADMIN_DATABASE_URL` and `DATABASE_URL`, when set, parse as Postgres URLs. Unset passes.                |

With `--json`, doctor prints exactly the `doctorJsonReportSchema` object — `{ checks: DoctorCheckResult[], allDoctorChecksPassed: boolean }` — as JSON on stdout, both on success and on `doctor-checks-failed` (where `allDoctorChecksPassed` is `false`).

### Public programmatic functions

- `runHearthkitCli({ argv, cwd?, env? })` — `argv`: command words and flags only (no node/bin prefix); `cwd` defaults to `process.cwd()`; `env` defaults to `process.env`. Writes to `process.stdout`/`stderr` and resolves with `{ exitCode, result }`. The bin is a thin wrapper that calls this and exits with `exitCode`.
- `generateLocalInfraCompose({ hearthkitProjectName, infraServices })` — pure; returns the compose YAML string. Exported so `@hearthkit/create` (Phase 6) reuses it instead of copying templates.

## Outputs

Exit codes: `0` success, `1` operational failure, `2` usage failure. Exception: once `next dev` is running, `hearthkit dev` streams its stdio and exits with the child's exit code (0–255). Failure messages go to stderr; the machine-readable success line goes to stdout.

| Command          | Success result `kind`               | stdout on success                                                                                                                                                                                                                                                                           |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `db create`      | `db-create-command-succeeded`       | Exactly the project-scoped connection string, one line, nothing else. Pipeable. stderr carries the one-time warning, a line starting with `cliDbCreateCredentialsWarningPrefix` (`hearthkit db create warning:`): shown only once and never persisted — copy it into `.env.local` yourself. |
| `db drop`        | `db-drop-command-succeeded`         | One line starting `hearthkit db drop complete:` naming the database.                                                                                                                                                                                                                        |
| `db migrate`     | `db-migrate-command-succeeded`      | One line starting `hearthkit db migrate complete:` with `appliedMigrationCount`.                                                                                                                                                                                                            |
| `db backup`      | `db-backup-command-succeeded`       | One line starting `hearthkit db backup complete:` with the backup file path and byte count.                                                                                                                                                                                                 |
| `db restore`     | `db-restore-command-succeeded`      | One line starting `hearthkit db restore complete:` with the database name and file path.                                                                                                                                                                                                    |
| `dev infra up`   | `dev-infra-up-succeeded`            | One line starting `hearthkit dev infra up complete:` listing started services (possibly none).                                                                                                                                                                                              |
| `dev infra down` | `dev-infra-down-succeeded`          | One line starting `hearthkit dev infra down complete:`.                                                                                                                                                                                                                                     |
| `dev`            | `dev-command-exited`                | Child `next dev` output, streamed.                                                                                                                                                                                                                                                          |
| `doctor`         | `doctor-report` (all checks passed) | Human table of checks, or the JSON report with `--json`.                                                                                                                                                                                                                                    |

All result shapes are Zod schemas in `src/cli-contract.ts`; `runHearthkitCli` returns them so gates can validate without scraping text.

## Failure modes

One discriminated union, `CliFailure`, on `kind`. Every variant carries a `message` starting with its unique literal prefix; the message is the last stderr line before a nonzero exit.

| `kind`                       | When                                                                                                                                                     | Message prefix                            | Exit | Commands                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---- | ----------------------------------------- |
| `cli-usage-invalid`          | Unknown command, unknown flag, missing or schema-invalid argument                                                                                        | `hearthkit cli usage:`                    | 2    | all                                       |
| `admin-database-url-invalid` | Resolved admin URL (flag or env) is not a `postgres(ql)://` URL                                                                                          | `hearthkit cli admin url invalid:`        | 1    | db create, drop, backup, restore          |
| `database-url-missing`       | `db migrate` with neither `--database-url` nor `DATABASE_URL`; the message names the literal `DATABASE_URL` immediately after the prefix                 | `hearthkit cli database url missing:`     | 1    | db migrate                                |
| `database-url-invalid`       | Provided database URL is not a `postgres(ql)://` URL                                                                                                     | `hearthkit cli database url invalid:`     | 1    | db migrate                                |
| `db-command-failed`          | `@hearthkit/db` returned any `DbFailure`; carried verbatim as `dbFailure`, `message` equals the db failure's message (already prefixed `hearthkit db …`) | the underlying db prefix                  | 1    | db create, drop, migrate, backup, restore |
| `docker-unavailable`         | `docker` not on PATH or daemon not running                                                                                                               | `hearthkit cli docker unavailable:`       | 1    | dev, dev infra up, dev infra down         |
| `infra-compose-failed`       | `docker compose` exited nonzero; carries `composeExitCode` and `composeStderrExcerpt`                                                                    | `hearthkit cli infra compose failed:`     | 1    | dev, dev infra up, dev infra down         |
| `project-manifest-missing`   | Compose generation needed but no `./package.json`; carries `manifestPath`                                                                                | `hearthkit cli project manifest missing:` | 1    | dev, dev infra up                         |
| `compose-file-unwritable`    | Generated `docker-compose.yml` cannot be written; carries `composeFilePath`                                                                              | `hearthkit cli compose file unwritable:`  | 1    | dev, dev infra up                         |
| `next-dev-unavailable`       | No runnable `next` binary in the project's `node_modules/.bin`                                                                                           | `hearthkit cli next dev unavailable:`     | 1    | dev                                       |
| `doctor-checks-failed`       | At least one doctor check did not pass; carries the full `checks` array and `failedCheckNames`; the report still prints to stdout                        | `hearthkit doctor failed:`                | 1    | doctor                                    |

The CLI never re-words a db failure: the db message is printed as-is so its prefix stays greppable and db failure modes are not re-specified here.

## Dependencies

- Packages: `@hearthkit/db` (all `db *` logic, plus the branded `PostgresConnectionString` / `ProjectDatabaseName` and `DbFailure` reused by this contract). Consumers (gates included) import that db vocabulary — `projectDatabaseNameSchema`, `postgresConnectionStringSchema`, `dbFailureSchema`, and their types — from `@hearthkit/db` directly; `@hearthkit/cli` does not re-export it. `@hearthkit/config` is a conceptual dependency only (fragment convention, empty-string-is-unset rule); nothing is imported from it at runtime.
- Runtime libraries (implementor adds, exact pins): `zod@4.4.3`; argument parsing and YAML emission are implementation choices, not contract.
- Services for gates: Docker with the compose plugin; Postgres 17 (repo compose, admin URL `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`); host `pg_dump`/`pg_restore` 17 on PATH; a scratch Next.js app fixture for `dev` gates.

## Out of scope

- **`payments sync`, `infra apply`, `vps bootstrap` (later phases).** Kept open: `cliCommandPathSchema` is a plain enum that later phases extend additively; nothing dispatches on "is this the last command".
- **Persisting the created `DATABASE_URL`.** Phase 2 prints it once and writes no env file (db contract: credentials returned once, never persisted). Kept open: `db-create-command-succeeded` carries `connectionString`, so a later `--write-env <file>` flag is additive.
- **Interactive prompts.** No confirmation on `db drop`; every command is scriptable. A later `--confirm` layer is additive.
- **Loading `.env` files.** `next dev` loads the app's env files itself; the CLI reads only `process.env`.
- **Port allocation for parallel projects.** Generated compose uses fixed host ports; running two projects' infra at once clashes. Deferred: the generated file is plain YAML the user may edit, and the CLI never overwrites an existing file.
- **Editing or migrating an existing `docker-compose.yml`.** The CLI only creates the file when absent; the scaffolder (Phase 6) owns generation at project creation time.
- **Remote/VPS admin operations.** The admin URL is just a parameter chain; pointing `HEARTHKIT_ADMIN_DATABASE_URL` at a VPS works without CLI changes (Phase 7 concern).

## Verified

Checked 2026-08-27:

- MinIO stopped publishing community images to Docker Hub in October 2025; the last published tag is `minio/minio:RELEASE.2025-09-07T16-13-09Z` (still pullable) — https://hub.docker.com/v2/repositories/minio/minio/tags/ and https://www.minimus.io/post/minio-docker-image-changes-how-to-find-a-secure-minio-alternative. Pinned in `localInfraServiceImageByName`; revisit at Phase 5 (`storage`) whether to move to `quay.io/minio/minio` or a maintained alternative.
- Mailpit's image is `axllent/mailpit`, defaults SMTP 1025 and web UI/API 8025; current tag `v1.31` (v1.31.0, 2026-08-22) — https://mailpit.axllent.org/docs/install/docker/ and https://hub.docker.com/v2/repositories/axllent/mailpit/tags/.
- Repo-root `docker-compose.yml` admin URL `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit` (local file, matches `docs/STATUS.md`).
- No library on the plan's "verify at build time" list (section 14) is touched by Phase 2 CLI scope.

Not yet verifiable: `packages/cli` has no `package.json`; the imports from `@hearthkit/db` in `cli-contract.ts` resolve once the implementor adds the workspace dependency. The imports are schema/type values with no side effects, so importing the contract file still does nothing.

## Questions for the orchestrator

Defaults were chosen so downstream work is not blocked; veto any of these and the contract will be revised.

1. `db create` prints the connection string to stdout once and never writes an env file. STATUS calls persistence "future CLI scope" — confirmed as _later than_ Phase 2?
2. `dev infra up` writes a generated `docker-compose.yml` into the project root when one is missing (never overwriting). Alternative was a hearthkit-owned path like `.hearthkit/docker-compose.yml`; root was chosen to match what the Phase 6 scaffolder generates.
3. `db drop` runs without confirmation. Acceptable for a dev tool driven by scripts?
4. Admin URL precedence flag > `HEARTHKIT_ADMIN_DATABASE_URL` > compose default. The env var makes VPS use (Phase 7) ergonomic without new code — confirm the variable name.
5. The MinIO pin is a discontinued-but-pullable Docker Hub tag; final image choice can be deferred to Phase 5 since `minio` only appears when `@hearthkit/storage` is installed, which cannot happen before then.
