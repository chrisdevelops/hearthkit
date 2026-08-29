# @hearthkit/cli — contract (Phase 2 scope, amended in Phase 5)

## Purpose

The `hearthkit` binary: one entry point for project operations. Commands are thin — all database logic lives in `@hearthkit/db`; the CLI only resolves inputs (arguments, flags, environment), calls the owning package, and maps the result to an exit code, one machine-readable stdout line, and human guidance on stderr. Phase 2 covers the `db` lifecycle commands, `dev`, `dev infra up|down`, `doctor`, and generation of the local-infra compose file that `dev infra` needs. The command registry is a plain extensible union so later phases add `payments sync`, `infra apply`, and `vps bootstrap` without touching existing commands. One Phase 5 amendment is folded in, under "Local storage bucket" below: when the generated compose file contains MinIO it also creates a bucket in it, because a MinIO with no bucket fails at the first upload rather than at boot.

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

`generateLocalInfraCompose({ hearthkitProjectName, infraServices })` is pure and deterministic. Its options are unchanged by the Phase 5 amendment: no new input, no file or environment read. Images come from two exported constants and appear nowhere else — `localInfraServiceImageByName` for the three services a project can select (one place to bump those three), and `localStorageBucketInitImage` for the bucket init container, which is not a service a project selects and so is not a key of that map:

| Service    | Image                                      | Host ports                     | Notes                                                                                                                                                                         |
| ---------- | ------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `postgres:17`                              | 5432                           | `POSTGRES_USER/PASSWORD/DB` = `hearthkit`/`hearthkit`/`hearthkit`, matching `defaultLocalAdminDatabaseUrl`; named volume `<project>-postgres-data`; `pg_isready` healthcheck. |
| `minio`    | `minio/minio:RELEASE.2025-09-07T16-13-09Z` | 9000 (S3), 9001 (console)      | `MINIO_ROOT_USER/PASSWORD` = `hearthkit`/`hearthkit`; `server /data --console-address :9001`; named volume `<project>-minio-data`.                                            |
| `mailpit`  | `axllent/mailpit:v1.31`                    | 1025 (SMTP), 8025 (UI and API) | No volume.                                                                                                                                                                    |

Container names are `<project>-postgres`, `<project>-minio`, `<project>-mailpit`. Host ports are fixed; two projects running infra simultaneously clash (see Out of scope). The `minio` service also carries a healthcheck, added by the amendment below and specified there.

### Local storage bucket (Phase 5 amendment)

A MinIO with no bucket in it fails late and quietly: the app boots because `STORAGE_BUCKET` is only a validated string, presigning succeeds because signing never contacts the server, and the browser's PUT is the first thing to see a 404. Production has no such gap — Phase 7's OpenTofu module creates the R2 bucket, its scoped token, and its CORS rules (plan section 8.2) — so the generated compose file closes it locally.

Whenever `minio` is emitted, and only then, `generateLocalInfraCompose` emits one more container, placed immediately after `minio` and before `mailpit` so the file's service order stays fixed and the function stays deterministic:

