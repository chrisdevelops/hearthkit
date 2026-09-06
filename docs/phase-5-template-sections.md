# Phase 5: the app template's conditional sections

The outstanding half of Phase 5's definition of done. `docs/PLAN.md` is the authority on what hearthkit
is building; this file is a working plan for one deferred piece of it, and it should be deleted once
the work lands and Phase 5 is ticked.

## What is required

Plan section 11, Phase 5, definition of done, in full:

> Done when: each package's gates pass against compose (Stripe against test mode) **and the template's
> conditional sections render for each**.

The first clause is met. `storage`, `email`, `auth` and `payments` are all merged with passing gates,
the last of them proven on a runner at 45/45 with zero skipped. **The second clause has no coverage at
all — not partial, none.**

Two other plan sections define the shape of the work:

- **Section 5:** "`templates/app` is a Next.js App Router project wired to `config` and `ui`, with
  conditional sections for each optional package … Playwright: one smoke test always (home page
  renders, health returns 200), plus **one flow per optional package** (sign in, upload a file,
  complete test checkout)."
- **Section 4.10, step 4:** `create` "prunes files for packages not chosen".

Together those fix the architecture: **the template is the superset and pruning is subtractive.** The
template carries a section for every optional package; `create` removes the ones a project did not
select. Nothing is generated or assembled at scaffold time.

## Measured current state, 2026-09-06

Read off `main` at `6b88e0f`, not inferred:

| Thing                                                                                    | State                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `appTemplateRequiredPackageNames`                                                        | `config`, `observability`, `ui` — no optional package                                                                     |
| `.env.example`                                                                           | three variables: `NODE_ENV`, `GLITCHTIP_DSN`, `LOG_LEVEL`                                                                 |
| `app/page.tsx`                                                                           | references no optional package                                                                                            |
| `e2e/app-smoke.spec.ts`                                                                  | two tests: home page renders, `/health` returns 200                                                                       |
| `isPrunedTemplatePath`                                                                   | removes never-copied dirs, repo-only dirs and paths, `.git`, `hearthkit-packages` — **no concept of an optional package** |
| Occurrences of `storage`/`auth`/`payments`/`email` in `page.tsx`, `.env.example`, `e2e/` | **zero**                                                                                                                  |

So this is greenfield: nothing to refactor, four sections and three-or-four flows to add, and one new
idea to introduce into the pruner.

## Two decisions needed before the work starts

Neither can be settled by reading the plan, and both change the shape of what gets built.

### Decision 1 — what is `email`'s flow?

Section 5 names **three** flows for **four** optional packages: "sign in, upload a file, complete test
checkout". Those map cleanly to `auth`, `storage` and `payments`. **`email` is named nowhere.**

A "flow" here is a Playwright test that drives the running app through a user journey. Email is the
one optional package with no user-facing surface of its own — nobody "does email" in an app, they do
something else that causes mail to be sent. The obvious reading is that email is exercised through
auth's magic-link sign-in: the sign-in flow sends a link, the test reads it out of Mailpit, and
sign-in completes. One flow, two packages.

**That reading has a hole.** `email` depends only on `config`, so a project may select **email without
auth**. Such a project would get an email section with no flow behind it, and the DoD says sections
must render "for each".

| Option                                      | What it means                                                                                                                               | Cost                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **A. No standalone flow**                   | Email is covered via auth's magic link. A project selecting email alone has a section and no flow.                                          | Free, but leaves a named gap in the DoD and makes the email section the only one nothing exercises |
| **B. A minimal email flow** _(recommended)_ | The email section carries a small "send a test email" action; the flow triggers it and asserts the message in Mailpit. Independent of auth. | One small route and one Playwright test                                                            |
| **C. Email section only with auth**         | Treat email as auth-only in the template.                                                                                                   | Contradicts the dependency graph and puts a conditional inside a conditional in the pruner         |

**Recommendation: B.** It is small, it makes the section self-justifying, it keeps the pruner's rule
flat — one section per package, pruned independently — and it matches the other three, each of which
has a visible thing a person can do. A magic-link sign-in still exercises email a second time, which
is a bonus rather than a duplication.

### Decision 2 — can this be finished inside Phase 5, or does it belong to Phase 6?

Proving a section renders **conditionally** requires something that prunes, and the pruner is
`create`, which is Phase 6. Inside Phase 5 the most that can be proven is that **the superset renders
and every flow passes with all four packages installed**.

| Option                                     | What it means                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Amend Phase 5's DoD** _(recommended)_ | Phase 5 requires the superset to carry and exercise a section per package. Conditionality moves to Phase 6's DoD, where `create` already has to prove "the three scaffold gate variants install, boot, and pass Playwright" |
| **B. Move the whole item to Phase 6**      | Phase 5 closes on gates alone; sections and flows are built alongside `create`                                                                                                                                              |
| **C. Build a throwaway pruner in Phase 5** | Prove conditionality now, then delete it when `create` arrives                                                                                                                                                              |

**Recommendation: A.** The verification Phase 6 already owes — three scaffold variants that install,
boot and pass Playwright — _is_ the conditional-rendering proof, so option A adds no work to Phase 6
and removes an unprovable clause from Phase 5. **C is the one to avoid:** a second pruner that must
agree with the real one is exactly the duplicated-knowledge shape the plan's "opinions live in exactly
two places" rule exists to prevent.

This decision is the orchestrator's to raise and the user's to make, because it edits `docs/PLAN.md`.

## Per-package work

