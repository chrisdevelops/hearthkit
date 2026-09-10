# hearthkit status

Updated by the orchestrator after every commit. A fresh session reads this first to resume. Keep it
under 150 lines. History and evidence live in `docs/HISTORY.md`, git, and `.changeset/`.

## Position

- Phase: 6 done. 0.1.0 published 2026-09-09, trusted publishing confirmed at 0.1.1 (completion
  plan step 4, PRs #21, #24, #25).
- Current work: none in flight.
- Package loop: none in flight.
- Last commit on `main`: PR #27 (Version Packages 0.1.2, MIT license in every tarball).
- Published: every `@hearthkit/*` package at 0.1.2 on npm with provenance and an MIT license.
- Next: **step 5 (export-surface refactor)**, one branch per package in the order storage, email,
  ui, auth, payments, through the `next-package` loop.

## Phase checklist

Phases and their definitions of done are in `docs/PLAN.md` section 11. The path to v1.0.0 is
`docs/COMPLETION-PLAN.md`.

- [x] Phase 0: foundation (done directly in the main session, no loop)
- [x] Phase 1: `config` (PR #1), `db` (PR #2)
- [x] Phase 2: `cli` (PR #3)
- [x] Phase 3: `ui` (PR #4), `observability` (PR #5), `docs/theming.md` (PR #6, #7)
- [x] Phase 4: `templates/app`, Dockerfile, project CI workflows (PR #8, #9); DoD verified on a throwaway repo
- [x] Phase 5: `storage` (PR #10, #11), `email` (PR #12), `auth` (PR #13), `payments` (PR #14),
      template sections and flows (PR #15, #16). 308 gates green, 6 Playwright flows green. DoD
      narrowed to the superset by plan Version 2 (completion plan step 2).
- [x] Phase 6: `create` (PR #20, step 3); 0.1.0 published, `pnpm create @hearthkit` verified from
      the registry, trusted publishing confirmed at 0.1.1 (PR #21, #24, #25, step 4)
- [ ] Export-surface refactor (completion plan step 5)
- [ ] Phase 7: `infra/tofu/cloudflare`, `hearthkit vps bootstrap`, backups (step 6)
- [ ] Phase 8: `AGENTS.md`, skills, MCP config, runbooks (step 7)
- [ ] Phase 9: end-to-end verification, tag v1.0.0 (step 8)

## Package loop state

Only the current package is tracked here. Steps: contract, contract-review, gates, gates-review,
implement, verify, commit.

| Package | Step | Implementor rounds | Notes |
| ------- | ---- | ------------------ | ----- |
| none    |      |                    |       |

## Open issues

Items that blocked a loop and need a human decision. Remove when resolved.

- None.

## Traps

One line each. The full account is in `docs/HISTORY.md` under the quoted heading.

- **Node refuses type stripping under `node_modules`.** Anything that runs installed `.ts` under plain
  node needs the `@hearthkit/config/register-node-modules-type-stripping` preload; workspace runs
  never show it. ("NODE REFUSES TYPE STRIPPING UNDER node_modules")

- **CI run must match the branch head.** After any docs commit, find the run by `headSha` equal to
  `git rev-parse HEAD`; rerunning an older run does not move it. ("A RERUN LANDED ON THE WRONG COMMIT")
- **`pnpm --filter` on an unmatched name exits 0** with `No projects matched the filters`. That is
  evidence of nothing; read the test count. ("the SEVENTH time this repo has hit that trap")
- **A skipped gate is not a passing gate.** Payments prints `N passed | M skipped` when the Stripe
  key is missing; the merge criterion is no skip segment. ("37 passed | 8 skipped")
- **Strip ANSI before grepping CI logs** (`perl -pe 's/\e\[[0-9;]*m//g'`), or the counts match nothing.
- **Playwright non-retrying reads race the app.** `.innerText()` and `waitForResponse().json()` on a
  self-navigating page pass by luck; use `expect(locator).toHaveText` and `route.fulfill`. ("TWO FLOW
  SPECS PASSED FOR THE WRONG REASON")
- **`next start` does not serve standalone output**, and the emitted `server.js` path differs between
  this workspace and a generated project. `start-standalone-server.ts` handles both. ("`next start` IS
  UNSUPPORTED")
- **A 500 after a change is usually the environment.** Boot validation names the bad variable; read
  the log before blaming the change. ("ORCHESTRATOR ERROR WORTH RECORDING")
- **Live Stripe keys are refused.** Gates assert `livemode === false` before creating anything; Stripe's
  test mode now lives under Sandboxes in the account picker. ("SAFETY NOTE")
- **Unbound SDK methods pass `typeof` guards and then throw** deep inside the SDK. Call methods on the
  client, never extract them. ("UNBOUND METHOD in the gate's own fixture")
- **Mailpit is shared by package gates.** Template flows use an isolated Mailpit so exact-count
  assertions in `email` are not disturbed. ("Mailpit isolation held in both directions")
- **npm trusted publishers default to staged publishing.** Tick "Allow `npm publish`" under Allowed
  actions on every package, or the release run fails with `OIDC permission denied for this
action`. ("npm trusted publishers default to staged publishing")