- Service key `minio-init`, the exported `localStorageBucketInitServiceName`; container name `<project>-minio-init`.
- Image `minio/mc:RELEASE.2025-08-13T08-35-41Z`, the exported `localStorageBucketInitImage`.
- `depends_on` in the long syntax, naming `minio` with `condition: service_healthy`, so it waits for MinIO rather than racing it.
- No `restart` key, so compose's default `no` applies. This is not because the container exits — it does not exit, see the next bullet — but because it is not a service worth reviving: if it dies, the bucket it created is still there, and the next `dev infra up` recreates the container anyway. The `restart: unless-stopped` the three long-running services carry would buy nothing here.
- `entrypoint: ['sh', '-c', 'mc alias set local http://minio:9000 hearthkit hearthkit && mc mb --ignore-existing local/<bucket> && tail -f /dev/null']`, where `<bucket>` is `deriveLocalStorageBucketName(hearthkitProjectName)`. `--ignore-existing` is what makes a second `dev infra up` succeed instead of failing on a bucket that is already there.
- The container **stays running by design**: the trailing `tail -f /dev/null` is what keeps it alive once the bucket exists. `docker compose up --wait` exits 1 when any service it started has exited, whatever that service's exit code, and `dev infra up` always passes `--wait` — so a container that did its work and exited 0 would make every `dev infra up`, fresh or repeated, report `infra-compose-failed` with the bucket correctly created.
- The `&&` chain still fails loudly in the right direction. If `mc alias set` or `mc mb` fails, the chain short-circuits before `tail`, the container exits nonzero, `--wait` fails, and the CLI reports `infra-compose-failed`. Staying alive is the success path only.
- The emitted YAML carries a short comment above `minio-init` saying the container stays up on purpose. Nothing else in this contract specifies comments in the generated file, so the implementor chooses the wording and no gate asserts it — but a reader who finds an idle container with no explanation will file it as a bug, so the comment is not optional.
- No volume, no published port, no environment block. Credentials are the same `hearthkit`/`hearthkit` the `minio` service is given.

Three alternatives were run against these exact pins and rejected. Stating `restart: 'no'` explicitly changes nothing — compose objects to the exit, not to the missing key. Putting `minio-init` behind `profiles: ['init']` and having the CLI run `docker compose run --rm minio-init` works for the CLI, but then a user running plain `docker compose up` on the file gets no bucket. Making MinIO's own healthcheck run `mc mb` is impossible: the server image's built-in `local` alias is unauthenticated and `mc mb` through it returns `Access Denied`. The idle-container shape is the only one that behaves the same under `up`, `up --wait`, and a repeat of either. That matters more here than the cost of one idle container, because `resolveLocalInfraComposeFile` never overwrites an existing compose file: users are expected to own and run this file by hand from then on, and a file that works under `docker compose up` but fails under `docker compose up --wait` is a landmine in something the CLI hands over and never touches again.

For `condition: service_healthy` to mean anything, the generated `minio` service now carries a healthcheck: `test: ['CMD', 'mc', 'ready', 'local']`, `interval: 5s`, `timeout: 5s`, `retries: 20` — MinIO's own documented healthcheck for this image, with the interval and retry count matching the `postgres` service already in the file. `docker compose up -d --wait` therefore now waits for MinIO to be healthy rather than merely running.

Three things stay exactly as they were. `minio-init` is not a `LocalInfraServiceName`, so it is neither a value a caller may pass in `infraServices` nor a value that can appear in `startedInfraServices`. `dev infra down` is unchanged: `docker compose down` removes every container the compose file defines, the still-running init container included, and still keeps volumes. And creating the bucket adds no failure kind — see Failure modes.

### The local storage bucket name

`deriveLocalStorageBucketName(hearthkitProjectName)` is the single place this name is decided. `dev infra up` calls it to write the compose file, and `@hearthkit/create` (Phase 6) calls the same function for the value it writes to `STORAGE_BUCKET`, so the two cannot drift. The name is `<project>-uploads`: `myapp` gives `myapp-uploads`.

Deriving the name rather than accepting one is forced by the call site. `resolveLocalInfraComposeFile` builds the compose file from the project's `package.json`: it holds a project name and a service list, no bucket name, and the CLI deliberately reads no `.env` file. A required `storageBucketName` input could not be satisfied on the `dev infra up` path without putting environment I/O inside a function this contract calls pure.

The function is total — every string `hearthkitProjectNameSchema` accepts produces a name `localStorageBucketNameSchema` accepts — so it has no failure mode. The length edge case is real and is answered by truncation rather than by an error: the project name is cut to 55 characters (63 minus the 8-character suffix), trailing hyphens are stripped from what remains, then `-uploads` is appended. A 60-character project name therefore yields a 63-character bucket name, and a project name ending in a hyphen yields `my-app-uploads`, not `my-app--uploads`. Every result starts with a letter (project names must), ends with `s`, is 9 to 63 characters long, and holds only lowercase letters, digits, and hyphens.

