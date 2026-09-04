# hearthkit status

Updated by the orchestrator after every commit. A fresh session reads this first to resume. Keep it short. History lives in git and `.changeset/`.

## Position

- Phase: 5 (`storage`, `email`, `auth`, `payments`) — in progress. `storage` and `email` done and
  merged. **`auth` in flight.** Phase 4 complete.
- Package: `auth` (depends on `config` and `db`, merged in Phase 1, and `email`, merged in Phase 5)
- Step: commit
- Branch: `pkg/auth`, cut from `main` at 6a8dbb5
- Last commit: 59949e0 on `pkg/auth` (PR #13, CI green, awaiting merge), on top of 6a8dbb5, the squash-merge of PR #12
  (`@hearthkit/email`), itself on top of
  96b5271 squash-merge of PR #11 (`cli` local storage bucket) and `f387155` squash-merge of PR #10
  (`@hearthkit/storage`)

## Phase checklist

Phases and their definitions of done are in `docs/PLAN.md` section 11.

- [x] Phase 0: foundation (done directly in the main session, no loop)
- [x] Phase 1: `config` (merged, PR #1), `db` (merged, PR #2)
- [x] Phase 2: `cli` (merged, PR #3)
- [x] Phase 3: `ui` (merged, PR #4), `observability` (merged, PR #5), `docs/theming.md` + verified shadowed-component example
- [x] Phase 4: `templates/app`, Dockerfile, project CI workflows (merged, PR #8); DoD verified on a throwaway repo
- [ ] Phase 5: `storage` (merged, PR #10), the `cli` local bucket (merged, PR #11) and `email`
      (merged, PR #12) done; `auth`, `payments` still to do
- [ ] Phase 6: `create`
- [ ] Phase 7: `infra/tofu`, `hearthkit vps bootstrap`, backups
- [ ] Phase 8: AI tooling, docs
- [ ] Phase 9: end-to-end verification, tag v1.0.0

## Package loop state

Only the current package is tracked here. Steps: contract, contract-review, gates, gates-review, implement, verify, commit.

| Package | Step   | Implementor rounds | Notes                                                   |
| ------- | ------ | ------------------ | ------------------------------------------------------- |
| `auth`  | commit | 2                  | PR #13 open, CI GREEN (run 33835915997), awaiting merge |

## Open issues

Items that blocked a loop and need a human decision. Remove when resolved.

- None. The "nothing creates a local storage bucket" item raised during the `storage` loop was fixed
  rather than left open: `hearthkit dev infra up` now creates it (PR #11).

## Verified facts this session

- **POST-AUTH AUDIT FOUND A REAL GAP OF THE SAME CLASS AS THE STORAGE-BUCKET ONE: a project depending
  on `@hearthkit/auth` gets ZERO local infra services.** Found by auditing for unfinished work after
  PR #13 went green, not by a failing test. `localInfraServiceByHearthkitPackage` in the `cli`
  contract mapped `db`→postgres, `storage`→minio, `email`→mailpit and **had no `auth` entry**, while
  `readInfraServicesFromDependencies` reads the project's **direct** dependencies only and never walks
  transitive ones (`read-project-infra-manifest.ts:83-95`). So `hearthkit dev infra up` starts nothing
  for such a project, succeeds with an empty service list, and auth then fails at runtime with a
  connection error that points nowhere near the manifest.
  - **The plan is incomplete here, not just the code.** `docs/PLAN.md` section 6's table has three
    rows and **no `auth` row**. Its implicit model is that leaf packages pull services and that Phase
    6's `create` does "dependency resolution", which would add `db` and `email` to a project selecting
    `auth`. That may be the intent, but nothing enforces it today. **Raised with the user; `PLAN.md`
    deliberately not edited by the orchestrator.**
  - Fixed by making the map **one-to-many** and renaming it to `localInfraServicesByHearthkitPackage`:
    `auth` → `['postgres', 'mailpit']`. Robust either way — if `create` does add the leaf packages
    directly the entry is redundant and harmless, because duplicates collapse.
  - **Three alternatives run down and rejected by the contract-author**, recorded so nobody re-derives
    them: a second key for `auth` is impossible (object keys are unique); making `create` add the
    leaf packages fixes only manifests `create` wrote, does not exist yet, and puts the knowledge in
    something that runs once at scaffold time rather than on every `dev infra up`; and walking
    transitive dependencies is correct in principle but would make a pure derivation depend on an
    installed `node_modules`, so `dev infra up` would behave differently before and after
    `pnpm install`. Left open as a resolver that could replace the map without changing a signature.
  - **The rename was an orchestrator override.** The contract-author wanted to keep the singular name,
    arguing a rename turns one breaking change into two. It does not: every consumer must already
    adapt to `'postgres'` → `['postgres']`, so updating the identifier on the same line is free, while
    a public name saying _one service per package_ when it means several is a permanent inaccuracy.
    Blast radius verified first — two readers, `index.ts:53` and `read-project-infra-manifest.ts`,
    and **no cli gate asserts the export list by name**, unlike `storage` and `email`.
  - **The shape change was confirmed to bite before any gate was written:**
    `pnpm --filter @hearthkit/cli run typecheck` now fails at `read-project-infra-manifest.ts:92` with
    `TS2345: Argument of type 'string' is not assignable to …`. The repo is knowingly broken there
    until the implementor lands the `flatMap`.

- **The `auth` contract's "Still not verified" section had gone STALE IN FIVE PLACES, describing the
  pre-implementation state after the package shipped.** A reader — most likely the `payments`
  contract-author — would have inherited all five as current. Rewritten in place with evidence rather
  than shrunk, because the section's value is that it is where a reader looks for what is _not_
  covered. Closed: the no-manifest claim (`packages/auth typecheck: Done` now grep-checked locally and
  on CI), the run-Prettier instruction (`format:check` exit 0), `authBrowserClientSchema` never parsed
  against a real client (a gate now does), the 404/401 measured only at the handler (a gate now drives
  the real client through a loopback listener), and — found by the contract-author, not the audit —
  whether either half of that gate needs a reachable database (it does not; both instances use a
  Drizzle client aimed at a closed port). `auth-contract.ts` was **not** touched, so nothing verified
  was invalidated.
  - **The drizzle peer-suffix pin was rewritten rather than corrected.** It named the literal
    `…(@types/pg@8.23.1)(pg@8.23.0)`, which installing `auth` changed to
    `…(@types/pg@8.23.1)(kysely@0.29.5)(pg@8.23.0)` because `better-auth` brings `kysely`. **Naming an
    exact peer suffix in a contract is fragile by construction** — `payments` will change it again —
    so the durable facts now carry the weight: `@types/pg` must be declared, and the check is that the
    two packages' `drizzle-orm` resolve to the same real path.

- **CI GREEN ON PR #13 (run 33835915997), and the proof that matters is that the new gates RAN on the
  runner rather than being skipped: `packages/auth test: Test Files 12 passed (12), Tests 40 passed
(40)`.** All nine projects green in the same run — config 12, ui 27, observability 14, storage 21,
  db 24, email 25, app-template 27, **auth 40**, cli 39 = **229 tests, zero failed, zero skipped** —
  and `packages/auth typecheck: Done` on the runner too.
  - **`packages/email test: 25 passed (25)` in the SAME CI run as auth's 40 is the load-bearing line.**
    It proves the own-Mailpit-container decision holds on a runner and not merely on this machine,
    which is the half that local runs cannot establish. `packages/cli test: 39 passed (39)` confirms no
    port regression from the container the auth suite starts.
  - The auth gates start a Docker container on the runner successfully with **no change to `ci.yml`**,
    which was the design goal: self-sufficient on any runner that has Docker.
  - **Reading the CI log needs ANSI stripped first.** `gh run view --log` embeds escape sequences
    _between_ `Tests` and the count, so a plain `rg "Tests +[0-9]+ passed"` matches nothing and looks
    exactly like a suite that never ran. Pipe through `perl -pe 's/\e\[[0-9;]*m//g'` first. Recorded
    because the false negative is indistinguishable from the real failure it would be reporting.

- **`auth` IMPLEMENTED AND GREEN IN ONE IMPLEMENTOR ROUND, 2026-09-03.** Orchestrator-run, not taken
  from the subagent: `pnpm --filter @hearthkit/auth test` **12 files, 40/40 passed**, exit 0;
  `pnpm --recursive --if-present run test` exit 0 — **9 projects, 229 tests, 0 skipped** (config 12,
  ui 27, observability 14, storage 21, db 24, email 25, app-template 27, **auth 40**, cli 39);
  `pnpm run typecheck`, `pnpm install --frozen-lockfile` and `pnpm run format:check` all exit 0.
  A second implementor round was spent on one missing doc comment only.
  - **`packages/auth typecheck: Done` genuinely appears in the project list, checked by grep rather
    than inferred from exit 0.** That trap has now caught this repo six times; the manifest closes it.
  - **`email` is 25/25 in the SAME sweep as `auth` 40/40, which is the proof the Mailpit isolation
    decision was right.** The two suites run in parallel against different containers and neither
    disturbs the other — exactly the collision measured earlier in this loop.
  - **The drizzle single-copy risk is closed and verified:** both `packages/auth/node_modules/
drizzle-orm` and `packages/db/node_modules/drizzle-orm` resolve to the identical real path. The
    peer suffix has **changed** from what the contract records, to
    `…(@types/pg@8.23.1)(kysely@0.29.5)(pg@8.23.0)` — `better-auth` brings `kysely`, which drizzle
    declares an optional peer. **The contract's literal suffix string is therefore stale, though its
    conclusion is not.** The lesson is not to update the string: naming an exact peer suffix in a
    contract is fragile by construction, because the next package added to the workspace will change
    it again. `@types/pg` being load-bearing is the durable fact; the suffix is not.
  - Rule scan clean, orchestrator-run: no `export *`, no barrel, no `any`, no bare-role filenames
    beyond the sanctioned `index.ts`, 23 implementation files. **Exactly one lint warning in the whole
    implementation** — a documented `as unknown as AuthBrowserClient` — against a 72-warning
    pre-existing repo baseline.
  - **Best judgement call of the round, and no gate forced it:** `databaseFailureDetail` is built from
    the `.cause`, not from the `DrizzleQueryError` wrapper, because the wrapper's message repeats the
    failing SQL **and its bound parameters** — which would put caller-supplied values into a returned
    failure that the gates sweep for secrets. Reasoned from the contract's rule rather than from a
    failing test.
  - Other implementor judgement calls accepted: `returnHeaders: true` over `asResponse: true`
    uniformly, because it keeps failures _thrown_, which is what the `error.body?.code` and
    `error.headers.get('location')` access paths are specified against; a `WeakMap` keyed on the
    instance to carry the magic-link send outcome, since Better Auth answers `{status: true}`
    regardless of what `sendMagicLink` did (`AsyncLocalStorage` rejected to keep `node:async_hooks`
    out of an entry point a client component imports) — **consequence: an instance not built by
    `createAuthServerInstance` gets `auth-request-failed` from `requestMagicLinkSignIn`, and no gate
    covers that path**; nameless Drizzle columns so every SQL name equals its Better Auth field name;
    and the organizations-disabled check running before input validation, because telling a caller
    their slug is malformed when the instance has no organization endpoints is the worse diagnostic.

- **`auth` GATES APPROVED 2026-09-03 at 40 gates, ORCHESTRATOR-VERIFIED FAILING 40/40 FROM THE
  COMMITTED FILES, with the distinguishing control run separately.** Harness rebuilt by copying the
  final committed files (`diff -r` clean, byte-identical), no implementation, no manifest.
  - Repo state: **12 files failed, 40/40 gates failed, 0 skipped**, exit 1. No `AssertionError`,
    `TypeError`, `ReferenceError` or `SyntaxError` from setup — every failure a gate diagnostic
    (34 "could not load the public entry point", 2 "expected a package manifest").
  - **Distinguishing control** (stub `index.ts` exporting one unrelated value, plus a manifest):
    **39 failed, 1 passed, 0 skipped**, and the failure text _changed_ to
    `gate expected @hearthkit/auth to export …` (32) and `must re-export these by name` (2). **This is
    the run that proves the gates exercise the contract**; the all-fail run alone would look identical
    whether the gates were good or garbage, since nothing resolves. The single pass is the
    manifest/subpath gate, correct because the control supplies exactly the manifest it tests.
  - The re-export list reads **100** contract values, up one from 99 — matching the
    `betterAuthOrganizationAlreadyExistsHttpStatus` added in the last contract round, so the derived
    list tracks the contract rather than being hand-maintained.
  - Contract final at **166 exports / 166 doc comments**, isolated typecheck exit 0, `format:check`
    exit 0. Five correction rounds total, every one driven by a measurement rather than an opinion.

- **A MISSING `@types/pg` WOULD HAVE BROKEN THE IMPLEMENTOR, and it is invisible in the dependency
  list it is missing from.** Found by the gate-writer typechecking the gates, confirmed by the
  orchestrator in the repo: `packages/db` devDepends on **both** `pg@8.23.0` and `@types/pg@8.23.1`,
  and `pnpm-lock.yaml` holds exactly **one** peer-suffixed resolution,
  `drizzle-orm@0.45.2(@opentelemetry/api@1.9.1)(@types/pg@8.23.1)(pg@8.23.0)`. The contract's dev list
  for `auth` named `pg` and **not** `@types/pg`.
  - Written verbatim, `auth` resolves a drizzle-orm with a **different peer suffix**, pnpm materialises
    a **second physical copy**, and `@hearthkit/db`'s client stops being assignable to
    `@hearthkit/auth`'s `drizzleClient`. **Not a soft mismatch a cast could hide**: `PgSession.dialect`
    is `protected`, so the declarations are structurally incompatible and TypeScript refuses outright —
    `TS2322 … Property 'dialect' is protected but type 'PgSession<…>' is not a class derived from
'PgSession<…>'`, reproduced.
  - **The diagnostic points at Drizzle, not at the dependency list**, which is what makes it expensive:
    an implementor would debug the client type rather than the manifest. The contract now says why the
    `@types` package is there, so nobody prunes it later as unused.

- **FOURTH INSTANCE OF THIS PACKAGE'S RECURRING SHAPE — the obvious spelling returns a WRONG ANSWER
  rather than an error.** `createAuthClient` binds its fetch implementation at **construction time**
  (`customFetchImpl: fetch` into `createFetch`), so a gate that assigns `globalThis.fetch` _after_
  building its client silently keeps the real one and makes real network requests. The gate-writer's
  first probe did exactly that, and something on the machine answered `http://localhost:3000` with a
  full Next.js page — **the gate would have been asserting against a stranger**, and on CI it would
  have been `ECONNREFUSED` instead. Joins `error.code`, `error.headers.location` and the decoy error
  constants. The gates use a real loopback listener, which has no ordering hazard.
  - Trap recorded in the gate: **never assert `statusText` here.** The same 401 reads `UNAUTHORIZED`
    from a fetch stub and `Unauthorized` once Node's HTTP server has written it. Only `status` is
    stable.

- **`auth` GATES WRITTEN 2026-09-03: 40 gates in 12 files (was 38; the browser-client file went 1 → 3
  after the Proxy finding), ORCHESTRATOR-VERIFIED FAILING with
  ZERO SKIPPED**, against a harness built by copying the committed files (`diff -r` clean, no
  implementation, no manifest — the repo's actual state). No `AssertionError`, `TypeError`,
  `ReferenceError` or `SyntaxError` anywhere in the output, so no collection or setup errors: every
  failure is a deliberate gate diagnostic (34 "could not load the public entry point", 2 "expected a
  package manifest").
  - **The old single browser-client gate held six assertions and EVERY ONE WAS VACUOUS** under the
    Proxy finding — zero coverage in the shape of coverage. Replaced by three: one non-vacuous root
    check, one that **pins the vacuity itself** (it fails if a release stops proxying or if anyone
    wraps the client), and the relocated network-boundary pair. Structurally audited by the
    orchestrator afterwards: 40 `it()` blocks across 12 files, 0 mocks, exactly one dynamic
    `import('@hearthkit/auth')`, and **zero `beforeAll` in any gate file**, which is what keeps the
    no-skip property structural rather than incidental.
  - **`pnpm --filter @hearthkit/auth test` prints `No projects matched the filters` and exits 0 — the
    SIXTH time this repo has hit that trap.** That exit 0 is evidence of nothing.
  - **The distinguishing control was run by the orchestrator, because an all-fail run proves almost
    nothing on its own.** With a resolvable stub `index.ts` exporting one unrelated value plus a
    manifest: **37 failed, 1 passed**, and the failure text _changed_ from "could not load the public
    entry point" to `gate expected @hearthkit/auth to export resolveAuthRuntimeConfig` and `src/index.ts
must re-export these by name`. So the gates exercise the contract rather than merely failing to
    resolve it. The single pass is the bare-node subpath gate, which is correct — the control handed it
    exactly the manifest it tests. Reconciles with 38/38 in the repo, where no manifest exists.
  - Import discipline audited, not taken on trust: the only route into the package is one dynamic
    `import('@hearthkit/auth')` in `test-fixtures/hearthkit-auth-entry.ts`. Gate files import only
    `./auth-contract.ts`, `../test-fixtures/*`, `vitest`, node builtins, `zod`, `pg`, `drizzle-orm`,
    `@hearthkit/db`, `@hearthkit/config`, `@hearthkit/email/email-contract`, and `better-auth/db` +
    `better-auth/plugins` for the conformance gate. **No implementation module.**
  - **Zero mocks** — `vi.mock`, `vi.fn`, `vi.spyOn` all return 0 hits. The sanctioned Resend-style
    exemption went unused again.
  - Gate-writer judgement calls accepted: Mailpit via bare `docker run --rm` on the default bridge
    rather than a compose project, because `cli`'s fixtures show the compose _network_ is the part that
    leaks; DDL built from `hearthkitAuthDrizzleSchema` via `getTableConfig` with columns, not-null,
    primary and unique but deliberately **no** foreign keys, indexes or defaults (measured sufficient);
    rows read through Drizzle rather than raw SQL, since the contract leaves SQL column naming to the
    app — the reference run used snake_case on purpose to prove it; and **a lazy per-file context
    instead of `beforeAll`, because a throwing `beforeAll` makes Vitest report every test in the file
    as SKIPPED, and a skipped gate is not a failing gate** (the first draft reported "12 files failed,
    29 skipped").
  - It also proved the gates _satisfiable_, beyond what was asked: a throwaway reference implementation
    in the harness only reached **38/38 passing in ~20 s**. And it proved the Mailpit isolation works —
    auth and `email` suites started two seconds apart both went green, 38/38 and 25/25.

- **THREE CONTRACT DEFECTS FOUND BY BUILDING AGAINST IT, all measured by the orchestrator rather than
  taken from the report, and ONE IS A HARD BLOCKER.** This is the gate step doing its job — the same
  pattern as the `email` loop, where the gate-writer found four contract gaps.
  1. **`authBrowserClientSchema` REJECTS THE VALUE ITS OWN FUNCTION IS SPECIFIED TO RETURN.**
     `createAuthClient` returns a **Proxy whose target is a function**, so measured against the real
     client: `typeof client` is `'function'` not `'object'` (fails the schema's first check),
     `typeof client.signIn` is `'function'` not `'object'`, and `typeof client.signUp` likewise.
     **`authBrowserClientSchema.safeParse(realClient).success` is `false`**; only the `useSession`
     check passes. The implementor cannot both return a Better Auth client and satisfy the schema.
     **The gate-writer reported this as one wrong check; it is three** — it missed the root
     `typeof value === 'object'`.
  2. **The browser client cannot observe the organizations flag at all.** The contract says
     `organization` is present only when the flag is on and "that presence-or-absence is the flag's
     observable effect on the client and it is what a gate asserts". Measured: the client is a blanket
     Proxy — with the plugin **absent**, `typeof client.organization` is `'function'`,
     `typeof client.organization.create` is `'function'`, and even
     `typeof client.definitelyNotAPlugin` is `'function'`. `'organization' in client` is **`false` in
     both** configurations. There is no client-side distinction to assert.
     - **USER DECISION 2026-09-03: keep the contract's intent and relocate where the effect is
       observed — assert it at the NETWORK BOUNDARY.** Building the browser client with the flag off
       and routing its `organization` call through a server instance built with the flag off fails,
       because the server has no such endpoint. The client carries `organization` in both modes and
       that cannot be changed; the failure surfaces when the call reaches a server with no such route,
       not when the property is read.
     - Two alternatives were put to the user and rejected: narrowing the promise and deleting the gate
       (loses a real assertion, makes the client-side flag decorative), and wrapping the client so
       `organization` is genuinely absent (adds public surface and the returned value stops being a
       plain Better Auth client, which would surprise app authors).
     - **Corollary worth more than the fix: every property check on this Proxy is vacuous.**
       `typeof client.useSession === 'function'` would pass against a client with no `useSession` at
       all, because `typeof client.definitelyNotAPlugin` is also `'function'`. The only non-vacuous
       assertion is on the root value. Recorded in the contract so nobody "hardens"
       `authBrowserClientSchema` with checks that assert nothing.
  3. **`SLUG_TAKEN` DOES NOT EXIST.** The contract illustrates `auth-request-failed` with
     `authErrorCode: 'SLUG_TAKEN'`. It appears **zero times** in `better-auth`'s dist. The real code
     for a slug collision is `ORGANIZATION_ALREADY_EXISTS` at HTTP 400, which the orchestrator had
     already seen in `$ERROR_CODES` during the earlier probe. A gate asserting the contract's value
     would have failed against every correct implementation.

- **The network-boundary gate needs NO reachable database, measured.** With the Drizzle adapter
  pointed at a dead port, the flag-off instance still returns **404** and the flag-on instance still
  returns **401** — route resolution and the session check both happen before any query. So that gate
  is database-free: faster, and it cannot flake on database setup. Answers the contract-author's two
  open questions in one probe.

- **THE NETWORK-BOUNDARY MEASUREMENT THAT MAKES THE USER'S RULING GATEABLE, and it comes with its own
  negative control.** Same POST to `/api/auth/organization/create` handed to
  `authServerInstance.handler(request)`:

  | Server instance                          | Status  | Body  |
  | ---------------------------------------- | ------- | ----- |
  | built with `organizationsEnabled: false` | **404** | empty |
  | built with `organizationsEnabled: true`  | **401** | empty |

  **The 401 is the load-bearing half.** The same request with no session on it returns 401 from the
  flag-on instance, which proves the route _exists_ and was rejected for want of a session rather than
  for want of a route — so the 404 means "no such endpoint" and not "typo in the path". A gate
  asserting only the 404 could be satisfied by a misspelled URL. Same argument as the STARTTLS and
  presign gates.

- **`ORGANIZATION_ALREADY_EXISTS` CONFIRMED AS THE SLUG-COLLISION CODE (HTTP 400, message
  `Organization already exists`, `body` present) — AND THE DECOY IS ONE LINE AWAY.** Both
  `ORGANIZATION_ALREADY_EXISTS` and `ORGANIZATION_SLUG_ALREADY_TAKEN` exist at the tag as adjacent
  `$ERROR_CODES` entries; only the first is thrown. **Third time this package has been bitten by that
  shape** — `USER_ALREADY_EXISTS` vs `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, the fabricated
  `SLUG_TAKEN`, and now this. Naming the decoy in the contract is what stops the fourth. **Generalised
  rule for this library: never take an error-code constant from documentation or memory — read it off
  a thrown error, because the enum reliably contains a plausible near-miss.**

- **`error.body` IS `undefined` ON AT LEAST ONE PATH, so `error.body?.code` is required rather than
  stylistic — a correction ON THE ORCHESTRATOR'S OWN TEXT, caught by the contract-author.** Correction
  round 1 said `error.body` "carries exactly `{ message, code }`". Measured on more paths since: the
  `createOrganization`-with-headers 401 carries `body === undefined`, so `error.body.code` throws a
  `TypeError` and breaks the package's "never throws" promise on that path. The original claim was
  measured only on the cases probed at the time and is false in general.

- **IMPLEMENTOR INSTRUCTION, measured, that no contract sentence implies: `packages/auth/package.json`
  must carry `next@16.3.3` in devDependencies or the gates cannot pass.** The contract lists `next` as
  an optional peer and claims `nextCookies()` "swallows the failure when `cookies()` is called outside
  a request scope". At the pin the plugin's hook swallows only errors whose message starts with
  `` `cookies` was called outside a request scope. `` or includes `Cannot find module`. With `next`
  absent, Node's ESM resolver says `Cannot find package 'next' imported from …`, which matches
  **neither**, so the error is rethrown and every cookie-setting call fails. Sign-up, sign-in and
  magic-link verification all returned `auth-request-failed` until `next@16.3.3` was installed. It
  stays an optional peer for consumers.

- **Two measured hazards for the implementor, neither a contract defect.** Server-side `api` calls
  disagree about `headers`: `signInMagicLink` and `magicLinkVerify` **require** one (`APIError` 400
  `VALIDATION_ERROR`, `Headers is required`, without it — the orchestrator hit this too), while
  `createOrganization` must be called **without** one (passing `new Headers()` gives `UNAUTHORIZED`
  401 with `body: undefined` and an empty message, which reads like a bug in your own code).
  `addMember` tolerates either. And **verifying a magic link for a user who already has a password
  deletes that user's `account` rows** at this pin, so password sign-in for them fails afterwards;
  reproduced twice. The gates never mix the two paths on one user.

- **`auth` GATES MUST NOT SHARE THE REPO'S MAILPIT, AND THIS WAS PROVEN BEFORE THE GATES WERE
  COMMISSIONED RATHER THAN DISCOVERED IN CI.** `email`'s gates call `clearMailpitInbox()` —
  `DELETE /api/v1/messages`, which wipes **every** message in the container, not just its own — in a
  `beforeEach`, and make **nine** assertions on the exact total message count. The recursive sweep
  runs projects **in parallel** (measured: storage, email, observability and db all started within
  one second of each other). `auth` would be sending magic-link mail into the same container.
  - **Demonstrated, not reasoned about.** With a second process sending one message into Mailpit
    every 250 ms — exactly what an `auth` suite looks like from outside —
    `pnpm --filter @hearthkit/email test` went **25/25 → 23/25, two failures, exit 1**:
    `delivers the magic link to Mailpit with the same subject and both body parts` and
    `returns email-transport-rejected … when the server refuses the recipient`.
  - **Negative control run immediately after, same command, intruder stopped: 25/25, exit 0.** So the
    failures were caused by the second suite and nothing else. It breaks in **both** directions —
    `email`'s `beforeEach` DELETE would equally wipe an `auth` message before `auth` could read it.
  - **Same class as the port collision one loop ago**, and the third shared-resource collision in this
    phase: compose lacked a service CI needed (PR #10), then compose held ports another package's
    gates published (`email` loop), now a container's _contents_ are shared mutable state across
    packages. **Generalised: a service in the repo compose is shared mutable state, and any gate that
    clears or counts its whole contents cannot coexist with another package's gates.**
  - **Ruled: `auth` gates start their own Mailpit on reserved ports**, following the precedent this
    file already endorses for the `cli` bucket gates — "they start their own compose stack on reserved
    ports rather than borrowing the repo's MinIO, so they are self-sufficient on a runner that only
    has Docker". Helpers exist: `reserveFreeHostPort` and `gate-compose-project-runs.ts` in
    `packages/cli/test-fixtures/`. Postgres is still borrowed from compose, which is safe because
    `auth` creates its own scratch **database** per run — isolation is already per-database there.
  - Bonus: this touches neither `docker-compose.yml` nor `ci.yml`, so the new-service trap that failed
    PR #10 has nothing to bite on.

- **ORCHESTRATOR PROCESS NOTE: an invented constraint made a file worse, and the subagent was right to
  push back rather than comply.** While closing two doc comments the orchestrator told the
  contract-author to "keep them under 100 characters". That ceiling exists nowhere in the repo.
  Measured after the subagent challenged it: `auth-contract.ts` doc comments run 38 to 135 characters
  with a **median of 114, and 120 of 162 exceed 100**; the eight sibling prefix constants run 111 to
  129; `email-contract.ts` has **67 of 84** over 100 and `storage-contract.ts` **51 of 67**. Prettier
  passes all of them because it does not reflow comments.
  - The cost was real: to fit 100 characters the agent had to drop "of the failure message" from the
    stem, making line 30 **the only one of nine prefix constants** not matching the shared phrasing —
    breaking a grep target that `CLAUDE.md`'s discoverability rule exists to protect. Reversed.
  - **The generalisable rule: check the file before imposing a style number on it.** `format:check`
    passing is not evidence a self-imposed limit is the convention, because Prettier never touches
    comment interiors. Two of the three ruling errors this session were the orchestrator asserting a
    norm it had not measured; the other was rewrapping, caught the same way.

- **THE SHARPEST EDGE IN THE `auth` CONTRACT, found by the contract-author reading upstream source
  and then MEASURED at the 1.7.2 pin by the orchestrator: `auth-email-already-registered` has a
  producer ONLY because of two defaults this package happens to keep.** Upstream `sign-up.ts`
  computes `shouldReturnGenericDuplicateResponse = requireEmailVerification || autoSignIn === false`
  and returns a generic success instead of throwing when it holds. All three configurations run:

  | `emailAndPassword` config         | Duplicate sign-up                                    |
  | --------------------------------- | ---------------------------------------------------- |
  | default (what this package ships) | **THREW** `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`    |
  | `autoSignIn: false`               | **NO THROW** — returned `{token: null, user: {...}}` |
  | `requireEmailVerification: true`  | **NO THROW** — returned `{token: null, user: {...}}` |
  - **The generic response is indistinguishable from a real sign-up** — same shape, populated `user`,
    `token: null`. The duplicate is not reported differently, it is not reported at all.
  - **Enabling `requireEmailVerification` deletes the variant's only producer and breaks its gate**,
    and so does `autoSignIn: false` — the one nobody would think to check. Both are named in the
    contract's out-of-scope bullet.
  - Upstream does this deliberately: suppressing the throw stops the sign-up endpoint being a
    user-enumeration oracle. So enabling verification trades a named failure for a security property.
    Recorded so nobody "fixes" it back.

- **The magic-link 302 throw DOES carry the location header, so `asResponse: true` is a choice rather
  than a requirement.** Caught from `magicLinkVerify` with a bad token and no `asResponse`: a plain
  `Error`, `isAPIError: false`, `statusCode: 302`, own keys `[status, body, headers, statusCode,
name]`, `headers` a real `Headers` instance, and **`e.headers.get('location')` returns
  `http://localhost:3000/dash?error=INVALID_TOKEN`** while **`e.headers.location` is `undefined`**.
  Same shape of trap as `error.code` vs `error.body.code` — the value is only reachable through the
  accessor. Closed a gap the contract-author flagged as possibly costing an implementor round.

- **`auth-database-unavailable` WIDENED from two Postgres codes to four, because the contract-author's
  rule was right but the fact under it had stopped being true.** It had limited the variant to
  `42P01` and `ECONNREFUSED` on the stated grounds that no gate could produce another code. Both of
  these were then produced with nothing but a different connection string: a database that does not
  exist gives `DatabaseError` `code: '3D000'`, and a wrong password gives `code: '28P01'`. Both are
  the same operator-fix class, both are ordinary wrong-`DATABASE_URL` first-run states, and both are
  **cheaper to gate than either original producer** — no dead port, no dropped table.
  - Ruled an **explicit four-code allowlist** (`ECONNREFUSED`, `42P01`, `3D000`, `28P01`), not "any
    cause carrying a code": the general form would swallow a `23505` unique violation, which is a
    caller error rather than an unavailable database, and the organization slug path can produce one
    under a race. Everything outside the four stays in `auth-request-failed`.

- **BETTER AUTH 1.7.2 PROBED DIRECTLY BY THE ORCHESTRATOR, 2026-09-03, against a real install plus
  real Postgres and real Drizzle tables. Most of the contract held; FIVE claims did not, and TWO of
  the contract-author's questions rested on a false premise.** Probe lives in the scratchpad, not the
  repo. Sent back as correction round 1.

  **Confirmed, so nobody re-derives them:**
  - The magic-link failure signal **is** a redirect. Bad token with a `callbackURL` → **302**,
    `location: …/dash?error=INVALID_TOKEN`. It throws an `Error` with `statusCode: 302`, empty
    message, `instanceof APIError === false`, **no code anywhere**.
  - **Unknown, consumed and expired tokens are genuinely indistinguishable** — all three give the
    identical 302/no-code/empty-message. So one variant covering all three is honest, not lazy.
    `TOKEN_EXPIRED` exists in `$ERROR_CODES` but magic-link never emits it.
  - Valid verify with no `callbackURL` → 200 JSON `{token, user, session}` plus a `set-cookie`.
  - `INVALID_EMAIL_OR_PASSWORD` / HTTP 401 for **both** a wrong password and an unknown email.
  - Org endpoints are structurally absent without the plugin: `typeof api.createOrganization` is
    `'function'` with it, `'undefined'` without. Structural detection works.
  - `getAuthTables()` for the pinned version returns exactly seven tables — `user, session, account,
verification, organization, member, invitation` — with `session.activeOrganizationId` present and
    **`account.issuer` required**.
  - `autoSignIn` is **on by default**: `signUpEmail` returned a token and a `set-cookie`.

  **Wrong, and the first is a live defect:**
  - **THE SIGN-UP ERROR CODE IS `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (HTTP 422), NOT
    `USER_ALREADY_EXISTS`.** The contract encoded the wrong one at `auth-contract.ts:55`. **Both
    constants exist in `$ERROR_CODES` as distinct entries**, so a reader checking the library would
    have confirmed the wrong answer. An exact match never fires and every duplicate sign-up would
    land in the catch-all with its own gate failing. **Mirror of the `19000:9000` `String.includes`
    defect already recorded below**, in the opposite direction: here a sloppy _substring_ match would
    accidentally work and an exact one fails. The contract now pins the exact code and says the match
    is equality, so nobody "fixes" it into a substring test.
  - **The magic link URL ALWAYS carries two parameters.** With no `callbackUrl` supplied the link is
    `…/magic-link/verify?token=<…>&callbackURL=%2F` — `callbackURL` is always appended, defaulting to
    `%2F`. The contract said "plus `&callbackURL=…` when supplied". **This makes the repo's existing
    `textBody`-extraction rule unconditional rather than a precaution**, which is why it matters: as
    written it implied a single-parameter link exists, and a single-parameter URL _does_ survive
    React Email's escaping verbatim in `htmlBody`. A gate written against the old sentence would have
    passed for the wrong reason and rotted.
  - **The error code lives at `error.body.code`. `error.code` is `undefined`.** `error.body` is
    exactly `{message, code}`; `error.statusCode` is the number and `error.status` the string name
    (`'UNAUTHORIZED'`, `'UNPROCESSABLE_ENTITY'`). An implementation reading `error.code` gets
    `undefined` for every case and routes everything to the catch-all — total and invisible.
  - **Database failures arrive as raw Drizzle errors with the code exactly one `.cause` hop down**,
    never as an `APIError`. Dead port → `DrizzleQueryError` (**no code**) → cause `AggregateError`
    `code: 'ECONNREFUSED'`. Tables absent → `DrizzleQueryError` (**no code**) → cause `DatabaseError`
    `code: '42P01'`, `relation "user" does not exist`. So the implementation must handle two
    unrelated error families from one call, and a top-level code check finds nothing.
  - `activeTeamId` is added **only when teams are enabled**; with the shipped configuration `session`
    gains `activeOrganizationId` alone. Also: **`drizzleAdapter` requires the `schema` option** —
    omitting it throws `BetterAuthError: … The model "user" was not found in the schema object.`

  **BOTH TOOLING QUESTIONS REJECTED ON MEASURED FACTS, and the replacement is better than either
  option offered.**
  - **`npx @better-auth/cli generate` CANNOT RUN AT OUR PIN.** `npx @better-auth/cli@1.7.2` fails
    `ETARGET: No matching version found`. **`@better-auth/cli`'s latest is 1.4.21** — three minors
    behind `better-auth@1.7.2` — and **`better-auth@1.7.2` ships no `bin` at all**. A 1.4.21 CLI is
    precisely what would miss the 1.7 `issuer` column the suggestion existed to protect against.
  - **`drizzle-kit` is not needed either.** `getTableConfig` from `drizzle-orm/pg-core` is public and
    returns each column's `name`, `getSQLType()`, `notNull` and `primary` — enough for a gate to
    build `CREATE TABLE` from the shipped `hearthkitAuthDrizzleSchema` itself, using a dependency the
    package already has. Deriving DDL from the shipped schema beats a SQL fixture _and_ drizzle-kit,
    because the gate then cannot test a schema different from the one the package exports.
  - **Replacement ruled: a conformance gate** asserting every table and field `getAuthTables()`
    reports has a matching column in `hearthkitAuthDrizzleSchema`. Re-checks on every dependency
    bump instead of only at authoring time. **Proven to bite before being prescribed** — run against
    a hand-written seven-table schema it immediately reported `invitation.createdAt MISSING`, a real
    omission made without noticing.
  - Recorded, not a required change: `better-auth/adapters/drizzle` and `@better-auth/drizzle-adapter`
    export the **identical function object** (`===` is `true`), so the separate dependency is
    optional indirection and the two import paths carry no version-skew risk.

- **`auth-contract.ts` TYPECHECKS IN ISOLATION, and the check was proven load-bearing.** `tsc
--noEmit` with `strict`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`
  and `isolatedModules`, against a scratchpad harness with `zod`, `drizzle-orm`, `@types/node` and
  `packages/email` symlinked: **exit 0, no diagnostics**. This matters because `pnpm run typecheck`
  still exits 0 **without checking this package** — `packages/auth` has no manifest, the fifth time
  this repo has hit that trap. **Negative control run**: repointing the import to
  `@hearthkit/email/NOPE-contract` fails with `TS2307`, so the exit 0 really did resolve the
  `./email-contract` subpath and the `drizzle-orm/node-postgres` type import rather than skipping
  them. 162 exports, 162 doc comments — full coverage. No `any`, no `export *`.

- **POST-MERGE BASELINE ON `main` AT `6a8dbb5`, orchestrator-run, so any later `auth` regression is
  attributable.** `pnpm --recursive --if-present run test` **exit 0, 8 projects, 189 tests across 46
  files** — config 12/2, ui 27/5, observability 14/4, storage 21/8, db 24/6, email 25/5,
  app-template 27/9, cli 39/7. `pnpm run typecheck` exit 0 (9 projects), `pnpm run lint` exit 0
  (three pre-existing `no-unsafe-type-assertion` warnings in `config` and an `email` gate, unchanged),
  `pnpm run format:check` exit 0. `docker compose up -d --wait postgres minio mailpit` exit 0, all
  three healthy.

- **`email` MERGED 2026-09-03 as `6a8dbb5`, squash-merge of PR #12, branch `pkg/email` deleted.** CI
  was green on the PR's actual head commit `b576144` (run 33301005140), not only on the earlier
  `3411332` (run 33300843861) — checked before merging, because the docs commit sat on top of the
  implementation commit and it is the head that CI's rollup reports. `pkg/auth` cut from `main` at
  `6a8dbb5`, working tree clean.

- **`auth` opens WITHOUT the new-service trap that cost PR #10 a red CI, and this was checked rather
  than assumed.** `auth`'s gates need Postgres and Mailpit. `ci.yml` already runs Postgres as a
  service container (`postgres:17`, line 12) and already runs
  `docker compose up -d --wait minio mailpit` (line 58), added during the `email` loop. So the
  standing rule — adding a service to `docker-compose.yml` is only half the job — has nothing to bite
  on here. If the `auth` gates turn out to need a service beyond those two, `ci.yml` must be taught
  about it in the same commit.

- **CI GREEN on PR #12 (run 33300843861), and the proof that matters is that the new gates RAN on the
  runner rather than being skipped: `packages/email test: Test Files 5 passed (5), Tests 25 passed
(25)`**, against a real Mailpit started from the repo's compose file. `packages/cli test: 39 passed
(39)` on the same run is the other load-bearing line — that is where the port-collision regression
  would have surfaced, so it confirms the remap works on a runner and not just locally.
  `packages/storage test: 21 passed (21)`, unregressed. Commit `3411332`, branch `pkg/email`, not yet
  merged.

- **`email` IMPLEMENTED AND GREEN IN ONE IMPLEMENTOR ROUND, 2026-08-30.** Orchestrator-run, not taken
  from the subagent: `pnpm --filter @hearthkit/email test` **5 files, 25/25 passed**, exit 0;
  `pnpm run typecheck` exit 0; `pnpm run lint` exit 0; `pnpm run format:check` exit 0;
  `pnpm install --frozen-lockfile` exit 0. Full sweep `pnpm --recursive --if-present run test`:
  **all 8 projects green, 189 tests across 46 files** (config 12, ui 27, observability 14, storage
  21, db 24, email 25, app-template 27, cli 39).
  - **`packages/email typecheck: Done` now appears in the project list (8 of 9 projects).** Before
    the manifest existed the same exit 0 checked nothing. That distinction is what makes this run
    evidence.
  - Rule scan clean, orchestrator-run: no `export *`, no barrel, no `any`, no bare-role filenames
    beyond the sanctioned `index.ts`, and **40 exports across 16 implementation files with 40 doc
    comments** — full coverage.
  - Implementor judgement calls accepted: `redactEmailSecrets` scrubs the configured password and API
    key out of **third-party** error text before it is quoted into a failure detail, because the
    contract's rule is absolute but the words come from a library — no gate forces this, since the
    sentinel sweep only proves the values the package itself controls are clean; the subject is
    re-parsed even when the caller supplied a branded one, so a hand-cast value cannot carry a CR
    into the SMTP headers; `buildEmailSubject` is not called at all when `subject` is supplied;
    `renderFailureDetail` never echoes a rejected subject, so a control-character subject cannot
    inject a newline into the message it produced; and generic template copy contains **no digits**,
    because a render gate asserts `15` is absent when `expiryMinutes` is omitted — an invisible
    constraint on future copy edits, recorded here so it is not tripped over.
  - `tsconfig.json` follows `ui` rather than `storage` (`module: preserve`, `moduleResolution:
bundler`, `jsx: react-jsx`, DOM lib), because this package has `.tsx` and React types.

- **ORCHESTRATOR-CAUSED REGRESSION, found and fixed in the same session: adding Mailpit to the repo
  compose broke three `cli` gates, and it would have broken CI.** `cli` went 39/39 → 36/39 with
  `Bind for :::1025 failed: port is already allocated`. The generated compose publishes `1025:1025`
  and `8025:8025`; the repo's new Mailpit now holds them. **CI would have hit this too**, because
  `ci.yml` starts Mailpit and then runs the recursive sweep that includes those gates.
  - **The irony is recorded in `cli`'s own gate file:** `run-hearthkit-cli-dev-infra.test.ts:82` says
    those gates use `mailpit` rather than `postgres` precisely **because** its ports were free.
  - **It surfaced only because the orchestrator ran the full workspace sweep.**
    `pnpm --filter @hearthkit/email test` was green throughout and said nothing about it. This is the
    same class of gap that failed PR #10, in the opposite direction: that time compose had a service
    CI lacked, this time compose has a service that collides with another package's gates.
    **Generalised rule: after touching `docker-compose.yml`, run the recursive sweep, never just the
    package in flight.**
  - Fixed by extending the established precedent rather than inventing one:
    `remapGeneratedMailpitHostPorts` is now a sibling of `remapGeneratedMinioHostPorts`, moving only
    the **published** host ports onto ports from `reserveFreeHostPort`, leaving `mailpit:1025` inside
    the compose network untouched. Moving the repo compose to nonstandard ports was **considered and
    rejected**: 1025/8025 are what every developer, the generated project and the `email` gates
    expect, and the MinIO precedent already settled that the repo compose keeps the standard ports
    while the `cli` gates yield.

- **A LATENT DEFECT IN THE EXISTING MINIO GUARD, shipped in PR #11 and described in this very file as
  the reason the remap is trustworthy. The claim was false for a whole class of inputs.**
  `docs/STATUS.md` said `remapGeneratedMinioHostPorts` "throws a named error if the generated file
  ever stops publishing `9000:9000`, so the remap cannot silently no-op and test nothing." It used
  `String.includes`, and **`'19000:9000'.includes('9000:9000')` is `true`** — so a generated file
  publishing a different host port passed the guard and the replace silently produced the nonsense
  `154321:9000`. Verified by the orchestrator directly:

  | input        | old substring guard          | new anchored guard |
  | ------------ | ---------------------------- | ------------------ |
  | `9000:9000`  | passes                       | passes             |
  | `19000:9000` | **passes**, rewrites to junk | **throws**         |
  | `9000:90001` | **passes**                   | **throws**         |

  Both guards now match with digit lookarounds, `/(?<!\d)9000:9000(?!\d)/`, with the counterexample
  named in a comment so nobody simplifies it back. The gate-writer fixed the MinIO one unprompted
  while adding the Mailpit sibling, which was right — leaving a known silent-corruption path in the
  guard would have been worse than the collision that exposed it.

- **`email` gates APPROVED 2026-08-30 at 25 gates, orchestrator-verified failing 25/25 from the
  committed files.** The 25th was commissioned after the contract correction: the existing gates all
  used single-parameter URLs, so the multi-parameter case — the only one `auth` actually depends on —
  was untested. It asserts both directions against a 90-character two-parameter URL, deliberately
  longer than the plain-text renderer's 80-column wrap width: the text part carries it verbatim and
  contains no `&amp;`, the HTML part does **not** contain it verbatim, does contain
  `href="<escaped>"` and at least two occurrences of the escaped form, and does **not** contain
  `encodeURIComponent(url)`. The elegant one is the last assertion — undoing the escaping restores
  the caller's URL byte-for-byte, which rules out any transformation escaping alone would not produce.
  - **The gate-writer proved it satisfiable AND load-bearing with three mutation states**, which is
    beyond what was asked: a correct stub passes; a tracking wrapper on both button and text fails on
    the text assertion; and — the one that matters — **a tracking wrapper on the button only, with the
    text part left byte-perfect, still fails**, on the `href="<escaped>"` assertion. That third state
    is exactly what a positive-only gate would have waved through.
  - A three-parameter case was measured (107 characters, identical behaviour) and deliberately not
    added, since it would restate the same fact at the cost of another gate.
  - The gate-writer also corrected a stale comment in the single-parameter gate that still carried the
    pre-correction claim that `auth` reads the URL from the HTML part — the exact sentence a future
    reader would have inherited. No assertion changed.

- **`email` gates written 2026-08-30 and ORCHESTRATOR-VERIFIED FAILING: 5 files, 24/24 gates failed,
  every one with a "not implemented yet" diagnostic, no collection error and no syntax error.** Run
  against a harness built by copying the committed gate files, fixtures, contract and
  `vitest.config.ts` into the scratchpad with `node_modules` symlinked to `packages/storage`, because
  `pnpm --filter @hearthkit/email test` still prints `No projects matched the filters` and exits 0.
  - **The clean run alone proves almost nothing, and this is the part worth keeping.** All 24 fail
    because `@hearthkit/email` cannot be resolved at all, which would happen whether the gates were
    good or garbage. The control that matters: with a resolvable stub `index.ts` exporting one
    unrelated value **plus** a manifest carrying the correct `./email-contract` subpath, the failures
    change to `gate expected @hearthkit/email to export resolveEmailTransportConfig, …` — so the
    gates genuinely exercise the contract and the silent-`undefined` guard fires. **23 failed, 1
    passed** under that stub; the passing one is the bare-node subpath gate, which is correct
    behaviour because the control handed it exactly the manifest it tests. The gate-writer's own
    control was stricter (stub only, no manifest) and reported 24/24, so the two numbers reconcile.
  - **Import discipline audited by the orchestrator, not taken on trust.** The only route into the
    package is a single dynamic `import('@hearthkit/email')` in `test-fixtures/hearthkit-email-entry.ts`.
    Every other specifier across all 12 gate and fixture files is `vitest`, a fixture, the contract,
    a `node:` builtin, `zod`, or `@hearthkit/config`. No internal implementation module.
  - **There are NO MOCKS anywhere — `vi.mock`, `vi.fn`, `vi.spyOn` all return zero hits.** Plan
    section 4.6 explicitly permits a mocked Resend HTTP layer "since it cannot run offline"; that
    exemption went **unused**, because `EMAIL_RESEND_BASE_URL` points the real SDK at an in-process
    `node:http` server. The one sanctioned mock in the whole phase was not needed.
  - 24 gates over 5 files, ~2060 lines including fixtures. In line with the repo (observability 14,
    storage 21, db 24, cli 25). `vitest.config.ts` sets `fileParallelism: false` because Mailpit is
    one shared server and its Chaos triggers are **global process state** — one file switching
    recipient rejection to 100% would fail every other file's send.
  - Gate-writer judgement calls accepted: dead ports reserved-then-closed rather than hardcoded
    (better than storage's fixed 59998); gate tokens letters-only, because a hex token can contain
    `15` and the render gate asserts `15` is absent when `expiryMinutes` is omitted — a real
    flakiness source it hit, not a hypothetical; `transportMessageId` asserted to _contain_ Mailpit's
    `MessageID` rather than equal it, since nodemailer's value carries angle brackets; and the
    `user-agent` assertion pinned to `resend-node` without the version, proving the SDK made the call
    without pinning a patch release.

- **`email` contract correction round 2 on 2026-08-30, documentation only — `email-contract.ts` was
  not touched, so no verified gate work was invalidated. The gate-writer found four contract gaps by
  building against it, and the first was a defect that would have broken the NEXT package in the
  phase.** `pnpm run format:check` exit 0 afterwards, orchestrator-run.
  - **THE CONTRACT PROMISED THE ACTION URL APPEARS VERBATIM IN `htmlBody`. IT DOES NOT.** Reproduced
    independently by the orchestrator against the pinned `react-email@6.9.3` +
    `@react-email/render@2.1.0`: React escapes `&` to `&amp;` in **both** the `href` attribute and
    the visible link text.

    | URL                                          | verbatim in `htmlBody` | verbatim in `textBody` |
    | -------------------------------------------- | ---------------------- | ---------------------- |
    | `…/sign-in?token=abc123`                     | yes, 3 occurrences     | yes                    |
    | `…/sign-in?token=abc123&callbackURL=%2Fdash` | **no, 0 occurrences**  | yes                    |
    | `…/sign-in?a=1&b=2&c=3`                      | **no, 0 occurrences**  | yes                    |

    This is correct HTML — `&amp;` is the proper encoding and a browser decodes it, so the link
    works. But **a single-parameter URL matches and a multi-parameter one does not**, which is
    exactly what makes it the sort of assumption that ships. The contract also said `auth`'s gate
    extracts the link from Mailpit, and **Better Auth magic-link callbacks routinely carry
    `?token=…&callbackURL=…`** — so plan 4.7's "request magic link, read it from Mailpit, complete
    sign in" would have failed on a naive HTML substring search. Fixed: `textBody` is now named the
    reliable extraction point, `htmlBody` is documented as HTML-escaped, and the `auth` bullet under
    "Out of scope" instructs `auth` to read the text part. **A gate pinning both directions has been
    commissioned**, because the existing gates deliberately used single-parameter URLs and therefore
    never exercised the case that matters.

  - **The secret rule forbade the contract's own output.** It said `SmtpPassword` and `ResendApiKey`
    "never appear in a returned value", but `EmailTransportConfig` — what `resolveEmailTransportConfig`
    returns — carries exactly those fields. Narrowed to failures, log lines and render/send results,
    with `EmailTransportConfig` named as the one legitimate carrier. Checked against the gates before
    ruling: `expectValueCarriesNoSecret` runs inside `expectEmailFailure` only, so they already
    matched the narrowed rule.
  - **`EPROTOCOL` keeps its catch-all mapping and the optimistic sentence went instead.** A listener
    that is not an SMTP server (someone pointing `EMAIL_SMTP_HOST`/`PORT` at a web server) yields
    `code: 'EPROTOCOL'`, `command: 'CONN'`, `Invalid greeting. response=HTTP/1.1 400 Bad Request`, so
    "the catch-all should stay empty in practice" was false. Reclassifying it to unreachable — for
    consistency with the `ETLS` ruling — was **considered and rejected**: it would leave
    `email-send-failed` with no producer and therefore no gate, and a gated catch-all is worth more
    than a tidier taxonomy.
  - Three clauses that no gate can cover are now recorded with their reasons rather than left to look
    covered: `implicitTlsSmtpPort` (deriving `secure` from port 465 needs a privileged port, so only
    the negative half is covered — **an implementation that never sets `secure: true` at all passes
    every gate**), `EAUTH` (not producible against unauthenticated Mailpit), and `smtpSocketTimeoutMs`
    (needs a server that greets then stalls after `DATA`, plus 20 s of runtime).

- **`email` contract APPROVED 2026-08-29 after one correction round. Both corrections were the
  orchestrator catching a subagent's reasoning that was wrong on the facts while its conclusion was
  right — and in both cases the true reason was stronger than the stated one.** Checks run by the
  orchestrator: `pnpm run format:check` exit 0 (after a Prettier pass on `CONTRACT.md` whose diff was
  **whitespace only** — one table column a single character too wide, no wording touched, confirmed by
  diffing with whitespace collapsed); `email-contract.ts` typechecked **in isolation**, `tsc --noEmit`
  with `strict` and `verbatimModuleSyntax`, zod 4.4.3 and `@types/react` 19.2.18 linked, **exit 0, no
  diagnostics**, re-run after the schema change.
  - **`pnpm run typecheck` exits 0 WITHOUT CHECKING THIS PACKAGE**, because `packages/email` has no
    manifest and is therefore not in the workspace project list. Third time this repo has hit that
    trap (`templates/app`, `storage`, now `email`). The isolated run above is the only real evidence.
  - **Correction A — the contract justified its central design decision on two claims about `config`,
    and both were false.** It said a cross-field refinement on the env fragment was rejected because
    `config` merges with `.extend` and guards with `instanceof z.ZodObject`. Verified: `config` does
    **not** use `.extend`, and a refined fragment **passes** `instanceof z.ZodObject` with `.shape`
    intact. The real reason, found by reading `packages/config/src/compose-env-schema-fragments.ts:18-31`,
    is worse and therefore decisive: `composeEnvSchemaFragments` iterates `Object.entries(fragment.shape)`
    and returns a **brand-new `z.object(composedShape)`**, so a refinement attached to a fragment is
    **silently discarded** — not rejected, not errored, simply never run. `EMAIL_TRANSPORT=resend`
    with no API key would sail through as if no rule had been written. A silent no-op is worse than a
    failure, which is what makes `resolveEmailTransportConfig` forced rather than merely preferable.
    Second independent reason, also verified: a refinement failure arrives as `{code:'custom',path:[]}`
    with an empty path, so it could not name the offending variable even if it did run.
  - **Correction B — the contract proposed shipping a TLS security rule with NO GATE, on a premise
    that was wrong.** It reasoned that gating `requireTLS` needed Mailpit to accept authentication. It
    needs the opposite: Mailpit not **offering** STARTTLS, which it already does not, since no cert is
    configured. Orchestrator-run against the repo's own Mailpit, **no compose change needed**:
    `requireTLS: true` plus credentials fails with `code: 'ETLS'`, `command: 'STARTTLS'`,
    `502 5.5.1 Command not implemented` — and the **negative control is the load-bearing half**: the
    identical send with `requireTLS` omitted **succeeds with `250` and the password crosses in clear**.
    So an implementation that drops the flag fails the gate.
  - **That correction exposed a real hole rather than just a wording problem:** `ETLS` appeared nowhere
    in the failure mapping, so a security-relevant failure was landing in the unnamed catch-all — which
    the contract's own Decision 7 argues against. Ruled: `ETLS` → `email-transport-unreachable` (no
    message was sent, the transport was unusable, the operator's fix is the same class as a down relay).
    The contract-author then found the mirror case unprompted and mapped `EAUTH` →
    `email-transport-rejected` (server reached, answered, refused the session), widening that variant's
    wording to "the session or the message". Both confirmed. The contract now carries a complete
    signal-to-failure mapping table, which is the right artefact — the hole was a missing mapping, not
    a missing sentence.
  - `transportErrorCode` became **required** on `email-transport-unreachable` (the only schema change
    this round). Accepted: the variant is recognised _by_ the code, so the code is always in hand, and
    without it the STARTTLS gate could only assert the outcome — an implementation that failed to
    connect for an unrelated reason would satisfy it by accident.
  - Seven of the contract-author's eight first-round questions confirmed as recommended: the extra
    resolver function and its failure mode; `email-transport-unreachable` plus the `email-send-failed`
    catch-all (same precedent as `storage-endpoint-unreachable` / `storage-request-failed`); no
    `EMAIL_SMTP_SECURE` with `secure` derived as `port === 465`; `EMAIL_SMTP_PORT` required with no
    default; no `re_` prefix pin on the Resend key; and no email-verification or org-invitation
    templates, to be revisited inside the `auth` loop.
  - **Every cross-package claim the contract made was checked rather than taken on trust, and all
    held:** `maximumPresignedUrlExpirySeconds` is 604800, matching the contract's 10080 minutes;
    `healthCheckNameSchema` in `observability` is byte-identical in shape to `emailTemplateNameSchema`;
    `config` does treat an empty string as unset; and all five version pins match
    `packages/storage/package.json` (`zod` 4.4.3, `vitest` 4.1.11, `typescript` 7.0.2,
    `@types/node` 24.13.3).
  - Contract shape: three public functions (`resolveEmailTransportConfig`,
    `renderTransactionalEmail`, `sendTransactionalEmail`), two shipped templates
    (`magic-link-sign-in`, `password-reset`), six failure variants where the plan names three, and a
    `./email-contract` subpath mirroring `@hearthkit/ui`'s, because the `.` entry transitively imports
    `.tsx` that bare Node refuses.
  - **Process note: the contract-author's first run died mid-response to an API error** (the machine
    slept). It had written nothing, so resuming it with its reading intact cost one message instead of
    a full restart. Worth remembering — check the filesystem before assuming a dead agent left a mess.

- **`email` loop opened 2026-08-29 on `pkg/email`. Mailpit is in the repo compose AND in `ci.yml` in
  the same breath, which is the rule the `storage` loop paid for.** Orchestrator-run, cold:
  `docker compose up -d --wait minio mailpit` — both **healthy in 6.4 s, exit 0** — and that is now
  literally the CI step, so the gap that failed PR #10 cannot repeat here. `pnpm format:check` exit 0.
  Mailpit needs no volume: it stores messages in a temp SQLite file (`/tmp/mailpit-*.db`) and its
  image already declares a `/mailpit readyz` healthcheck, overridden only to cut the 15 s interval
  and 10 s start period down to 2 s. Image `axllent/mailpit:v1.31` matches
  `localInfraServiceImageByName` in the `cli` contract, so repo compose and generated compose agree.

- **Mailpit Chaos is enabled on the repo's Mailpit (`MP_ENABLE_CHAOS: 'true'`), and it is what lets
  the "transport rejects" failure mode be gated against a REAL server instead of a fake.** Verified
  end to end: `GET /api/v1/chaos` → `200` with all three triggers at `Probability: 0`;
  `PUT {"Recipient":{"ErrorCode":451,"Probability":100}}` → 200; a send then fails with
  `responseCode=451`, `command='RCPT TO'`, `response='451 Chaos recipient error'`,
  `rejected=['c@d.test']`; reset to 0 and the next send returns `250 2.0.0 Ok: queued as …`.
  Inert at rest, survives a cold `compose up`. **Gates must reset all three triggers to
  `Probability: 0` afterwards**, and should leave `Authentication`'s default `ErrorCode` at 535 —
  the probe overwrote it to 451 by passing it explicitly, which is state left behind.

- **HAZARD for the contract: `EENVELOPE` cannot distinguish an invalid recipient from a transport
  rejection.** Both nodemailer failures carry `code: 'EENVELOPE'`. They differ only in
  `responseCode` — `451` with `command: 'RCPT TO'` for a server rejection, **`undefined` with no
  command** for a bad address. Worse, the bad-address case never reaches the server at all:
  `to: 'not-an-email'` is silently dropped by nodemailer's address parser and reported as
  `'No recipients defined'`, with Mailpit's message count still 0. That diagnostic points at the
  wrong thing, so **the package should validate recipients with Zod before calling nodemailer** and
  return its own named failure, rather than translating `EENVELOPE` after the fact.

- **nodemailer 9.0.6 against Mailpit, orchestrator-run.** Unauthenticated send on 1025 works
  (`secure: false`, no `auth`); `verify()` returns `true`. A success returns
  `250 2.0.0 Ok: queued as <ID>` where **that ID is byte-identical to the Mailpit message `ID`** in
  `GET /api/v1/messages`, so a gate can correlate directly instead of searching by subject — though
  that is Mailpit-specific and must not leak into the contract's promises. An unreachable transport
  throws `ESOCKET` / `errno -61` / `command 'CONN'` / `connect ECONNREFUSED 127.0.0.1:1099` — well
  named, unlike the empty `AggregateError` the storage loop had to wrap.

- **Resend CAN be gated offline against a real in-process HTTP server, so plan section 4.6's "mocked
  HTTP layer only, since it cannot run offline" is wrong in a useful direction.** `ResendOptions`
  publicly types `baseUrl?: string` (`index.d.mts:2691`, `constructor(key?, options?: ResendOptions)`),
  and `RESEND_BASE_URL` works too — **no `any` cast needed**, so CLAUDE.md's no-`any` rule holds.
  Verified against a `node:http` server: happy path POSTs `/emails` with `Authorization: Bearer <key>`,
  `User-Agent: resend-node:6.25.0`, body keys `from,html,subject,text,to`, returning
  `{data:{id}, error:null}`.
  - **The SDK returns errors, it does not throw them.** A 422 gives
    `{data:null, error:{statusCode:422, name:'validation_error', message:…}}`, and an unreachable
    base URL gives `{data:null, error:{name:'application_error', statusCode:null, message:'Unable to
fetch data. The request could not be resolved.'}}`. So unreachable and rejected are told apart by
    `name`/`statusCode`, not by catching. The **constructor throws synchronously** on a missing key.
  - Nuisance for gate output: `logError` writes to `console.error` whenever `NODE_ENV !== 'production'`.

- **React Email dependency settled by USER DECISION 2026-08-29: unified `react-email@6.9.3` plus
  `@react-email/render@2.1.0`.** `@react-email/components` and all 20 individual component packages
  are deprecated (npm's generic message, every version, last publish 2026-04-09); `react-email` 6.9.3
  (published 2026-08-25) is the maintainers' replacement and exports the components — 67 exports
  including `Html`, `Body`, `Button`, `Heading`, `Text`, `Container`, `Preview`. `@react-email/render`
  is **not** deprecated and is the part that actually renders.
  - **The bundle-size objection was measured and is not real.** Issue resend/react-email#3556 closed
    2026-07-10. esbuild bundle: **603136 bytes unified vs 601580 bytes components — 1.5 KB apart**.
    `@vercel/nft`, the tracer Next standalone itself uses: **21 files / 2.0 MB either way**. The cost
    is install weight only — 75M/101 packages vs 30M/22 — which lands in the Docker build stage.
    Recorded because "the unified package adds ~80 MB per function" is widely repeated and is false
    for a bundled app.
  - `render(el)` → `Promise<string>`, a full XHTML-doctype document. `render(el, {plainText: true})`
    → readable text with link URLs inlined (`"SIGN IN\n\nClick below.\n\nSign in https://…"`), so one
    template yields both parts of a multipart message. Verified against the unified import, not just
    the deprecated one.
  - A throwing template throws a plain `Error` carrying the original message, at both element
    construction and render time — **no distinctive shape**, so the render failure mode must be
    produced by wrapping, not by matching an error type.
  - Templates are `.tsx`, so bare Node cannot import them (it does not strip JSX). Vitest and Next
    both transform, so gates and consumers are fine — but this is the same publish-time-build
    constraint already recorded for `ui`, and it applies to `email` in Phase 6.

- **BOTH PHASE 5 BRANCHES MERGED 2026-08-29.** `f387155` (PR #10, `@hearthkit/storage`) then
  `96b5271` (PR #11, `cli` local storage bucket), both squash-merged, both branches deleted, working
  tree clean on `main`, no open PRs.
  - **The combined state was verified before #11 was merged, not after.** #11's earlier green run was
    against a branch that did not contain `storage`, so `main` was merged into it first and CI re-run:
    `packages/storage test: 8 files, 21/21` and `packages/cli test: 7 files, 39/39` in the **same**
    run, plus a local sweep of all seven projects, `pnpm install --frozen-lockfile` exit 0 (the two
    branches' lockfile edits reconcile), typecheck, lint and format:check all exit 0.
  - The `docs/STATUS.md` conflict predicted at the start of the `cli` loop happened exactly as
    written and was resolved as a **union**: both loops' verified facts kept, since discarding either
    side would have thrown away findings that cost real time. The Position, checklist and loop-state
    rows were rewritten rather than merged, because those describe a single current state.
  - **`hearthkit dev infra up` now closes the loop end to end:** a project depending on
    `@hearthkit/storage` gets MinIO, a healthcheck, and a bucket named `<project>-uploads`, and
    `@hearthkit/storage` can presign an upload into it. The 404-on-first-upload gap that opened this
    phase is gone.

- **CI GREEN on PR #11 (run 33274160723, 2m34s), and the new Docker gates really ran on the runner:
  `packages/cli test: Test Files 7 passed (7), Tests 39 passed (39)`.** Notable because this branch is
  cut from `main` and therefore does **not** carry PR #10's MinIO step in `ci.yml` — it does not need
  it. The bucket gates start their own compose stack on reserved ports rather than borrowing the
  repo's MinIO, so they are self-sufficient on a runner that only has Docker.

- **`cli` local-storage-bucket amendment COMPLETE 2026-08-29. PR #11, commit `8b402c9`. Not merged.**
  Two implementor rounds, the second a comment-wording fix only. Orchestrator-run:
  `pnpm --filter @hearthkit/cli test` **7 files, 39/39 passed** (25 pre-existing plus 14 new),
  `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` all exit 0, and
  `pnpm --recursive --if-present run test` gives **143/143 across six projects**.
  - **The gate-writer proved a text-only gate would NOT have caught the `--wait` defect**, by running
    the Docker gates against an implementation with and without the `tail`. Without it:
    `exitCode=1 kind=infra-compose-failed` **while the signed S3 PUT still returned 200**. So the
    load-bearing assertion is the exit code, not the upload — an S3-only gate would have passed a
    broken implementation. Worth remembering for `email`: proving the service works is not the same
    as proving the command that starts it succeeded.
  - The Docker gates remap only the _published_ host ports, because the repo's own `hearthkit-minio`
    holds 9000/9001, and `remapGeneratedMinioHostPorts` throws a named error if the generated file
    ever stops publishing `9000:9000` — so the remap cannot silently no-op and test nothing.
    **CORRECTED 2026-08-30 during the `email` loop: that last clause was FALSE as written.** The
    guard used `String.includes`, which also matches inside `19000:9000`, so a generated file
    publishing a different host port passed it and was silently rewritten into a nonsense port. Now
    anchored with digit lookarounds. See the latent-defect entry near the top of this section.
  - Round 2 existed because the comment emitted into **every generated project's** compose file did
    not parse ("calls a service that has exited a failed startup"). That comment is the only thing
    standing between a future reader and deleting the `tail`, so garbled text there is a real defect,
    not a typo. Rewritten and re-verified against real generated output for both properties that
    matter: 2-space indent so it lands in neither service block, and no `restart:`/`ports:`/
    `volumes:`/`environment:` that would trip the gates' absent-key regexes.
  - Implementor judgement calls accepted: `LocalStorageBucketName` and `DeriveLocalStorageBucketName`
    re-exported as types (without the first, Phase 6 can only write
    `ReturnType<typeof deriveLocalStorageBucketName>`); `localStorageServiceEndpoint` as a named
    constant rather than built from the published port, since the gate remaps the published port and
    the in-network address must never be remapped; `buildBucketInitBlock` kept private beside the
    existing private helpers.
  - **Orchestrator false alarm worth recording.** A `pnpm lint` run appeared to fail with
    `Unable to locate a Java Runtime` — an earlier `cd packages/cli/src` had persisted in the shell,
    and from there `pnpm lint` resolved to Homebrew's `/opt/homebrew/bin/lint` (Android
    command-line tools) instead of the package script. Re-run from the repo root, everything is
    green. **Use `pnpm run <script>` rather than `pnpm <script>`, and do not trust a shell cwd across
    calls.** The implementor's green report was correct and the doubt was mine.

- **`cli` contract amendment APPROVED 2026-08-29 after one correction round, and the correction was
  a real defect that would have shipped a permanently-failing command.** `pnpm format:check` exit 0.
  - **`docker compose up -d --wait` returns exit 1 when any service it started has EXITED, whatever
    its exit code.** The first draft specified `minio-init` as a one-shot container that exits 0.
    The emitted YAML was correct by inspection; `dev infra up` would still have reported
    `infra-compose-failed` on **every** run, fresh or repeat, with the bucket created perfectly.
    `composeUpArguments` in `src/docker-compose-commands.ts` passes `--wait` unconditionally.
    Compose issue 10596 is open on this; the flag's own reference documents no exception.
  - **Fix: the entrypoint ends `&& tail -f /dev/null`, so the container stays alive by design.**
    Verified under every invocation: fresh `up -d --wait` exit 0, repeat `up -d --wait` exit 0,
    plain `up -d` exit 0, presigned PUT into the created bucket **200**, `down -v` exit 0 with every
    container removed. The `&&` chain still fails loudly the right way — a failed `mc mb`
    short-circuits before `tail`, the container exits nonzero, and the existing
    `infra-compose-failed` reports it. Staying alive is the success path only.
  - **Three alternatives run and rejected, recorded so nobody re-derives them:** stating
    `restart: 'no'` explicitly changes nothing (compose objects to the exit, not the missing key);
    `profiles: ['init']` plus `docker compose run --rm` works for the CLI but leaves a plain
    `docker compose up` with no bucket; and MinIO's own healthcheck cannot run `mc mb` because the
    server image's built-in `local` alias is unauthenticated and returns `Access Denied`.
  - **Why the idle container won over the profile variant**, which is the part worth remembering:
    `resolveLocalInfraComposeFile` never overwrites an existing compose file, so users own and run
    these files by hand from then on. A file that works under `docker compose up` but fails under
    `docker compose up --wait` is a landmine in something the CLI hands over and never touches
    again. One idle container is a visible, explainable cost; a sharp edge on a common flag is not.
  - **Orchestrator process note, twice bitten this session:** the first probe's "idempotent, exits 0"
    claim was WRONG — `docker compose up` was piped through `tail`, so `$?` captured tail's status,
    not compose's, and `docker inspect` was reporting the _init container's_ exit code rather than
    compose's. The pattern was fine; the verification of it missed the thing that mattered.
    **Capture exit codes directly, never through a pipeline**, or use `${pipestatus[1]}` in zsh.
  - Contract-author's two open questions ruled on: `deriveHearthkitProjectName` promoted to public
    (without it `create` re-implements the sanitiser and drifts, the exact failure this amendment
    prevents), and `-uploads` with no S3 reserved-prefix screening (screening would trade a total
    function for a rule R2 does not impose).

- **The `mc` init-container pattern is verified working against our exact pinned images, before any
  contract was commissioned.** `minio/mc:RELEASE.2025-08-13T08-35-41Z` (frozen alongside the server
  image; last Docker Hub push 2025-09-07) as a sidecar with
  `depends_on: {minio: {condition: service_healthy}}`, running
  `mc alias set` then `mc mb --ignore-existing`. Probe on shifted ports 9100/9101 so it could not
  collide with the repo's MinIO:
  - Created the bucket and exited **0**, having waited for the healthcheck rather than racing it.
  - ~~**Idempotent** — a second `docker compose up -d --wait` exited 0 again.~~ **CORRECTED: this
    claim was wrong.** `docker compose up` was piped through `tail`, so the captured status was
    tail's, and the exit code checked with `docker inspect` was the init container's, not compose's.
    Compose actually returns **1** whenever a service it started has exited. See the `--wait` entry
    above; `mc mb --ignore-existing` is genuinely idempotent, but that was never the failing part.
  - **The bucket is genuinely usable over the S3 API**, which is the point: a presigned PUT that
    returns **404 today** returned **200** into the init-created bucket, and the object was then
    listed. Probe torn down; the repo's own MinIO was never touched.
- **`MINIO_DEFAULT_BUCKETS` is a Bitnami-image feature and does nothing on the official
  `minio/minio` image this repo pins.** Recorded so nobody reaches for it as the "simpler" option.
- **The design constraint that decides this contract, found by reading the call site rather than
  assuming:** `resolveLocalInfraComposeFile` builds compose from the project's `package.json`
  manifest — it has `hearthkitProjectName` and `infraServices` and **no bucket name**, and reads no
  `.env`. So an explicit `storageBucketName` input cannot be satisfied by the `dev infra up` path
  without adding `.env` I/O to a function the contract calls pure and deterministic. Deriving the
  name from the project name through one exported function, which `create` later uses for the value
  it writes to `STORAGE_BUCKET`, keeps a single source of truth with no new I/O.
  Escape hatch already exists and needs no new code: `resolveLocalInfraComposeFile` never overwrites
  an existing compose file, so anyone with a custom `STORAGE_BUCKET` owns their compose file.

- **`mc` IS bundled in the pinned MinIO server image, so the generated `minio` healthcheck is sound.**
  This was the one fact contract-author flagged that it could not verify and correctly refused to
  assert. Settled directly: `docker exec hearthkit-minio mc ready local` prints
  `The cluster 'local' is ready` and exits **0**. Worth keeping: the server image bundles
  `mc version RELEASE.2025-08-13T08-35-41Z` — byte-identical to the standalone `minio/mc` release the
  contract pins for the init container, so the two pins are consistent rather than coincidentally
  close. (The image has no `which`, so probe with the binary itself.)

- **The bucket-name derivation is total, checked against the worst inputs rather than assumed.**
  `hearthkitProjectNameSchema` is `/^[a-z][a-z0-9-]*$/` with `max(63)`, so a project name can be one
  character, can end in a hyphen, and can be 63 characters. Truncate-to-55 → strip trailing hyphens →
  append `-uploads` was run over all of those: output stays **9 to 63 characters** and satisfies
  `localStorageBucketNameSchema` every time. The two that could have broken it both hold —
  `a` + 62 hyphens collapses to `a-uploads` rather than a trailing-hyphen name, and `my-app-` yields
  `my-app-uploads` rather than `my-app--uploads`. This is what justifies the function having no
  failure mode.

- **CI GREEN on PR #10 after the MinIO fix (run 33269760070, 2m15s).** The proof that matters is that
  the storage gates **ran** on the runner rather than being skipped: `packages/storage test: Test
Files 8 passed (8), Tests 21 passed (21)`, against a real MinIO started from the repo's compose
  file. All seven projects green (config 2, ui 5, observability 4, db 6, storage 8, app-template 9,
  cli 5). `docker compose up -d --wait minio` verified locally first: healthy in 6.1 s, exit 0.

- **CI FAILED ON PR #10 WHILE EVERY LOCAL COMMAND WAS GREEN, and the cause is a gap in the loop
  itself rather than in the package.** The repo-root `docker-compose.yml` gained a `minio` service so
  local gates could run, but `.github/workflows/ci.yml` was never taught about it, so CI ran the
  storage gates against nothing: 6 files failed, 5 tests passed, 16 skipped. Orchestrator's omission,
  fixed in this PR.
  - **The general rule, which every remaining Phase 5 package will hit:** adding a service to
    `docker-compose.yml` is only half the job. `email` needs Mailpit and will fail exactly the same
    way. **Local gates passing is not evidence CI will pass when a package introduces a new service.**
    The loop's step 4 has the orchestrator re-run gates locally, which cannot catch this by
    construction — the check that matters is whether CI can reach the same services.
  - **MinIO cannot be a GitHub Actions service container, unlike Postgres.** The image needs
    `server /data` arguments to start at all, and a service container has no field for a command —
    `options` maps to `docker create` flags, which cannot supply arguments either. So it starts from
    the repo's own compose file with `docker compose up -d --wait minio`, which is the better shape
    regardless: image tag, credentials, ports and healthcheck then have exactly one definition shared
    by CI and local gates, instead of a bespoke `docker run` line drifting from compose. `--wait`
    blocks on the compose healthcheck, so the gates cannot race the service. Teardown is
    `docker compose down -v` guarded with `if: always()`. Postgres stays a service container; it works
    and mixing the two mechanisms is not worth churning a green setup over.
  - **The failure output was actively misleading, which is its own defect.** With MinIO absent,
    `beforeAll` could not create a bucket, the module-level `gateBucket` stayed `undefined`, and
    `afterAll` then dereferenced it and threw `TypeError: Cannot read properties of undefined
(reading 'storageConnection')` — burying the real cause and pointing at a teardown helper. Nothing
    in the output said "MinIO is not running". Same family as the standing silent-`undefined` hazard:
    a fixture reporting a symptom far from the cause. Sent to gate-writer to fix the diagnostic; no
    assertion changes.

- **`storage` implemented and VERIFIED GREEN IN ONE IMPLEMENTOR ROUND, 2026-08-29. PR #10, commit
  `ec228f1`. Not yet merged.** Orchestrator-run, not taken from the subagent's summary:
  `pnpm --filter @hearthkit/storage test` **8 files, 21/21 passed**, exit 0; `pnpm typecheck` exit 0
  (7 projects); `pnpm lint` exit 0; `pnpm format:check` exit 0. Gate-runner independently confirmed
  the same and added the workspace sweep — `pnpm --recursive --if-present run test` gives **39 files,
  150/150 passed**, so `storage` regressed nothing. Reports in `.reports/storage-*.txt`. MinIO left
  with zero buckets, checked at three points.
  - **The gate-writer's satisfiability claim held.** It was the one thing the orchestrator could not
    verify without doing the implementor's job, and round 1 passing confirms the gates were
    satisfiable as written.
  - **The implementor ran the right negative control rather than trusting the recorded spike:**
    deleting `signableHeaders` from its own upload presign flipped the smuggled-`text/html` PUT from
    403 back to **200**, failing the gate at `create-presigned-upload-url.test.ts:56`. Restored. The
    pin is real in the shipped code, and the gate is load-bearing rather than decorative.
  - Rule scan clean, orchestrator-run: no `export *`, no barrel, no `any`, no bare-role filenames
    (only `index.ts`, a thin named re-export), and **22 exports across 11 implementation files with
    22 doc comments** — full coverage. Implementation is ~640 lines excluding the contract and entry.
  - Load-bearing details confirmed present in the shipped source rather than merely claimed:
    `signableHeaders` in the upload presign, `forcePathStyle: true` with a per-call `destroy()`, and
    `safeParse` for both range checks so they run before any client is built.
  - **`packages/storage/tsconfig.json` sets `noEmit: true` and no `rootDir`, byte-identical to
    `db`'s.** This does not contradict the standing TS 7 note that emit needs an explicit `rootDir`:
    these packages do not emit. Verified by comparison rather than argument.
  - Two SDK error-shape facts the implementor established that go beyond the earlier spikes: the
    `AggregateError` from a dead port carries `code: 'ECONNREFUSED'` **on the aggregate itself**, not
    only on its `errors` entries; and a bodyless response yields `name: 'Unknown'` with `Code`
    undefined, so `HeadObject` against a 500 gives `storageErrorCode: 'Unknown'` while
    `DeleteObject`/`ListObjectsV2` against the same server give `'InternalError'` from the XML body.
    A future gate pinning a specific code on the download path would be pinning `'Unknown'`.
  - **Implementor judgement calls the contract did not settle, all accepted:**
    1. **Listed keys are branded WITHOUT re-validating the strict key pattern**, using a lax
       `z.string().brand<'StorageObjectKey'>()` that produces the identical type. `StorageObjectKey`
       is deliberately stricter than S3, and a bucket can hold keys written by other tools, so strict
       parsing a listing would either drop those keys silently or fail the whole page. Both are worse
       than reporting what is there. Self-consistent: the strict schema still guards every key this
       package _writes_, while a key it merely _reports_ stays actionable — you can delete a file you
       can see. Reason stated in-file.
    2. Missing metadata falls back (`?? new Date(0)`, `?? 0`) rather than failing, keeping the result
       total. A successful HEAD always carries `Last-Modified`, so the fallback is unreachable in
       practice.
    3. `IsTruncated` true with no token is reported as page-complete: the token decides, because a
       truncated page a caller cannot continue is useless.
    4. `expiresAt` is computed just before signing, so it is at most milliseconds early and never
       late — the safe direction for a caller deciding whether a URL is still good.

- **`storage` contract correction round 2026-08-29, documentation only — `storage-contract.ts` was
  not touched, so no verified gate work was invalidated.** Two inaccuracies the gate-writer found
  while building against the contract, both confirmed by the orchestrator before being sent back.
  1. **A wrong status code, and it corrects the orchestrator's own earlier spike reading.**
     `CONTRACT.md` claimed a `PUT` that "omits it or sends a different value" is rejected with 403.
     Sending a different value is 403; **omitting the header entirely is 400**. The orchestrator's
     original spike recorded 403 for the omitted case because it used a _string_ body, and `fetch`
     silently adds `content-type: text/plain;charset=UTF-8` — so that check was measuring the
     wrong-value case a second time. Only a **binary** body tests true omission, which is what the
     gate does. The gate asserts `[400, 403]` and never encoded the error.
  2. **An ambiguity that would have let the entry point drift.** "each function's options and result
     schemas" did not say whether the four success-only schemas must be re-exported. Resolved as
     **required**, with a mechanical rule: every value `storage-contract.ts` exports is re-exported
     from `src/index.ts`, no exceptions. That created a contract requirement no gate enforced, so the
     entry-point gate is being widened in the same breath — additive only, and it cannot make a
     failing empty implementation pass.
  - `pnpm format:check` exit 0 after both edits, orchestrator-run. The contract-author had no shell
    tool in either of its sessions and correctly declined to claim the check passed.

- **Entry-point gate widened 2026-08-29 to enforce the contract's new mechanical rule, and it is now
  derived rather than hand-maintained.** `contractValuesTheEntryMustReExport`, 36 hand-typed string
  literals, is replaced by `Object.keys(contractModule).toSorted()` — 40 names, the delta being
  exactly the four success-only schemas, measured with a throwaway probe rather than reasoned about.
  The gate asserts three whole-array comparisons so a failure names every wrong export at once:
  missing from the entry point, rebuilt instead of re-exported (identity, not just presence), and a
  four-name literal anchor asserting those names still exist on the contract.
  - **The anchor is the part worth keeping.** A purely derived list can silently shrink: delete a
    contract export and the gate happily requires one fewer name. The anchor stops that for the four
    names the contract calls out by name.
  - **Honest tradeoff the gate-writer named rather than hid:** the old list failed loudly if any of
    the other 36 contract names was renamed; the derived list simply tracks the rename. That is
    arguably correct — the contract is the source of truth and the entry must follow it — but the
    residual risk is an accidental _deletion_ of one of those 36 going unnoticed by this gate. The
    other gates that import the deleted name would catch it, subject to the standing
    silent-`undefined` hazard.
  - Proven to bite before being accepted: three fake entry points in the harness only — old 36 only
    (failed, naming exactly the four missing), all 40 (passed), 39 plus a rebuilt copy of
    `storedObjectSummarySchema` (failed, naming exactly that one). Fakes deleted, 21/21 failing again.

- **`storage` gates APPROVED 2026-08-29 after one round. 21 gates across 8 files (~1525 lines with
  fixtures), orchestrator-verified failing: 8 files failed, 21/21 gates failed, and every one of the
  21 failed with the SAME diagnostic** — `gate could not load the public entry point of
@hearthkit/storage (not implemented yet?)`. No collection error, no fixture error, no syntax error.
  The `beforeAll` hooks reached MinIO and created and destroyed their buckets on every run, and
  `ListBuckets` returned `[]` afterwards, so the suite leaves no state behind.
  - **The prescribed loop command still does not work for a package with no manifest.**
    `pnpm --filter @hearthkit/storage test` prints `No projects matched the filters` and exits **0**,
    orchestrator-confirmed, because `packages/storage/package.json` is implementor-owned and does not
    exist yet. Identical to the `templates/app` situation. Real evidence came from running Vitest
    directly against a scratch harness (workspace root with `@hearthkit/config` symlinked, no
    manifest and no `index.ts` for storage, gate files re-copied from the repo immediately before the
    run so the run tested exactly what is committed). **Do not read that exit 0 as a pass.**
  - Import discipline audited by the orchestrator rather than taken on trust: every runtime call to
    the package goes through a single dynamic `import('@hearthkit/storage')` inside
    `test-fixtures/hearthkit-storage-entry.ts`. Gate files import only `./storage-contract.ts`, the
    fixtures, `vitest`, and — in the env-fragment gate alone — `@hearthkit/config`. No gate reaches
    into an internal implementation module.
  - Services are real: MinIO from compose for everything except two variants that cannot use it —
    `storage-request-failed` (in-process `node:http` server answering 500, the technique the
    observability gates established and the contract sanctions) and `storage-endpoint-unreachable`
    (a dead local port). The S3 SDK itself is never mocked.
  - **The gate-writer built a throwaway reference implementation to prove the gates are satisfiable,
    which is beyond what it was asked for and caught two defects that would otherwise have shipped:**
    the never-throws gate passed against a stub that resolved with `{kind:'stub'}` (it now also
    asserts each settled value is the correct contract failure, so a stub cannot pass it), and the
    secret-leak sweep produced a false positive on every failure because MinIO's secret is the word
    `hearthkit`, which is also the first word of every contract message prefix (it now forbids only a
    distinctive sentinel secret). **This is the one claim the orchestrator did NOT independently
    verify** — confirming it would mean writing the implementation, which is the implementor's job.
    The implementor's first round will confirm or refute it.
  - Gate count is in line with the rest of the repo (observability 14, `storage` 21, `db` 24, `cli`
    25, `ui` and `templates/app` 27), and each gate is a multi-step integration scenario rather than
    a per-schema unit test.

- **`storage` contract APPROVED 2026-08-29, no revision round** (one small correction round for
  documented facts followed, see below). Both files read by the orchestrator;
  `pnpm format:check` exit 0 across the repo, which answers the contract-author's question 5 (it had
  no shell tool and asked for the check to be run at review time). All four plan-mandated functions
  present with the exact plan names, all three plan failure modes present, nothing invented without a
  justification. The four open questions resolved as follows.
  1. **`STORAGE_REGION` confirmed** as a fifth optional env var defaulting to `auto`, beyond plan
     section 4.5's four. The SDK requires a region, R2 documents `auto`, and a defaulted variable
     leaves an escape hatch for a MinIO site region while keeping the plan's four working unchanged.
  2. **The `HEAD` in `createPresignedDownloadUrl` confirmed**, round trip and all. Without it
     `storage-object-not-found` has no producer anywhere in the package, and the plan names it as a
     failure mode; it also supplies the returned metadata and makes the plan's "delete it, confirm it
     is gone" gate direct. The time-of-check race is real, stated in the contract, and accepted.
  3. Local bucket ownership → moved to Open issues, not fixed here.
  4. **Widened failure union confirmed** — `storage-endpoint-unreachable` (forced by the empty
     `AggregateError`), `storage-parameter-out-of-range` (without it a bad expiry throws, breaking
     the never-throws promise) and the `storage-request-failed` catch-all that keeps that promise
     honest.

- **Two load-bearing contract claims verified by orchestrator spike before approval, 7/7 — the
  contract-author cited SDK source but could not execute anything, and both claims drive
  implementation requirements and gates.**
  - **The content-type pin is genuinely decorative without `signableHeaders`, and this is a real
    security finding rather than a theoretical one.** Presigning a `PUT` with `ContentType:
'text/plain'` and no `signableHeaders`, then uploading with `content-type: text/html`, returned
    **200 and stored the object as `text/html`** — the client's choice silently won. Adding
    `signableHeaders: new Set(['content-type'])` to `getSignedUrl` flipped the same mismatch to
    **403**, while the matching type still returned 200. That is the stored-XSS hazard Decisions 6
    names, confirmed end to end. **The implementation MUST pass `signableHeaders` or the pin, the
    contract's `requiredRequestHeaders`, and any gate asserting on them are all theatre.**
  - **`HeadObject` cannot distinguish a missing key from a missing bucket**, so the contract's
    second bucket-level `HEAD` is genuinely required, not defensive padding. Both cases returned
    byte-identical `name=NotFound`, `Code=undefined`, `status=404`. `HeadBucket` disambiguates
    cleanly (present → ok, absent → `NotFound`/404). For reference, `GetObject` on a missing key
    _does_ carry `NoSuchKey`, which confirms the stated mechanism: a `HEAD` has no XML body, so the
    S3 error code never arrives.
  - Consequence for the gate-writer and for Phase 6, worth stating once: because the signed
    content-type must match **exactly**, a browser `fetch` with a string body sends
    `text/plain;charset=UTF-8` and gets a 403 against a URL signed for `text/plain`. Uploading a
    `Blob` whose type is set to the signed value is the working pattern. `storageContentTypeSchema`
    rejects parameters such as `; charset=utf-8`, so the charset form cannot be signed either. This
    is inherent to pinning the type, not a defect, but it will bite whoever writes the template's
    storage section.

- **Phase 5 opened on `storage` 2026-08-29. MinIO added to the repo-root `docker-compose.yml`
  (orchestrator-owned, plan section 6) and spiked before any contract was written: 13/13 checks
  green against `minio/minio:RELEASE.2025-09-07T16-13-09Z` on `localhost:9000`, creds
  `hearthkit`/`hearthkit`, console 9001, healthcheck `mc ready local`.** Image tag and credentials
  deliberately match `localInfraServiceImageByName` in `packages/cli/src/cli-contract.ts` so the repo
  compose and a generated project's compose agree. AWS SDK v3.1121.0
  (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, 27 transitive packages).
  - **The MinIO community image is frozen and that is now a confirmed fact, not a worry.** Docker Hub
    shows no push since 2025-09-07 — ~12 months — and `latest` points at the same digest as the
    pinned tag. The `cli` contract's "final choice deferred to Phase 5" is hereby resolved as: keep
    the pin. It is local-development only, it passes every check the plan entry requires, and plan
    section 4.5's "R2 and MinIO both speak S3, so the only difference is the endpoint" is exactly
    what makes swapping the local server later a one-line change. Not escalated to the user.
  - **`forcePathStyle: true` is required for MinIO** — presigned URLs come out as
    `http://localhost:9000/<bucket>/<key>`, not virtual-host style. R2 accepts path style too, so one
    setting serves both, but the contract has to name it rather than leave it to the implementor.
  - **The plan entry's four env vars are not sufficient.** The SDK requires a `region` even though
    MinIO ignores its value (R2 wants `auto`). Either a fifth variable or a documented constant is
    needed; the contract must settle which.
  - **"Object not found" cannot be a failure mode of delete.** S3 delete is idempotent: removing a
    key that never existed returned success, not an error. The failure mode is real for download and
    head only, so either delete does a HEAD first or the contract narrows where the mode applies.
  - **An unreachable endpoint throws `AggregateError` with an EMPTY message** — the one error shape
    here that is useless as-is, so it needs wrapping into a named failure with the endpoint in the
    text. Contrast with the well-named ones: `NoSuchBucket`/404 for a missing bucket,
    `InvalidAccessKeyId`/403 for bad credentials, `NotFound`/404 for a missing key.
  - Also confirmed working, each worth a gate: presigned PUT accepted from plain `fetch` (200);
    presigned GET round-tripped bytes; `ResponseContentDisposition` survived presigning, so
    download-filename control needs no server-side proxying; list honoured `Prefix` and `MaxKeys` and
    returned a continuation token, so pagination is available; **an expired presigned URL was
    rejected with 403**, so expiry is enforced by the server rather than merely advisory.
  - Gap noted, not this loop's call: the `cli` compose generator emits no healthcheck for its `minio`
    service (postgres gets one), so `hearthkit dev` has nothing to wait on. Repo compose has one.

- Throwaway probe deleted by the user 2026-08-29; orchestrator confirmed
  `chrisdevelops/hearthkit-template-probe-80cr2w` no longer resolves. **Not confirmed:** whether the
  linked GHCR container package went with it — the orchestrator's `gh` token lacks `read:packages`,
  so the query returns 403 rather than an answer. Check
  https://github.com/users/chrisdevelops/packages if a stray package matters later. Nothing blocks
  on it, which is why this sits here rather than under Open issues.

- **`@hearthkit/ui/ui-contract` subpath round merged 2026-08-29 (PR #9, cf0e84d); the contract
  mirror is deleted.**
  `packages/ui/package.json` now publishes a third subpath, `./ui-contract` → `./src/ui-contract.ts`,
  which is JSX-free and imports only zod. `templates/app/src/app-template-contract.ts` takes its two
  theme constants from that subpath instead of the `@hearthkit/ui` entry, so the whole template
  contract is importable from bare Node — and `src/verify-app-container-contract-mirror.ts`, 118
  lines re-declaring 13 contract values, is gone. `verify-app-container.ts` and
  `materialize-app-template-project.ts` import the contract directly. Net −44 lines.
  - **All six commands orchestrator-run and green.** `pnpm --filter @hearthkit/ui test` 27/27 (was
    23), `pnpm --filter @hearthkit/app-template test` 27/27 (was 26), `pnpm typecheck` exit 0 all
    six projects, `pnpm lint` exit 0, `pnpm format:check` exit 0.
  - **`pnpm --filter @hearthkit/app-template run verify:container` passed all seven steps with the
    mirror deleted**, which is the proof that matters: the script read the real contract. `/health`
    answered 200 after 1145 ms, container stdout carried `hearthkit app started`, Playwright smoke
    2/2 against the image, clean teardown.
  - Bare Node importing `templates/app/src/app-template-contract.ts` confirmed directly by the
    orchestrator: exit 0, 49 exports, `appTemplateGlobalsCssRequiredLines` carrying both
    ui-sourced literals.
  - **Four new gates, and one of them exists because the first design of it was wrong.** Bare-Node
    loadability covers only the `.tsx` half of the rule "`ui-contract.ts` stays JSX-free and imports
    nothing but zod". `@hearthkit/config`'s entry is a `.ts` file that pnpm's symlink resolves
    outside `node_modules`, so a sibling-package import would load cleanly from bare Node while
    breaking the rule and leaving every runtime check green. A static scan of the file's import
    specifiers against `['zod']` closes that half; neither check subsumes the other. The same
    finding corrected an overstated sentence in `packages/ui/CONTRACT.md`.
  - The gate proving bare Node can import the subpath spawns a real `node` (never an in-process
    import) for two reasons worth keeping: Vite transforms `.tsx` happily, so the wall is invisible
    inside Vitest; and `packages/ui/vitest.config.ts` aliases the string `@hearthkit/ui`, which Vite
    also applies to `@hearthkit/ui/…`, so an in-process subpath import never reaches the exports map.
    The child resolves the real specifier through Node's **self-referencing** rule — a manifest with
    `name` + `exports` can be imported by its own name from inside itself — so the ui gate needs no
    self-link and never borrows another package's `node_modules`. `NODE_OPTIONS` is stripped from
    the child so a parent loader cannot decide the answer.
  - A control gate pins the wall: bare Node still refuses the `.` entry. Green before and after, by
    design. If it ever goes red, the subpath's reason for existing has changed.
  - **Phase 6 limit, recorded now so it is not rediscovered:** this works in-workspace because
    pnpm's symlink resolves to a real path outside `node_modules`. Node refuses to strip types from
    a file whose resolved path is under `node_modules`, so once `@hearthkit/ui` is installed from
    npm as a real directory, `@hearthkit/create` hits that wall — a different one from the JSX wall
    this round removed. Same constraint the 2026-08-27 hybrid-TS decision already recorded for
    `cli` and `create`: a registry install of a Node-executed package needs a publish-time build.
    Stated in `packages/ui/CONTRACT.md` as a Phase 6 packaging decision, not decided here.

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
  1. **SUPERSEDED 2026-08-29 — the mirror is gone.** This entry recorded that
     `verify:container` mirrored the contract because `src/app-template-contract.ts` imported
     `@hearthkit/ui`, whose only entry resolves through `.tsx` and which bare Node refuses
     (`ERR_UNKNOWN_FILE_EXTENSION`, reproduced with and without `--experimental-transform-types`).
     The predicted fix was the right one: `@hearthkit/ui` now publishes the JSX-free
     `./ui-contract` subpath, the contract imports its two theme constants from there, and
     `src/verify-app-container-contract-mirror.ts` is deleted. See the subpath round entry at the
     top of this section.
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
