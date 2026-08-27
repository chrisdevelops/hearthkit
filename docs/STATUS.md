# hearthkit status

Updated by the orchestrator after every commit. A fresh session reads this first to resume. Keep it short. History lives in git and `.changeset/`.

## Position

- Phase: 0 complete. Next: Phase 1 (`config`, then `db`)
- Package: none
- Step: not started
- Branch: main
- Last commit: Phase 0 foundation (repo: https://github.com/chrisdevelops/hearthkit, private)

## Phase checklist

Phases and their definitions of done are in `docs/PLAN.md` section 11.

- [x] Phase 0: foundation (done directly in the main session, no loop)
- [ ] Phase 1: `config`, `db`
- [ ] Phase 2: `cli` (db commands, dev, dev infra, doctor)
- [ ] Phase 3: `ui`, `observability`
- [ ] Phase 4: `templates/app`, Dockerfile, project CI workflows
- [ ] Phase 5: `storage`, `email`, `auth`, `payments`
- [ ] Phase 6: `create`
- [ ] Phase 7: `infra/tofu`, `hearthkit vps bootstrap`, backups
- [ ] Phase 8: AI tooling, docs
- [ ] Phase 9: end-to-end verification, tag v1.0.0

## Package loop state

Only the current package is tracked here. Steps: contract, contract-review, gates, gates-review, implement, verify, commit.

| Package | Step | Implementor rounds | Notes |
| ------- | ---- | ------------------ | ----- |
| —       | —    | 0                  | —     |

## Open issues

Items that blocked a loop and need a human decision. Remove when resolved.

- none

## Verified facts this session

Things checked against current docs that later steps can rely on. Clear when a phase completes.

- TypeScript latest is 7.0.2, but typescript-eslint 8.68.0 supports only `<6.1.0`. Pinned
  TypeScript 6.0.3 (newest stable 6.x). Revisit when typescript-eslint supports TS 7.
- Changesets is now 3.0.1 (config schema `@changesets/config@4.0.0`); `changeset init` is
  interactive-only, so `.changeset/config.json` was written by hand from the package's defaults.
- Root `package.json` is `"type": "module"` so `eslint.config.ts` typechecks under
  `verbatimModuleSyntax` + NodeNext.
- CI actions: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` are current
  majors (v4 triggers a Node 20 deprecation annotation).