`localStorageBucketNameSchema` encodes the S3 and R2 intersection: 3 to 63 characters, lowercase letters, digits, and hyphens only, first and last character alphanumeric, no dots. It deliberately does not encode S3's reserved prefixes (`xn--`, `sthree-`, `amzn-s3-demo-`), which R2's documented rules do not impose. Encoding them would make the derivation partial — a project legitimately named `xn--foo` would have no bucket name — in exchange for a rule no service in this stack is known to apply; production R2 names come from Phase 7's OpenTofu module, not from this function. Whether MinIO itself rejects such a name is not verified, and the consequence would be loud rather than silent: the init container would exit nonzero and `dev infra up` would return `infra-compose-failed`.

A project that wants a different bucket name needs no new CLI code. `resolveLocalInfraComposeFile` never overwrites an existing `docker-compose.yml`, so a project with a custom `STORAGE_BUCKET` owns its compose file and edits the `mc mb` line in it. The generated file names the bucket in plain text, which is where a reader finds the answer.

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
- `deriveLocalStorageBucketName(hearthkitProjectName)` — pure and total; returns the branded `LocalStorageBucketName` the generated compose file creates in MinIO. Exported so `@hearthkit/create` writes the identical string to `STORAGE_BUCKET` instead of re-deriving it.
- `deriveHearthkitProjectName(manifestName)` — pure and total; the package.json-name-to-project-name rule described above, promoted to the public surface by the same amendment. Without it a caller cannot reach the project name the CLI derives, and so cannot reach the bucket name either. Takes `string | undefined`; returns a branded `HearthkitProjectName`, falling back to `hearthkit-app`.

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

Creating the local storage bucket adds no failure kind. If MinIO never becomes healthy, or `mc` cannot reach it, or the bucket cannot be created, the entrypoint's `&&` chain short-circuits before `tail -f /dev/null`, the init container exits nonzero, `docker compose up -d --wait` exits nonzero, and the CLI reports `infra-compose-failed` carrying compose's exit code and stderr excerpt — the same failure it already reports for every other compose problem. Keeping the container alive on success therefore costs nothing in diagnosis: the only way it stops is a failure, and every failure surfaces through the kind that already exists. `deriveLocalStorageBucketName` cannot fail at all, for the reason given above.

## Dependencies

- Packages: `@hearthkit/db` (all `db *` logic, plus the branded `PostgresConnectionString` / `ProjectDatabaseName` and `DbFailure` reused by this contract). Consumers (gates included) import that db vocabulary — `projectDatabaseNameSchema`, `postgresConnectionStringSchema`, `dbFailureSchema`, and their types — from `@hearthkit/db` directly; `@hearthkit/cli` does not re-export it. `@hearthkit/config` is a conceptual dependency only (fragment convention, empty-string-is-unset rule); nothing is imported from it at runtime.
- Runtime libraries (implementor adds, exact pins): `zod@4.4.3`; argument parsing and YAML emission are implementation choices, not contract.
- Services for gates: Docker with the compose plugin; Postgres 17 (repo compose, admin URL `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`); host `pg_dump`/`pg_restore` 17 on PATH; a scratch Next.js app fixture for `dev` gates. The local-storage-bucket gates additionally need the `minio/minio` and `minio/mc` images to be pullable, and reach the started MinIO over the S3 API on host port 9000. They do not need `@hearthkit/storage` itself: the mapping in step 2 reads the manifest's dependency list, so a fixture `package.json` naming `@hearthkit/storage` selects `minio` whether or not that package is installed.

## Out of scope

