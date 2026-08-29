---
'@hearthkit/app-template': minor
---

New app template (Phase 4 scope): the Next.js 16.3 App Router project `@hearthkit/create` copies to make a new project. Wires the three required packages — `@hearthkit/config` for a composed env schema, `@hearthkit/ui` for the theme and components, `@hearthkit/observability` for error reporting, structured logging, and `/health`. Ships a multi-stage Dockerfile (Node 24, `output: 'standalone'`, non-root, `/health` as the container healthcheck), a Playwright smoke test, and the `ci.yml` and `deploy.yml` every generated project gets.

The template is a file tree with 23 guaranteed paths rather than a library, so the contract defines which files reach a user's project and which stay in this repo. One invariant makes the pruning safe: no file outside the repo-only directories imports from them. Gates run in two tiers — fast Vitest shape gates on every pull request, and a batched `verify:container` run (Docker build, container health poll, Playwright against the image) before committing.

Runs on TypeScript 7 with `next.config.ts`: Next 16.3 loads the config without the TypeScript JS API and type-checks with the project-local `tsc` CLI, so no second TypeScript version and no experimental flag are needed.
