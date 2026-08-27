# @hearthkit/db — contract

## Purpose

Drizzle client, migration runner, and project-database lifecycle for Postgres 17. Apps use it for a typed Drizzle client and to apply migrations at boot or deploy. The CLI uses it to create, drop, back up, and restore per-project databases. `createProjectDatabase` provisions one database plus one login role scoped to it and returns the connection string; the same function serves local and VPS because only the admin connection string differs.

## Inputs

### Environment variables

| Name           | Type                                                       | Required                        | Example                                          |
| -------------- | ---------------------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| `DATABASE_URL` | Postgres connection URL (`postgres://` or `postgresql://`) | required when `db` is installed | `postgresql://myapp:s3cret@localhost:5432/myapp` |

Declared in `dbEnvSchemaFragment`, composed by `@hearthkit/config` (empty string counts as unset, per config's contract). `DATABASE_URL` is always the **project-scoped** connection — the one `createProjectDatabase` returned. The **admin** connection string is never an environment variable of this package; lifecycle functions take it as an explicit `adminDatabaseUrl` parameter (the CLI decides where it comes from).

### Shared vocabulary

- `PostgresConnectionString` — branded; must be a `postgres://` or `postgresql://` URL.
- `ProjectDatabaseName` — branded; lowercase snake_case Postgres identifier (`/^[a-z][a-z0-9_]*$/`), max 63 chars. One name names both the database and its login role (one concept, one spelling). Preview environments are just a name with a suffix.

### Public functions

- `createDrizzleClient({ databaseUrl, schema? })` — `databaseUrl`: project connection string; `schema`: the app's Drizzle table map for typed queries. Synchronous and lazy: it never connects eagerly, so an unreachable server surfaces as a thrown driver error on the first query, not here.
- `createProjectDatabase({ adminDatabaseUrl, projectDatabaseName })` — creates the database and a same-named login role (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`) with a generated random password, makes the role own the database, and revokes `CONNECT` from `PUBLIC` so no other project's role can connect to it.
- `dropProjectDatabase({ adminDatabaseUrl, projectDatabaseName })` — drops the database with force (terminates live connections) and drops the role.
- `backupProjectDatabase({ adminDatabaseUrl, projectDatabaseName, backupFilePath })` — writes a `pg_dump` custom-format archive to `backupFilePath`, creating parent directories.
- `restoreProjectDatabase({ adminDatabaseUrl, projectDatabaseName, backupFilePath })` — restores a `pg_dump` custom-format archive into an **existing** project database, replacing clashing objects. After a drop, run `createProjectDatabase` first, then restore.
- `runDatabaseMigrations({ databaseUrl, migrationsFolderPath })` — applies drizzle-kit-generated migrations from the folder, in journal order, using the project-scoped connection. Idempotent when nothing is pending.

## Outputs

- `createDrizzleClient` returns `{ drizzleClient, closeDatabaseClient }`. `drizzleClient` is a typed Drizzle `NodePgDatabase` over node-postgres; `closeDatabaseClient()` ends the underlying pool — gates and CLI commands must call it or the process hangs.
- `createProjectDatabase` returns `{ kind: 'project-database-created', projectDatabaseName, connectionString }` or a failure. `connectionString` embeds the generated password and is returned only this once; it is not stored anywhere. Losing it means drop and recreate (or an operator resets the password by hand).
- `dropProjectDatabase` returns `{ kind: 'project-database-dropped', projectDatabaseName }` or a failure.
- `backupProjectDatabase` returns `{ kind: 'project-database-backed-up', projectDatabaseName, backupFilePath, backupByteCount }` or a failure.
- `restoreProjectDatabase` returns `{ kind: 'project-database-restored', projectDatabaseName, backupFilePath }` or a failure.
- `runDatabaseMigrations` returns `{ kind: 'database-migrations-applied', appliedMigrationCount }` (count of newly applied migrations, `0` when already current) or a failure.

Lifecycle and migration functions **return** failures as values; they never throw for a contract failure mode. Only the Drizzle client throws (driver errors at query time), which is outside this contract.

## Public entry point

`src/index.ts` is the package entry. It re-exports by name (no `export *`): the six public functions, `dbEnvSchemaFragment`, and from `db-contract.ts` the pieces gates and dependent packages consume — the result schemas (`createProjectDatabaseResultSchema` and siblings), the `dbFailureSchema` / `DbFailure` union, the message-prefix constants (`dbUnreachableErrorPrefix` and siblings), and the branded types `PostgresConnectionString` and `ProjectDatabaseName` with their schemas.

## Failure modes

All failures are one discriminated union, `DbFailure`, on `kind`. Every variant carries a `message` starting with its unique literal prefix.

| `kind`                            | When                                                                                                               | Message prefix                              | Returned by                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------ |
| `database-server-unreachable`     | TCP/DNS/auth failure reaching the server on the given connection string                                            | `hearthkit db server unreachable:`          | create, drop, backup, restore, migrate     |
| `project-database-already-exists` | Database **or** its same-named role already exists (either means the name is taken); carries `projectDatabaseName` | `hearthkit db database already exists:`     | create                                     |
| `project-database-not-found`      | Named project database does not exist; carries `projectDatabaseName`                                               | `hearthkit db database not found:`          | drop, backup, restore                      |
| `database-privilege-denied`       | Connected role lacks the privilege for the action (e.g. admin without `CREATEDB`/`CREATEROLE`)                     | `hearthkit db privilege denied:`            | create, drop, backup, restore, migrate     |
| `database-migration-conflict`     | Applied history diverges from the folder (missing or altered applied migration) or a migration statement fails     | `hearthkit db migration conflict:`          | migrate                                    |
| `migrations-folder-not-found`     | `migrationsFolderPath` missing or contains no drizzle journal; carries `migrationsFolderPath`                      | `hearthkit db migrations folder not found:` | migrate                                    |
| `backup-file-not-found`           | `backupFilePath` to restore from missing or unreadable; carries `backupFilePath`                                   | `hearthkit db backup file not found:`       | restore                                    |
| `backup-file-unwritable`          | `backupFilePath` cannot be created or written; carries `backupFilePath`                                            | `hearthkit db backup file unwritable:`      | backup                                     |
| `backup-file-invalid`             | File exists but is not a valid pg_dump custom-format archive; carries `backupFilePath`                             | `hearthkit db backup file invalid:`         | restore                                    |
| `postgres-tool-missing`           | `pg_dump` / `pg_restore` not on PATH; carries `toolName`                                                           | `hearthkit db tool missing:`                | backup (`pg_dump`), restore (`pg_restore`) |

The plan names four failure modes; the last six rows make backup/restore/migrate failures nameable, as the contract rules require. None widens function scope.

For `postgres-tool-missing`, the `message` names the missing tool (`pg_dump` or `pg_restore`) immediately after the prefix, matching the `toolName` field — e.g. `hearthkit db tool missing: pg_dump …`. The gates assert this, per the error-discoverability rules.

## Dependencies

- Packages: `@hearthkit/config` (this package only contributes `dbEnvSchemaFragment` to it; nothing else is imported from config at runtime).
- Services for gates: Postgres 17 from the repo-root `docker-compose.yml` (admin URL `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`) — see Decisions.
- Host tools for backup/restore (and their gates): Postgres 17 client binaries (`pg_dump`, `pg_restore`) on PATH.
- Runtime libraries (implementor adds, exact pins): `drizzle-orm@0.45.2`, `pg`, `zod@4.4.3`; `drizzle-kit` as a dev dependency of apps, not of this package.

## Out of scope

- **Defining app schemas.** Apps (and `auth`/`payments`) own their Drizzle table definitions; this package never ships tables.
- **Generating migrations.** `drizzle-kit generate` runs in the app at dev time; this package only applies what was generated.
- **Sourcing the admin connection string.** The CLI owns that; here it is a plain parameter.
- **Backup scheduling and upload to R2 (deferred).** This package writes a local archive file; the VPS job composes it with storage. Nothing here assumes where archives end up.
- **Postgres per project (deferred).** Kept open: `DATABASE_URL` is the only app coupling, and every lifecycle function takes `adminDatabaseUrl` explicitly, so a dedicated instance is just a different URL.
- **Preview environments per PR (deferred).** Kept open: `projectDatabaseName` is a parameter; a preview is a name with a suffix.
- **Drizzle 1.0 migration.** Deferred until GA; the public surface here does not expose 0.45-only APIs beyond the `NodePgDatabase` type.
- **Connection pool tuning.** Driver defaults; revisit only if a gate or production shows a need.

## Verified

Checked 2026-08-27:

- node-postgres Drizzle client: `drizzle(connectionString)` / `drizzle({ client: pool })` imported from `drizzle-orm/node-postgres` — https://orm.drizzle.team/docs/get-started-postgresql
- Programmatic migrations: `migrate(db, { migrationsFolder: './drizzle' })` imported from `drizzle-orm/node-postgres/migrator`; `drizzle-kit generate` produces timestamped `.sql` files plus journal/snapshot metadata — https://orm.drizzle.team/docs/migrations
- Zod 4 `z.url()` accepts a `protocol` regex option (used for `postgres(ql)` branding) — https://zod.dev/api

Not yet verifiable: `packages/db` has no `package.json`; the type-only import of `NodePgDatabase` in `db-contract.ts` resolves once the implementor adds `drizzle-orm@0.45.2`. The import is type-only, so the contract file still has no runtime effect.

## Decisions

Outcomes of the questions raised in the first draft; all defaults confirmed.

1. **Repo-root `docker-compose.yml` now exists** (Postgres 17, admin URL `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`); created by the orchestrator per plan section 6.
2. **`createDrizzleClient` returns `{ drizzleClient, closeDatabaseClient }`** — approved.
3. **Host `pg_dump`/`pg_restore` on PATH in all environments** — approved by the user 2026-08-27. Locally installed via brew `postgresql@17` (17.11); CI will install `postgresql-client-17`; Phase 7 VPS bootstrap will install `postgresql-client-17`.
4. **`restoreProjectDatabase` requires an existing target database** (create-then-restore) — approved.
5. **Credentials returned exactly once, never persisted**; persistence is future CLI scope — approved.
