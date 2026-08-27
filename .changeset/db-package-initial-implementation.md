---
'@hearthkit/db': minor
---

New package: Drizzle client, migration runner, and project-database lifecycle for Postgres 17. `createProjectDatabase` provisions a database plus a same-named scoped login role (PUBLIC connect revoked) and returns the connection string once; drop, backup (pg_dump custom format), and restore (into an existing database) complete the lifecycle. `runDatabaseMigrations` applies drizzle-kit migrations and detects edited-history conflicts by sha256. All failure modes are returned as a discriminated union, never thrown.
