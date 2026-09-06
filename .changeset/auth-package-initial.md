---
'@hearthkit/auth': minor
---

New `@hearthkit/auth` package (Phase 5): Better Auth 1.7 wired to `@hearthkit/db`'s Drizzle client and `@hearthkit/email`'s transport. Ships the server auth instance, the Next.js route handler, the browser client carrying the session hooks, a session reader, and the Drizzle table definitions for the seven auth tables. Email and password and magic link are always enabled; Google and GitHub only when both halves of their credential pair are set. Twelve functions, nine failure variants, all returned as values — nothing throws for a failure mode it names.

The organization tables exist in **every** project, whether or not the `organizations` scaffold flag is on. The flag selects which endpoints exist, not which tables do, because switching a project between user scope and org scope later would be a data migration. `verifyAuthTablesExist` makes that a checkable claim rather than a comment.

The OAuth both-or-neither rule is enforced by `resolveAuthRuntimeConfig` at boot rather than by a refinement on the env fragment, because `composeEnvSchemaFragments` rebuilds a fresh `z.object` from a fragment's shape and **silently discards** an attached `.refine` — a half-filled Google pair would otherwise boot as though no rule had been written.

Reading this library correctly matters more than usual, because its recurring shape is that the obvious spelling returns a wrong answer rather than an error. The contract therefore pins the access paths: the error code is at `error.body?.code` and `error.code` is always `undefined`; a magic-link rejection carries no code at all and lives in `error.headers.get('location')`, where the property spelling `error.headers.location` yields `undefined`; database failures arrive as raw Drizzle errors with the real code exactly one `.cause` hop down. Error-code constants are exported and matched by exact equality because the library ships plausible decoys beside the real ones — `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` is thrown, not `USER_ALREADY_EXISTS`, and `ORGANIZATION_ALREADY_EXISTS`, not `ORGANIZATION_SLUG_ALREADY_TAKEN`.

Two dependencies are load-bearing in ways their absence hides. `next` is a devDependency because `nextCookies()` rethrows a missing-package error it does not recognise, failing every cookie-setting call. `@types/pg` pins the peer-suffixed drizzle-orm resolution so `@hearthkit/db`'s client stays assignable; without it pnpm materialises a second copy and TypeScript reports a `PgSession.dialect` error that reads like a Drizzle bug.

40 gates against real Postgres and a Mailpit container the suite starts on reserved ports of its own — never the repo's shared one, whose inbox other packages' gates clear wholesale.