- **`payments sync`, `infra apply`, `vps bootstrap` (later phases).** Kept open: `cliCommandPathSchema` is a plain enum that later phases extend additively; nothing dispatches on "is this the last command".
- **Persisting the created `DATABASE_URL`.** Phase 2 prints it once and writes no env file (db contract: credentials returned once, never persisted). Kept open: `db-create-command-succeeded` carries `connectionString`, so a later `--write-env <file>` flag is additive.
- **Interactive prompts.** No confirmation on `db drop`; every command is scriptable. A later `--confirm` layer is additive.
- **Loading `.env` files.** `next dev` loads the app's env files itself; the CLI reads only `process.env`.
- **Port allocation for parallel projects.** Generated compose uses fixed host ports; running two projects' infra at once clashes. Deferred: the generated file is plain YAML the user may edit, and the CLI never overwrites an existing file.
- **Editing or migrating an existing `docker-compose.yml`.** The CLI only creates the file when absent; the scaffolder (Phase 6) owns generation at project creation time.
- **Remote/VPS admin operations.** The admin URL is just a parameter chain; pointing `HEARTHKIT_ADMIN_DATABASE_URL` at a VPS works without CLI changes (Phase 7 concern).
- **Reconciling `STORAGE_BUCKET` with the bucket the compose file creates.** The CLI reads no `.env` file, so it cannot see a project's `STORAGE_BUCKET` and cannot warn when the two disagree; it creates the derived name and nothing else. A project that wants another name owns its own compose file, which the CLI never overwrites. Kept open: an optional `storageBucketName` on `generateLocalInfraComposeOptionsSchema` would be additive, since nothing passes one today.
- **Any production bucket.** `minio-init` exists only in the generated local compose file. The R2 bucket, its scoped token, and its CORS rules are Phase 7's OpenTofu module (plan section 8.2); nothing here decides a production bucket name.

## Verified

Checked 2026-08-27:

- MinIO stopped publishing community images to Docker Hub in October 2025; the last published tag is `minio/minio:RELEASE.2025-09-07T16-13-09Z` (still pullable) — https://hub.docker.com/v2/repositories/minio/minio/tags/ and https://www.minimus.io/post/minio-docker-image-changes-how-to-find-a-secure-minio-alternative. Pinned in `localInfraServiceImageByName`; revisit at Phase 5 (`storage`) whether to move to `quay.io/minio/minio` or a maintained alternative.
- Mailpit's image is `axllent/mailpit`, defaults SMTP 1025 and web UI/API 8025; current tag `v1.31` (v1.31.0, 2026-08-22) — https://mailpit.axllent.org/docs/install/docker/ and https://hub.docker.com/v2/repositories/axllent/mailpit/tags/.
- Repo-root `docker-compose.yml` admin URL `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit` (local file, matches `docs/STATUS.md`).
- No library on the plan's "verify at build time" list (section 14) is touched by Phase 2 CLI scope.

Not yet verifiable: `packages/cli` has no `package.json`; the imports from `@hearthkit/db` in `cli-contract.ts` resolve once the implementor adds the workspace dependency. The imports are schema/type values with no side effects, so importing the contract file still does nothing.

Checked 2026-08-29, for the Phase 5 amendment:

