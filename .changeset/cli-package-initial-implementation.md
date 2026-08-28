---
'@hearthkit/cli': minor
---

New package: the `hearthkit` bin (Phase 2 scope). `db create|drop|migrate|backup|restore` wrap `@hearthkit/db` and map results to exit codes, one machine-readable stdout line, and prefixed stderr messages; `db create` prints the connection string once and persists nothing. `dev infra up|down` uses an existing `docker-compose.yml` or generates one from the project's hearthkit dependencies (Postgres 17 / MinIO / Mailpit, pinned images); `dev` brings infra up then runs the project's `next dev`, propagating its exit code. `doctor` runs eight environment checks with a `--json` report. All failure modes are a returned discriminated union, never thrown; the bin runs the workspace's TypeScript source directly on Node 24 via a registered resolver hook.
