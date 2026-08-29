# hearthkit status

Updated by the orchestrator after every commit. A fresh session reads this first to resume. Keep it short. History lives in git and `.changeset/`.

## Position

- Phase: 4 (`templates/app`, Dockerfile, project CI workflows) — in progress
- Package: `templates/app`
- Step: commit — PR #8 open, CI green, awaiting merge
- Branch: pkg/app-template
- Last commit: 03e3ade feat(app-template): implement the Phase 4 app template contract

## Phase checklist

Phases and their definitions of done are in `docs/PLAN.md` section 11.

- [x] Phase 0: foundation (done directly in the main session, no loop)
- [x] Phase 1: `config` (merged, PR #1), `db` (merged, PR #2)
- [x] Phase 2: `cli` (merged, PR #3)
- [x] Phase 3: `ui` (merged, PR #4), `observability` (merged, PR #5), `docs/theming.md` + verified shadowed-component example
- [ ] Phase 4: `templates/app`, Dockerfile, project CI workflows
- [ ] Phase 5: `storage`, `email`, `auth`, `payments`
- [ ] Phase 6: `create`
- [ ] Phase 7: `infra/tofu`, `hearthkit vps bootstrap`, backups
- [ ] Phase 8: AI tooling, docs
- [ ] Phase 9: end-to-end verification, tag v1.0.0

## Package loop state

Only the current package is tracked here. Steps: contract, contract-review, gates, gates-review, implement, verify, commit.

| Package         | Step   | Implementor rounds | Notes                                              |
| --------------- | ------ | ------------------ | -------------------------------------------------- |
| `templates/app` | commit | 1                  | PR #8, CI green. Contract 2 rounds, gates 2 rounds |

## Open issues

Items that blocked a loop and need a human decision. Remove when resolved.

- **Two cleanup actions need the user — the orchestrator's `gh` token cannot do either.** Scopes are
  `admin:public_key, gist, read:org, repo, workflow`; deleting needs `delete_repo` and
  `delete:packages`. The throwaway probe from the Phase 4 verification is still live:
  1. Repo `chrisdevelops/hearthkit-template-probe-80cr2w` (private) — delete via Settings → General
     → Danger Zone → Delete this repository, or run
     `gh auth refresh -s delete_repo` then `gh repo delete chrisdevelops/hearthkit-template-probe-80cr2w --yes`.
  2. GHCR package `hearthkit-template-probe-80cr2w` — **deleting the repository does not always
     remove a linked container package.** Check https://github.com/users/chrisdevelops/packages and
     delete it there if it survives.
- **PR #8 is open with CI green and is not merged.** Phase 4 stays unticked in the checklist until
  it is, even though its definition of done is now fully verified (see below).
- Deferred, recorded so it is not rediscovered: `@hearthkit/ui` exports only `.` and
  `./hearthkit-theme.css`, and `.` resolves through `.tsx`, so no bare-Node script can import
  anything that imports the ui package. This is what forces `verify:container` to mirror contract
  values rather than import them. A JSX-free `./ui-contract` subpath export would fix it
  (`packages/ui/src/ui-contract.ts` imports only zod). Changes a merged package's public API, so it
  needs its own loop — worth doing before Phase 6, since `@hearthkit/create` will hit the same wall.

## Verified facts this session

- **PHASE 4 DEFINITION OF DONE FULLY VERIFIED 2026-08-28**, against a real throwaway repository
  (`chrisdevelops/hearthkit-template-probe-80cr2w`, private, user-authorised). The template was
  materialized exactly as `@hearthkit/create` will do it, using the loop's own
  `materializeAppTemplateProject`, then pushed to a repo with no relationship to this workspace.
  - **The generated project stands alone.** Outside the monorepo, with `@hearthkit/*` resolved from
    packed tarballs rather than `workspace:*`: `pnpm install` exit 0, `pnpm lint` exit 0,
    `pnpm typecheck` exit 0, `pnpm build` exit 0, `.next/standalone/server.js` produced. This is the
    first evidence the template survives being copied out of the workspace.
  - **Pruning is correct in practice, not just in gates.** 27 files committed: no `CONTRACT.md`, no
    `src/`, no `test-fixtures/`, no `vitest.config.mts`, no `node_modules`, no build output.
    `gitignore` arrived as `.gitignore`. `test` and `verify:container` scripts and the `vitest`/`zod`
    dev dependencies were all removed from the manifest.
  - **`ci.yml` passes on a pull request:** install, lint, typecheck, Chromium install, then
    `pnpm test:e2e` → `Running 2 tests using 1 worker`, both specs `✓`, `2 passed`.
  - **`deploy.yml` passes on push to main**, and the guard behaves: the image built and pushed to
    `ghcr.io/chrisdevelops/hearthkit-template-probe-80cr2w` tagged with **both** the commit SHA and
    `latest` on one digest (`sha256:8f2df8d9…`), matching plan section 7 — and the
    `Trigger the Dokploy deployment` step reported **`skipped`, not `failed`**, with no secret set.
    That is the user's Q4 decision working end to end.
  - **The CI-built image runs and `/health` is green.** Local `verify:container` proves an arm64
    image built on the orchestrator's machine; that is not the same claim as the amd64 image GitHub
    built. A throwaway-only `probe-run-image.yml` (added to the probe repo, **never** to
    `templates/app`) pulled the pushed image on a runner and asserted three things:
    `status=200`, `body={"status":"ok","checks":[]}`, and container stdout carrying
    `{"level":30,…,"pid":1,…,"msg":"hearthkit app started"}`. Passed.
    Deliberately not added to the shipped `deploy.yml`: plan section 7 specifies exactly three steps
    for it, and silently adding a fourth to every future project is not the loop's call.
  - Still untested, unchanged: the Dokploy webhook call, until Phase 7 provisions an instance.
  - Cosmetic issue for Phase 6, not blocking: the materializer copies `next-env.d.ts` when it is
    present in the template working tree. It is gitignored so it never reaches a commit, and Next
    regenerates it, but `@hearthkit/create` should skip it rather than copy cruft.

- **SUPERSEDED — TypeScript 7 now works with Next.js.** The Phase 4 constraint recorded below
  ("`templates/app` must ship TS 5.x or `next.config.mjs`") was true for Next 16.1.4 and is
  false for Next 16.3.3. Verified 2026-08-28 by orchestrator spike, both directions:
  - Next **16.3.3** + `typescript@7.0.2` + `next.config.ts` + `output: 'standalone'`, with **no**
    experimental flag set: `✓ Running next.config.ts took 1679ms`, `next build` exit 0,
    `tsc --noEmit` exit 0, standalone `server.js` served HTTP 200 with the expected body.
  - Negative control, Next **16.1.4** + same TS 7.0.2: reproduces the exact recorded error,
    `Failed to transpile "next.config.ts" … TypeError: Cannot read properties of undefined
(reading 'fileExists')`.
  - `experimental.useTypeScriptCli` is **already `true` in `defaultConfig`** in the published
    16.3.3 tarball (`dist/server/config-shared.js:257`, inside the frozen defaults from line 89),
    so it must NOT be set explicitly — doing so would only restate a default and imply we depend
    on an experimental opt-in. `dist/build/load-jsconfig.js:107-113` branches on it to choose
    `tscPath` over `apiPath`; `dist/build/next-config-ts/transpile-config.js` no longer touches
    the TypeScript API at all (SWC, or Node native type stripping).
  - Consequence: the whole repo stays on TS 7.0.2. `templates/app` pins **Next 16.3.3**, not
    16.1.4. Any Phase 4 or Phase 6 work that assumed a second TypeScript version is void.
  - Note for the template's tsconfig: `next build` rewrites `jsx` to `react-jsx` and appends
    `.next/dev/types/**/*.ts` to `include`. Ship both pre-set so builds do not mutate the file.
- `templates/app` gates written and orchestrator-verified failing 2026-08-28. 24 gates across 7
  Vitest files (~900 lines), plus one Playwright smoke spec in the batched tier. Orchestrator ran
  them against a byte-copy of `templates/app` in the scratchpad with node_modules symlinks to
  workspace `vitest`, `zod`, and the three `@hearthkit/*` packages: **7 files failed, 24/24 gates
  failed in 1.42 s**, every failure either a diagnostic `gate could not read templates/app/<path>
(not written yet?)` or a clean assertion diff — no collection error, no syntax error, no
  unresolved import belonging to the gates.
  **Note the prescribed loop command does not work for this package yet.**
  `pnpm --filter @hearthkit/app-template test` prints `No projects matched the filters` and exits
  **0**, because `templates/app/package.json` is implementor-owned and does not exist. The
  repo-root `pnpm --recursive --if-present run test` is therefore also a no-op for the template
  today. Until the implementor writes that manifest, the scratch-copy run above is the only real
  evidence; do not read an exit 0 from the filter command as a pass.
  Tier split verified: `vitest.config.ts` scopes `include` to `src/**/*.test.ts`, so
  `e2e/*.spec.ts` can never run in the fast tier that fires on every pull request.
- `templates/app` implementor round 1 complete 2026-08-28. Orchestrator-run results:
  - `pnpm --filter @hearthkit/app-template test` — **8 files, 26/26 gates pass**, exit 0, 1.70 s.
    This command works for real now; before the manifest existed it exited 0 having run nothing.
  - `pnpm lint` — exit 0. The nested `templates/app/.oxlintrc.json` risk the contract flagged did
    **not** materialise: root lint exits 0 with it present and does lint template files.
  - `pnpm typecheck` — exit 1 on the first run, one error in the whole workspace and it was in a
    gate file (see below). **After the gate fix: exit 0, all 6 projects Done.**
  - `pnpm --filter @hearthkit/app-template run verify:container` — **exit 0, all seven steps**.
    Docker image built, container ran, `/health` answered 200 after 661 ms, container stdout
    carried `hearthkit app started`, Playwright smoke 2/2 passed against the container, teardown
    clean. **This is the local half of the Phase 4 definition of done: an image builds and runs
    with `/health` green.** The CI half still needs the throwaway-repo run (user decision Q4).
  - `git diff --stat`: 45 files, 4488 insertions. Rule scan clean — no `export *`, no barrel, no
    `any`, no bare-role filenames, and every export in every implementor-owned file carries a doc
    comment.
- **Gate defect found by `tsc`, exactly as the silent-import hazard predicted — in reverse.**
  `src/app-template-tree.test.ts:83` raises TS2367: `guaranteedPath === directoryName` compares the
  23-literal union from `appTemplateGuaranteedPaths` against the 4-literal union from
  `appTemplateNeverCopiedDirectoryNames`, which provably cannot overlap. It went unnoticed through
  two gate rounds because the template had no `package.json`, so no typecheck ran over the gates;
  writing the manifest turned `tsc` on for the first time. Fix sent to gate-writer: the same
  widening cast already used one line above (`as readonly string[]`), which weakens no assertion —
  the runtime question stays the one that matters, since a future contract edit could legitimately
  put a never-copied directory name into the guaranteed list.
  The implementor reported it and stopped rather than working around it, and explicitly rejected
  both available workarounds because each would have weakened something: excluding
  `src/**/*.test.ts` from the template tsconfig would have deleted exactly the `tsc` coverage that
  guards against silently-stale contract imports, and the `typecheck` script string is pinned by
  both the contract and a gate.
  **Fixed and orchestrator-verified**: the widening cast landed, and gate-writer audited every
  other comparison across the eight gate files and two fixtures — all have at least one
  `string`-typed side, so none can go disjoint. Confirmed by a fresh non-incremental
  `tsc --noEmit` over the whole template with `tsbuildinfo` deleted, which is positive evidence
  rather than an absent second error, since `tsc` reports every TS2367 in a file rather than
  stopping at the first.
  One near-miss deliberately left un-widened, and this is the right call: the two-list agreement
  check's `rename.templatePath === templatePath` type-checks today only because `gitignore` appears
  in both `appTemplateRenamedPaths` and `appTemplateGuaranteedPaths`. If a rename source were ever
  dropped from the guaranteed list, that comparison would raise the same TS2367 — and it should,
  because at that point the two lists genuinely disagree and the gate would be asserting nonsense.
  Compile-time failure is the correct outcome there.
- **All four repo-root commands green after the gate fix, orchestrator-run 2026-08-28:**
  `pnpm --filter @hearthkit/app-template test` exit 0 (26/26), `pnpm typecheck` exit 0,
  `pnpm lint` exit 0 (47 warnings, all pre-existing in `packages/*`), `pnpm format:check` exit 0.
  `format:check` needed one fix of its own: `docs/STATUS.md` had drifted out of Prettier style from
  this session's own edits. Orchestrator-owned file, reformatted in place.
- `templates/app` implementor judgement calls the contract did not settle, accepted 2026-08-28:
  1. **`verify:container` mirrors the contract instead of importing it — known limitation.**
     `src/app-template-contract.ts` imports `@hearthkit/ui`, whose only package entry is
     `./src/index.ts` and resolves through `.tsx`; bare Node refuses that
     (`ERR_UNKNOWN_FILE_EXTENSION`, reproduced with and without `--experimental-transform-types`),
     and no JSX-capable runner is resolvable from the template without shipping a dev dependency
     into every generated project. So `src/verify-app-container-contract-mirror.ts` re-declares the
     13 values the script needs and asserts each still appears in the contract's source text before
     running. **Weakness, stated: it catches a reworded prefix or a renamed path, but not a value
     ADDED to a contract list.** The clean fix is a JSX-free subpath export on `@hearthkit/ui`
     (`ui-contract.ts` imports only zod, so it is eligible) — `packages/ui/package.json` currently
     exports only `.` and `./hearthkit-theme.css`. Deferred: it changes a merged package's public
     API and belongs in its own loop, not this one.
  2. `instrumentation.ts` throws rather than calling `process.exit`. Next compiles the file for the
     Edge runtime too, where `process.exit`/`process.stderr` produced two Turbopack warnings per
     build. Verified in a container with `LOG_LEVEL=nope GLITCHTIP_DSN=not-a-url`: stderr carries
     `hearthkit config invalid:` naming both variables, and `/` and `/health` both return 500,
     never 200. The container stays up serving 500, so the `HEALTHCHECK` is what marks it
     unhealthy. The contract permits ("may exit") rather than requires the exit.
  3. `tsconfig.json` carries `allowJs`, `incremental`, `plugins:[{name:'next'}]` and
     `.next/types/**/*.ts` because without them `next typegen` rewrites and reformats the tracked
     file on every run. Verified `next typegen` now leaves it byte-identical.
  4. Dockerfile copies the whole project before installing (pnpm's documented Docker layout) rather
     than a package.json-only deps stage; a source change re-runs the install. Noted in-file.
  5. Job-level `env` for the Dokploy guard, `ENV NODE_ENV=production` in the runner stage, and the
     Playwright smoke run from the materialized project rather than from `templates/app` — so the
     shipped `playwright.config.ts` and `e2e/` are exercised the way a generated project uses them.
- `templates/app` gates APPROVED 2026-08-28 after round 2. Orchestrator-run against an empty copy:
  **8 files, 26/26 gates fail in 1.77 s, zero Vite warning lines.** 22 fail with a
  `gate could not read/import templates/app/<path> (not written yet?)` diagnostic, 4 with assertion
  diffs; no collection error. Round 2 added `src/app-workflow-content.test.ts` (one gate per
  workflow, pinning both halves of the deploy secret guard) and closed the silent-`undefined`
  hazard with an `expectNonEmptyStringList(value, exportName)` guard in the fixtures, which now
  throws a named error when a contract export goes missing. All eight new or renamed contract
  exports are referenced by exactly one gate file each (orchestrator-checked). `vitest.config.ts`
  is now `vitest.config.mts`; Vitest discovers it with no flag.
- Ownership hook widened twice more 2026-08-28, both prompted by gate-writer hitting it and
  **stopping rather than working around it with a shell `mv`** — the correct behaviour:
  1. gate-writer may write `vitest.config.@(ts|mts)` under `packages/*` and `templates/*`.
  2. The implementor is now blocked from `vitest.config.ts`, `vitest.config.mts`, and
     `*/test-fixtures/*` as well as `*.spec.ts` and `playwright.config.ts`. These files decide
     which tier a gate runs in, so an implementor could otherwise have widened or narrowed its own
     gates. Thirteen role/path combinations retested; packages unaffected.
- **Hazard found 2026-08-28 — a stale contract import fails SILENTLY in this repo's Vitest setup.**
  The round-2 contract renamed `appTemplateRepoOnlyDirectoryName` to
  `appTemplateRepoOnlyDirectoryNames`. `app-template-tree.test.ts` still imported the old name, and
  the suite re-ran with the same 24 failures and **no import error**: Vite's module runner resolves
  a missing named export to `undefined` rather than throwing. `repoOnlyDirectoryPrefix` silently
  became `"undefined/"`, so the pruning-safety invariant — the most important gate in the set —
  would have passed while checking nothing once the implementation landed. `tsc` catches this as
  TS2305, but the template has no `package.json` yet so no typecheck runs.
  **General rule for this repo:** a contract rename does not reliably break its gates at test time.
  After any contract revision, diff gate imports against contract exports directly rather than
  trusting a red suite to stay red for the right reason. Applies to packages too, not just
  templates.
- `templates/app` contract round 2 completed 2026-08-28; `pnpm format:check` now passes on both
  contract files. Notable finding by contract-author, verified against GitHub's contexts reference:
  **the `secrets` context is not available in any `if` key**, job-level or step-level (only in
  `env` mappings). The obvious `if: ${{ secrets.DOKPLOY_DEPLOY_WEBHOOK_URL != '' }}` would have
  been an invalid workflow. `appTemplateDeployWorkflowRequiredContent` pins both halves of the
  correct pattern — the `env` mapping and the `env.`-based `if` — so the guard that makes
  build-and-push testable without Dokploy cannot silently disappear.
- `templates/app` contract round 2 opened 2026-08-28 — the gates exposed six real gaps, all
  orchestrator-verified before being sent back:
  A. `test-fixtures/` would ship into every generated project (it is in neither
  `appTemplateRepoOnlyPaths` nor under `src/`, and the rule is "everything not listed is copied").
  B. The Dockerfile copies `public/`, which is not a guaranteed path; `COPY` fails when it is
  absent and Next never creates it.
  C. `tailwindcss`/`@tailwindcss/postcss` 4.3.3 and `@playwright/test` 1.62.1 are prose-only, so
  the manifest gate retypes them; the other three version pins have constants.
  D. `verify:container` has no defined command, leaving `app-image-build-failed` and
  `app-container-not-healthy` with no gate anywhere. Resolution is to define the script's
  observable contract and state the under-coverage honestly, not to fabricate a broken build.
  E. `ci.yml` and `deploy.yml` are existence-only. A `deploy.yml` that lost the "skip the webhook
  when the secret is unset" guard would pass everything — and that guard is the user decision that
  makes build-and-push testable without Dokploy.
  F. `vitest.config.ts` triggers a real Vite warning (`ESM syntax in a file loaded as CommonJS`);
  that loader becomes the default in a future Vite major. `"type": "module"` is correctly ruled
  out by the standalone `server.js` reasoning, so the file becomes `vitest.config.mts`.
  Also outstanding: `pnpm format:check` fails on `templates/app/CONTRACT.md` and
  `src/app-template-contract.ts`; contract-author asked to leave both Prettier-clean.
- `templates/app` contract approved 2026-08-28. Its seven questions resolved as follows — three
  were facts, and were settled by test rather than by decision:
  1. `docs/theming.md` was wrong and is fixed. The `next.config.ts` section no longer tells apps to
     pin TS 5.x; it states the TS 7 + Next 16.3.3 position and explicitly warns against setting
     `experimental.useTypeScriptCli`. Orchestrator edit.
  2. Root `.gitignore` gained `test-results/`, `playwright-report/`, `next-env.d.ts`, with a comment
     explaining why the template's dotless ignore file does not cover them. Orchestrator edit.
  3. Implementor write access was already correct (its rule is a denylist), but the agent exposed a
     real gap: `e2e/*.spec.ts` and `playwright.config.ts` were not blocked, so an implementor could
     have edited its own Playwright gates. Both now blocked. All twelve role/path combinations
     retested; packages unaffected.
  4. `.oxlintrc.json` ships inside the template — confirmed. That a nested oxlint config still lets
     the repo-root `pnpm lint` exit 0 is an orchestrator step-7 check, not provable by the contract.
  5. `SMOKE_TEST_BASE_URL` and `DOKPLOY_DEPLOY_WEBHOOK_URL` accepted as new vocabulary.
  6. **Fact, verified — relative `.ts`/`.tsx` import specifiers work under Turbopack.** The repo-wide
     rule holds with no template exception. Spike: `app/page.tsx` importing `'../app-runtime-config.ts'`
     and `'../components/probe-card.tsx'`, with `allowImportingTsExtensions`, `erasableSyntaxOnly`,
     and `verbatimModuleSyntax` set — `tsc --noEmit` exit 0, `next build` exit 0, standalone server
     HTTP 200 rendering the imported component's output.
  7. **Fact, disproven — Prettier does not touch the `@source` literal.** Ran the repo's own Prettier
     config over a `globals.css` holding all three required lines: output byte-identical, double
     quotes preserved. No Prettier override is needed and none should be added.
     Accepted with two notes for later, neither worth a revision round: `appRuntimeConfigSchema`
     composes the two env fragments statically while `appEnvSchemaFragments` lists them at runtime
     (`HearthkitConfigOf` would avoid the duplication — the contract requires a gate asserting the two
     agree, which covers the drift risk); and the template's `tsconfig.json` deliberately cannot
     `extend` `tsconfig.base.json`, so it is a hand-maintained mirror that a gate must hold to the base.
- Phase 4 decisions 2026-08-28 (user):
  1. Ownership hook widened to accept `templates/*` for contract-author and gate-writer, plus
     `templates/*/e2e/*.spec.ts` and `templates/*/playwright.config.ts` for gate-writer.
     All twelve role/path combinations retested; packages unaffected.
  2. Optional-package sections (`storage`, `email`, `auth`, `payments`) are left OUT of the
     template for now. Each is added during that package's own Phase 5 loop, against a real
     contract.
  3. Slow gates (Docker build, Playwright) do not run per change. A local command runs them once
     at Verify before committing; CI runs them on manual trigger and on push to `main`, never on
     pull requests. Accepted tradeoff: the local run is the real gate, main is checked after merge.
  4. Project `deploy.yml` is written in full. Build and GHCR push get tested on a throwaway repo;
     the Dokploy webhook call stays untested until Phase 7 and must be recorded as such.
- `ui` cleanup round completed 2026-08-28 (23/23 gates, workspace typecheck and lint exit 0,
  all orchestrator-run), closing the five gaps the theming-doc work recorded:
  1. `buttonVariants` is now in `hearthkitUiMinimumExportNames` — the only `*Variants` recipe in
     the package, so the rule is "any recipe the fork pattern makes public API is guaranteed".
  2. `packages/ui/components.json` and a `@/*` → `./src/*` alias now ship in the package;
     `shadcn add` writes to `src/components/ui/`. Documented contract surface.
  3. Not fixed, by design: CLI output still needs its class-merge import and `cn` call sites
     fixed by hand, and `--overwrite` still strips doc comments. Stated as accepted tension in
     `packages/ui/CONTRACT.md`; `docs/theming.md` gives the procedure.
  4. `hearthkitThemeCssImportSpecifier` (`'@hearthkit/ui/hearthkit-theme.css'`) is exported and
     guaranteed, so scaffolder, template, and docs stop hardcoding the string.
  5. Closed favourably — no change needed to `tailwindSourceDirectiveForUi`. Tailwind 4.3.3
     `@source` follows pnpm symlinks in BOTH layouts Phase 4 can hit: a `workspace:*` direct
     symlink to the source dir, and the registry-style `.pnpm` virtual-store chain. Verified
     with negative controls in each (removing `@source` dropped the package's utilities while the
     app's own control class still compiled) and through `@tailwindcss/postcss`, byte-identical
     to the CLI, which is the path `templates/app` will actually use. The remaining Phase 4 risk
     on that literal is path depth (`globals.css` one level below app root), not symlink
     resolution.
- Correction to `docs/theming.md` found during the `ui` cleanup round: the tsconfig snippet
  prescribed `baseUrl`, which TypeScript 7 has REMOVED — `error TS5102` fails the workspace
  typecheck (orchestrator-verified against tsc 7.0.2). `paths` alone is what shadcn CLI 4.19.0
  needs; proven with a positive and a negative run. The doc and the package now both omit
  `baseUrl`. Applies to every future tsconfig in this repo, not just `ui`.
- Gate-writing note (2026-08-28): Tailwind escapes arbitrary-value class names in compiled CSS
  (`.tracking-\[0\.31em\]`), so any future gate asserting on compiled CSS must match the escaped
  form or assert on the declaration value instead.
- Phase 3 DoD completed 2026-08-28: `docs/theming.md` written with every example verified live
  in the scratch app (shadowed `IconLeadingButton` rendered beside package `Button`, both bound
  to app token overrides; dropping `@source` shrank compiled CSS 37 KB → 11 KB with utilities
  gone but tokens present — components silently unstyled, not an error; shadcn CLI 4.19.0 run
  against a scratch copy of `packages/ui`).
- Phase 3 DoD scratch-app half verified 2026-08-28 on merged main (7a25800): a scratch Next
  16.1.4 app (file: deps on `ui` + `observability`, `transpilePackages`, ui-contract globals.css
  with `@source`) rendered themed shadcn markup (SSR HTML shows `data-slot="button"` with
  `bg-primary` etc.; compiled CSS defines the hearthkit tokens in `:root` + `.dark` and generates
  the bound utilities) and `/health` returned 200 `{"status":"ok"}` with a REAL `pg` check
  against compose Postgres 17 (85 ms). Phase 3 stays unticked: `docs/theming.md` and the
  shadowed-component example are still owed from the `ui` loop.
  **Phase 4 constraint found (NOW SUPERSEDED — see the TypeScript 7 entry at the top of this
  section):** Next 16.1.4's `next.config.ts` loader needs the installed TypeScript's JS API,
  which `typescript@7.0.2` (tsgo native preview) does not provide (`Cannot read properties of
undefined (reading 'fileExists')`); `typescript@5.9.3` in the app fixed it. This held for
  16.1.4 only. Next 16.3.3 loads `next.config.ts` without the TypeScript API, so the template
  ships TS 7 and Next 16.3.3, and the TS 5.x workaround is not used.
- `observability` verified 2026-08-28 on pkg/observability: 14/14 gates (real compose
  Postgres for the db-reachability check; in-process node:http Sentry ingest mock), workspace
  typecheck and lint exit 0 (orchestrator-run; gate-runner reports in `.reports/observability-*.txt`).
  Implementor round 1 surfaced two gate-fixture defects (envelope path compared with the
  protocol's auth query string attached; an `import()` type annotation violating
  `consistent-type-imports`) — fixed by gate-writer, no assertion weakened, implementation
  untouched. Known accepted warnings: one `no-unsafe-type-assertion` in
  `create-health-route-handler.ts` caused by `z.input` stripping the `HealthCheckName` brand
  from option types (contract property, unreachable branch for type-correct callers).
- `observability` contract approved 2026-08-28 (orchestrator decisions, user may veto):
  `errorSampleRate` defaults 1, `tracesSampleRate` defaults 0 (conservative = no tracing volume;
  never silently sample out errors); `/health` failed checks expose the first line (max 200
  chars) of the thrown error in all environments (single-maintainer stack; production stripping
  is additive later); error reporting uses module-level singleton state matching the Sentry SDK
  global model, last `initializeErrorReporting` call wins. Health checks are app-wired named
  functions so observability never imports `@hearthkit/db`; the Phase 4 template owns the db
  ping wiring. `flushErrorReporting` added beyond the plan entry (capture is async under the
  hood; gates and graceful shutdown need it).
- `ui` verified 2026-08-28 on merged main (108367b): 23/23 gates (jsdom, no services),
  workspace typecheck and lint exit 0 (orchestrator-run; gate-runner reports in
  `.reports/ui-*.txt`), CI green after a STATUS.md-only prettier fix. Notable implementation
  facts: unified `radix-ui` package (current shadcn registry output) instead of per-primitive
  `@radix-ui/react-*`; `packages/ui/tsconfig.json` deviates from base NodeNext with
  `module: preserve` + `moduleResolution: bundler` (bundler-consumed package; NodeNext
  mis-models `@testing-library/user-event` types); doc comments on shadcn-generated exports
  would be stripped by a future `shadcn add --overwrite` (standing tension, unresolved).
  `docs/theming.md` + shadowed-component example still owed for the Phase 3 DoD.
- `ui` contract approved 2026-08-27 (orchestrator decisions, user may veto): shadcn-generated
  components keep canonical single-word names (`Button`, `Card` …) — renaming would break the
  plan-mandated shadcn-CLI workflow; hearthkit-authored exports follow the 2–4-word rule.
  Component set: button, card, input, label, dialog, dropdown-menu families + `PageContainer`,
  `PageHeader`, theme-mode trio, `mergeTailwindClasses`. `--destructive-foreground` omitted per
  current shadcn vocabulary (additive if needed). `tailwindSourceDirectiveForUi` literal assumes
  `app/globals.css` one level below app root; Phase 4 template must match.
- Phase 2 definition of done verified 2026-08-27 on merged main (7fd2b2d): in a scratch app
  (deps `@hearthkit/db` + Next 16.1.4, no docker-compose.yml), `hearthkit dev` run as bare
  `node .../hearthkit-bin.ts dev` generated the compose file, brought `postgres:17` up healthy,
  and started Next (page served 200). `dev infra down` removed container and network cleanly;
  repo compose restored after, db gates re-verified 24/24.
- `cli` verified 2026-08-27: 25/25 gates pass against compose Postgres 17 + Docker
  (orchestrator-run), workspace typecheck and lint exit 0 (lint warnings only, all in test
  fixtures). Gate-runner reports in `.reports/cli-*.txt`.
- User decision 2026-08-27 (hybrid TS execution): relative import specifiers are written
  `.ts`, not `.js`, in every package; `tsconfig.base.json` adds `allowImportingTsExtensions`,
  `rewriteRelativeImportExtensions`, `erasableSyntaxOnly`. Bare `node` runs any source file
  directly (the `hearthkit` bin is `src/hearthkit-bin.ts`, shebang + executable bit, no
  resolver hook). Verified on Node 24.20.0 + TS 7.0.2, including symlinked workspace packages.
  Constraint (Node policy, all versions through 26): TS in a REAL `node_modules` dir is refused
  (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so registry installs of Node-executed
  packages (`cli`, later `create`) need a publish-time build (`rewriteRelativeImportExtensions`
  emits clean `.js`) — deferred until publishing starts. Next-consumed packages need no build
  (`transpilePackages`). New relative imports must use `.ts`; typecheck will NOT catch a stray
  `.js` specifier (NodeNext maps it silently) — only bare-node execution or `rg` does.
- `cli` contract approved 2026-08-27 with these defaults: admin URL precedence is
  `--admin-database-url` flag > `HEARTHKIT_ADMIN_DATABASE_URL` env > compose default
  `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`; `db create` prints the
  connection string once, writes nothing; `db drop` has no confirmation prompt (scriptable;
  `--confirm` layer is additive later); generated compose goes to project-root
  `docker-compose.yml`, never overwriting an existing file; MinIO image pinned to the last
  Docker Hub community tag, final choice deferred to Phase 5.
- Phase 1 definition of done verified 2026-08-27: on merged main (886785b), local gates pass
  (config 12/12, db 24/24 against compose Postgres 17) and CI run 33121562483 on main is
  green with a Postgres 17 service container, PGDG `postgresql-client-17` (PATH-prepended —
  the runner's v16 client shadows v17 otherwise), and the workspace test step.
- Root lint flag `--no-error-on-unmatched-pattern` removed after Phase 1 landed; `pnpm lint`
  exits 0 without it.
- `db` contract approved 2026-08-27 with these decisions: admin connection is always an
  explicit `adminDatabaseUrl` parameter, never env; `DATABASE_URL` is always project-scoped;
  `createDrizzleClient` returns `{ drizzleClient, closeDatabaseClient }`; restore requires an
  existing target database (create-then-restore after a drop); credentials are returned once
  in the connection string and never persisted (persistence is future CLI scope).
- User decision 2026-08-27: backup/restore shell out to host `pg_dump`/`pg_restore` in all
  environments. Installed `postgresql@17` (17.11) via brew and force-linked it locally.
  CI must install `postgresql-client-17` and add a Postgres 17 service container plus a test
  step. Phase 7 `hearthkit vps bootstrap` must install `postgresql-client-17` on the VPS.
- Repo-root `docker-compose.yml` created (orchestrator, plan section 6): Postgres 17,
  admin URL `postgresql://hearthkit:hearthkit@localhost:5432/hearthkit`. Verified running
  (17.11).
- User decision 2026-08-27: staying with Zod (Valibot/TypeBox considered and rejected —
  server-side only, Better Auth brings Zod transitively anyway). Zod pinned exact 4.4.3
  in `@hearthkit/config`.
- `config` contract defaults accepted: config owns `NODE_ENV` (default `development`);
  empty-string env values are unset; `configEnvSchemaFragment` is passed explicitly,
  never auto-included. Downstream packages and the scaffolder must follow these.

Things checked against current docs that later steps can rely on. Clear when a phase completes.

- Switched to TypeScript 7.0.2 + oxlint 1.80.0 (user decision 2026-08-27), dropping
  eslint/typescript-eslint/jiti. oxlint-tsgolint 7.0.2001 provides type-aware rules
  (no-floating-promises verified working) and is versioned in lockstep with TS 7.
- TS 7 migration facts: `@types/node` is not auto-included — `tsconfig.base.json` sets
  `"types": ["node"]`, so every package must add `@types/node` as a dev dependency. Emit
  requires an explicit `rootDir` in each package tsconfig (error TS5011 otherwise).
  Declaration emit verified working.
- Root `typecheck` is now only `pnpm -r --if-present run typecheck` (no root tsconfig; there
  are no root TS files).
- Changesets is now 3.0.1 (config schema `@changesets/config@4.0.0`); `changeset init` is
  interactive-only, so `.changeset/config.json` was written by hand from the package's defaults.
- CI actions: `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` are current
  majors (v4 triggers a Node 20 deprecation annotation).