- `mc mb --ignore-existing` "directs `mc mb` to do nothing if the bucket or directory already exists", which is what makes a repeated `dev infra up` a no-op instead of an error — https://docs.min.io/enterprise/aistor-object-store/reference/cli/mc-mb/ (min.io's community `mc` reference URLs now 301 to this AIStor reference).
- `mc alias set ALIAS URL ACCESSKEY SECRETKEY`, secret key minimum 8 characters — https://docs.min.io/enterprise/aistor-object-store/reference/cli/mc-alias/mc-alias-set/. The generated credential `hearthkit` is 9 characters, so the value the `minio` service already uses is legal here too.
- MinIO's own published compose example healthchecks this image with `test: ["CMD", "mc", "ready", "local"]`, `interval: 5s`, `timeout: 5s` — https://raw.githubusercontent.com/minio/minio/master/docs/orchestration/docker-compose/docker-compose.yaml.
- Compose `depends_on` long syntax supports `service_started`, `service_healthy`, and `service_completed_successfully`; `restart` defaults to `no`, which "does not restart the container under any circumstances" — https://docs.docker.com/reference/compose-file/services/.
- R2 bucket names: 3 to 63 characters, lowercase letters, digits, and hyphens only, cannot begin or end with a hyphen — https://developers.cloudflare.com/r2/buckets/create-buckets/.
- S3 general purpose bucket names: 3 to 63 characters; lowercase letters, digits, periods, and hyphens; must begin and end with a letter or digit; must not be formatted as an IP address; must not start with `xn--`, `sthree-`, or `amzn-s3-demo-` — https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html. `localStorageBucketNameSchema` is the intersection of those two lists, minus the reserved prefixes, for the reason given above.
- The `mc` sidecar pattern itself was verified by the orchestrator against these exact pins before this amendment was commissioned: it creates the bucket, waits for the healthcheck rather than racing it, is idempotent on a second `docker compose up -d --wait`, and a presigned PUT that returns 404 without it returns 200 with it. Recorded in `docs/STATUS.md` 2026-08-29; not re-run here.
- `docker compose up --wait` returns exit code 1 when any service it started has exited, **including a container that exited 0**, unless another service depends on it with `service_completed_successfully` — https://github.com/docker/compose/issues/10596 (open; "[BUG] compose up --wait exits 1 on init containers successfully completing"). The flag's own reference says only "Wait for services to be running|healthy. Implies detached mode." and documents no exception — https://docs.docker.com/reference/cli/docker/compose/up/. This is why `minio-init` ends in `tail -f /dev/null`, and it is the least obvious thing in this design: `dev infra up` passes `--wait` unconditionally (`composeUpArguments` in `src/docker-compose-commands.ts`), so removing the `tail` makes every `dev infra up` fail with `infra-compose-failed` while the bucket is created correctly. Confirmed empirically by the orchestrator on 2026-08-29 against this exact YAML: an exiting init container gave compose exit 1 on both the fresh and the repeat run; with `tail -f /dev/null`, fresh `up -d --wait`, repeat `up -d --wait`, and plain `up -d` all exit 0, a presigned PUT returns 200, and `down -v` exits 0 with every container removed.
- The pinned `minio/minio:RELEASE.2025-09-07T16-13-09Z` server image does contain the `mc` binary the healthcheck `test: ['CMD', 'mc', 'ready', 'local']` calls: `docker exec` into a running container prints `The cluster 'local' is ready` and exits 0. The bundled binary reports `mc version RELEASE.2025-08-13T08-35-41Z` and is byte-identical to the standalone `minio/mc` release pinned in `localStorageBucketInitImage`, so the two pins are the same `mc`, not two nearby versions, and should be bumped together. Verified by the orchestrator on 2026-08-29.
- The "not yet verifiable" note above is resolved: `packages/cli` ships a `package.json` and the `@hearthkit/db` imports resolve.

## Questions for the orchestrator

Defaults were chosen so downstream work is not blocked; veto any of these and the contract will be revised.

1. `db create` prints the connection string to stdout once and never writes an env file. STATUS calls persistence "future CLI scope" — confirmed as _later than_ Phase 2?
2. `dev infra up` writes a generated `docker-compose.yml` into the project root when one is missing (never overwriting). Alternative was a hearthkit-owned path like `.hearthkit/docker-compose.yml`; root was chosen to match what the Phase 6 scaffolder generates.
3. `db drop` runs without confirmation. Acceptable for a dev tool driven by scripts?
4. Admin URL precedence flag > `HEARTHKIT_ADMIN_DATABASE_URL` > compose default. The env var makes VPS use (Phase 7) ergonomic without new code — confirm the variable name.
5. The MinIO pin is a discontinued-but-pullable Docker Hub tag; final image choice can be deferred to Phase 5 since `minio` only appears when `@hearthkit/storage` is installed, which cannot happen before then.

From the Phase 5 amendment:

6. **Answered 2026-08-29: approved as specified.** `deriveHearthkitProjectName` is promoted to the public surface. Without it `@hearthkit/create` cannot reach the project name the bucket name is built from, so it would re-implement the sanitiser and drift — the exact failure this amendment exists to prevent. It is an existing function, unchanged; only `index.ts` gains a named re-export.
7. **Answered 2026-08-29: approved as specified.** The bucket name is `<project>-uploads` and `localStorageBucketNameSchema` does not screen S3's reserved prefixes, because screening would trade a total function for a rule R2 does not impose.