Environment variable names below are read from each package's `envSchemaFragment`, not from the plan —
the plan's section 4 list is slightly out of date in two places (`storage` also has `STORAGE_REGION`;
`email`'s transport credentials are seven named variables, not "transport credentials").

### `storage` — "upload a file"

- **Env:** `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`
- **Section:** a file picker that asks a route handler for a presigned upload URL, `PUT`s the bytes
  straight to storage, then presigns a download and shows the object back. The server never handles
  file bytes — that is the package's whole point and the section should demonstrate it, not hide it.
- **Flow:** upload a fixture file, assert it is listed, fetch it back and compare bytes.
- **Local infra:** MinIO, already in compose and already mapped by the CLI.

### `auth` — "sign in"

- **Env:** `AUTH_SECRET`, `AUTH_BASE_URL`, optional `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`,
  `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`
- **Section:** `app/api/auth/[...all]/route.ts`, a sign-in page offering password and magic link, and
  a signed-in area showing the session.
- **Flow:** sign up with a password, sign out, request a magic link, read it from Mailpit, complete
  sign-in, assert the session.
- **Local infra:** Postgres and Mailpit. Also needs the auth tables — the app owns the migration, so
  the template must ship a Drizzle config that includes `hearthkitAuthDrizzleSchema` and a documented
  `drizzle-kit generate` step.
- **Note:** this is the largest of the four, and the only one that adds a route handler.

### `email` — pending Decision 1

- **Env:** `EMAIL_TRANSPORT`, `EMAIL_FROM`, plus `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`,
  `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD` for smtp, or `EMAIL_RESEND_API_KEY` and
  `EMAIL_RESEND_BASE_URL` for resend
- **Section (option B):** a "send a test email" action posting to a route handler that sends one
  templated message.
- **Flow (option B):** trigger it, poll Mailpit's API, assert subject and both body parts.
- **Local infra:** Mailpit.

### `payments` — "complete test checkout"

- **Env:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- **Section:** a `payments-catalog.ts`, a pricing area that calls `createCheckoutSession` and
  redirects, a return page, a billing-portal link, and `app/api/payments/webhook/route.ts` reading the
  **raw** body.
- **Flow:** this is the one that needs the most thought, and it should be scoped before it is built.
  Driving Stripe's hosted Checkout page with Playwright means automating a third-party UI that this
  project does not control and that changes without notice. Two saner shapes: assert the redirect
  reaches a `checkout.stripe.com` URL carrying the right session, then drive the _rest_ of the journey
  by posting a signed `checkout.session.completed` to the webhook route — which is exactly how the
  package's own gates already prove the state transition; or run the whole flow against a stubbed
  checkout host. **Decide this before writing it.**
- **Local infra:** Stripe test mode. Needs `STRIPE_SECRET_KEY` in the template's CI too, the same
  wiring added to the hearthkit repo's `ci.yml` in PR #14.
- **Note:** `payments` requires `auth`, so its section can assume a session exists.

### The pruner

`isPrunedTemplatePath` currently answers one question: is this path hearthkit-only? It needs a second:
**which optional package does this path belong to, and was that package selected?** That is a new
concept in `templates/app`'s contract, and it is the piece `create` consumes in Phase 6, so its shape
matters more than the sections themselves.

The cheapest shape that stays greppable is a declared map from optional package name to the paths and
env-var names it owns, exported from `app-template-contract.ts` — the same one-map-one-truth pattern
`localInfraServicesByHearthkitPackage` already uses in the CLI. Sections then live in files named for
their package so the map stays short.

## Sequencing

The user's deferral reasoning holds and should be kept: doing these one package at a time means four
rounds touching the same `page.tsx`, `.env.example` and Playwright config.

1. **Settle Decisions 1 and 2.** Neither is discoverable; both change what gets built.
2. **Scope the payments flow** to a shape that does not automate Stripe's hosted UI.
3. **Contract first**, as every other piece of this repo has been: extend `templates/app`'s
   `CONTRACT.md` and `app-template-contract.ts` with the package-to-paths-and-env map, before any
   section exists.
4. **Gates before sections**, likewise: the template's existing 27 tests are the precedent.
5. **Build all four sections in one pass**, then all flows.
6. **Then Phase 6's `create`** consumes the map, and the three scaffold variants prove conditionality.

## Traps worth carrying in

Recorded in `docs/STATUS.md` and paid for already:

- **A skipped gate is not a passing gate.** The payments flow will be the template's first
  key-dependent test; tag it to skip without a key and then _check the count_, never the exit code.
- **Adding a service to compose is half the job** — `ci.yml` must be taught about it in the same
  commit. This cost PR #10 a red CI.
- **A shared service's contents are shared mutable state.** `email`'s gates clear Mailpit wholesale
  and count its messages; a template flow sending mail into the same container will collide with them
  exactly as the `auth` gates would have. Give the template's flows their own Mailpit or their own
  isolation.
- **`pnpm --filter <name>` exits 0 when nothing matches.** Seven occurrences so far.
- **Reading CI logs needs ANSI stripped first** (`perl -pe 's/\e\[[0-9;]*m//g'`), or the test counts
  match nothing and a skipping suite looks identical to one that never ran.

## Open questions this plan does not answer

- Whether `docs/PLAN.md` section 6's service table gains an `auth` row, and whether section 4.8's gate
  wording is corrected. Both are pinned pending an independent cross-check.
- Whether the template ships one `.env.example` carrying every optional variable commented out, or one
  block per package that the pruner removes with its section. The second is more consistent with
  "pruning is subtractive"; the first is easier to read.
