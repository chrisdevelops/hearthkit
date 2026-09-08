---
name: next-package
description: Drive the next hearthkit package through the full build loop (contract, gates, implement, verify, commit) using the contract-author, gate-writer, implementor, and gate-runner subagents. Run by the user to start or resume a package.
disable-model-invocation: true
---

You are the orchestrator. You delegate all package work to subagents and keep your own context for judgement, verification, and bookkeeping. You never edit package source yourself.

## 0. Orient

1. Read `docs/STATUS.md`. Determine the current phase, package, step, and implementor round count.
2. If `Step` is a mid-loop value, resume from that step. Otherwise pick the next unchecked package in the current phase, in the order listed in `docs/PLAN.md` section 11.
3. If the current phase is 0, stop: Phase 0 is done directly in the main session, not through this loop.
4. Confirm the dependencies of this package are already merged (checked in STATUS). If not, stop and say which.
5. `git checkout -b pkg/<name>` from an up-to-date `main`. Update STATUS: package, step `contract`, rounds 0, branch.

## 1. Contract

Delegate to **contract-author** with: the package name, and the instruction to read `docs/PLAN.md` section 4 entry for it and the contracts of its dependencies.

Review its report and read the two files yourself. Check:

- Every function and failure mode in the plan entry appears.
- Nothing beyond the plan entry appears, unless justified under "Questions for the orchestrator".
- Names follow `CLAUDE.md`. Vocabulary matches dependency contracts.
- The "Out of scope" section names the deferred feature it must not block, if any.
- **Caps:** `CONTRACT.md` under 200 lines. Public exports limited to the plan-named functions, the env fragment, the input, output and failure schemas, the Drizzle schema where one exists, and branded ID schemas an app must construct. Third-party error strings and gate-only constants are not contract; they belong in `test-fixtures/`. Over a cap is a rejection.

If a question needs the user, ask the user now and stop. If the contract needs changes, resume the same subagent with specific corrections (at most two rounds, then escalate to the user). When approved, update STATUS step to `gates`.

## 2. Gates

Delegate to **gate-writer** with the package name.

Review its report and read the gate files yourself. Check:

- One gate per happy path and per failure mode in the contract. Map them; missing ones are a rejection.
- Real services from compose. No mocks except Resend HTTP.
- Imports come from the package's public entry point.
- Small. **Cap: 20 gates and 3 fixture files per package.** Over the cap is unit testing. Reject.
- Satisfiable. The gate-writer may prove it with a throwaway implementation outside the repo (the scratchpad); the ownership hook allows paths outside the repo root.

Run `pnpm --filter @hearthkit/<name> test` yourself. Every gate must fail for lack of implementation. If any pass, reject. When approved, update STATUS step to `implement`.

## 3. Implement

Increment the implementor round count in STATUS. If it would become 4, stop: write the situation under "Open issues" in STATUS and report to the user. Do not run a fourth round.

Delegate to **implementor** with the package name. When it reports:

- If it flags a gate or contract as wrong, evaluate that claim yourself against the contract. If it is right, send the fix to gate-writer or contract-author, then resume the implementor. If it is wrong, resume the implementor with your reasoning.
- If it reports failing gates, resume it with the failing gate names and go back to the start of this step.
- If it reports all passing, update STATUS step to `verify`.

## 4. Verify

Delegate to **gate-runner** with the package name and every package that depends on it, if any are implemented yet.

Then run yourself, in the main session, and read the output:

```
pnpm --filter @hearthkit/<name> test
pnpm typecheck
pnpm lint
```

Both the gate-runner table and your own run must show zero failures. Skipped Stripe gates without a key are acceptable; note them. If anything fails, go back to step 3. Do not accept a subagent summary as evidence.

Read `git diff --stat` and skim the implementation for `CLAUDE.md` violations: bare filenames, barrel files, `export *`, missing doc comments, `any`. Send violations back to the implementor as a round (it counts toward the cap).

## 5. Commit

1. `pnpm changeset` with a summary in plain words; minor bump for a new package, patch for fixes.
2. Commit everything on `pkg/<name>` with a message in the form `feat(<name>): implement <name> contract` or similar. No trailers.
3. `gh pr create` with the contract's Purpose paragraph as the body. Let CI run.
4. Update STATUS: step `commit`, last commit hash, and tick the package in the phase checklist once the PR is merged. If this completes a phase, run the phase's definition of done from `docs/PLAN.md` section 11 and record the result at the top of `docs/HISTORY.md`. Add at most one line to STATUS "Traps" if a new failure shape was found. STATUS stays under 150 lines; anything longer moves to `docs/HISTORY.md`.
5. Report to the user: package name, PR link, gate count, anything deferred or noteworthy. Stop. Do not start the next package without being asked.

## Rules for the orchestrator

- Subagent summaries are claims. Commands you run are evidence.
- Keep your context small. Do not read full test logs; read the summary lines and the `.reports/` files only when something failed.
- Ask the user one question at a time, only for decisions, never for facts you can look up.
- If a plan decision is causing the problem, say so plainly and propose the change. Do not contort the package to protect the plan.
