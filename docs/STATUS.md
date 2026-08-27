# hearthkit status

Updated by the orchestrator after every commit. A fresh session reads this first to resume. Keep it short. History lives in git and `.changeset/`.

## Position

- Phase: 0 (foundation)
- Package: none
- Step: not started
- Branch: main
- Last commit: none

## Phase checklist

Phases and their definitions of done are in `docs/PLAN.md` section 11.

- [ ] Phase 0: foundation (done directly in the main session, no loop)
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

- none
