---
'@hearthkit/create': minor
---

New package: the `pnpm create @hearthkit` scaffolder. `createHearthkitProject(options)` takes every choice as an option (project name, packages, organizations, target directory, install, start infra, package version, interactive), resolves package dependencies without asking (`auth` pulls `db` and `email`, `payments` pulls `auth`), copies `templates/app` with the unselected paths and `hearthkit-section` blocks pruned, applies the ten scaffold rewrites the template manifest declares, writes `docker-compose.yml` through the CLI's generator and `infra/tofu.tfvars`, runs `pnpm install`, `hearthkit dev infra up` and `hearthkit db create` when enabled, and prints next steps. Prompts exist only as a fallback for a required option missing while stdin is a TTY; otherwise `create-option-missing`.

The pruning logic (`decideTemplatePathPrune`, `pruneOptionalSectionBlocks`) moves here from the template, which keeps only the section manifest as data. Three scaffold variants (every package, none, `auth` with organizations) are gated end to end: install, typecheck, boot, Playwright smoke and flows, behind `HEARTHKIT_SCAFFOLD_GATES=1`.
