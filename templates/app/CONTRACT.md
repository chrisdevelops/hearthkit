# templates/app — contract

## Purpose

`templates/app` is the Next.js App Router project that `@hearthkit/create` copies to make a new project. It is not a library: it has no public functions a caller imports. It is a **file tree with guaranteed paths** that, once copied and installed, boots into a container serving a themed home page and `/health`. Three packages are wired in every project — `@hearthkit/config`, `@hearthkit/ui`, `@hearthkit/observability` — plus a Dockerfile, a Playwright smoke test, and the two workflows every generated project gets. It is the executable version of the "App setup" section of `docs/theming.md`: if the document and the template disagree, one of them is a bug.

**The template is the superset and pruning is subtractive.** It also carries one section per optional package — `@hearthkit/storage`, `@hearthkit/email`, `@hearthkit/auth`, `@hearthkit/payments` — each with a route a person can use, a Playwright flow that exercises it, and a declared list of everything it owns. `create` removes the ones a project did not select. Nothing is generated or assembled at scaffold time.

Because the tree is the deliverable, this contract's job is to say precisely **which files exist**, **which of them reach a user's project**, **what the running app must do**, and **how each of those can fail**. Phase 6's pruning, the template's own gates, and the batched container run all assert against the lists in `src/app-template-contract.ts` rather than against prose. The single most important of those lists is `appTemplateSectionsByOptionalPackage`, because it is what `create` consumes.

## Inputs

### 1. Scaffold-time input, consumed by `@hearthkit/create` in Phase 6

Two values: the project name and the optional-package selection.

The project name is `HearthkitProjectName` — the branded, lowercase-kebab-case name owned by `@hearthkit/cli` (`hearthkitProjectNameSchema`). This contract deliberately does not re-declare it (one concept, one spelling) and therefore takes no dependency on `@hearthkit/cli`; `create` validates it and passes it in. It reaches exactly one file: the `name` field of `package.json`. `Dockerfile`, both workflows, and every source file are name-independent, so the scaffolder never rewrites them.

The selection is a list of `AppTemplateOptionalPackageName`, drawn from `appTemplateOptionalPackageNames`: `@hearthkit/storage`, `@hearthkit/email`, `@hearthkit/auth`, `@hearthkit/payments`. `@hearthkit/db` is deliberately **not** selectable, because plan 4.2 makes it a package `auth` and `payments` pull in rather than one a project picks; `@hearthkit/auth` owns `DATABASE_URL` and the Drizzle wiring for the same reason `localInfraServicesByHearthkitPackage` maps `@hearthkit/auth` to `postgres`.

**An absent list and an empty list are different answers, and confusing them is the mistake that silently produces the wrong tree.** Absent means the superset — every optional package present, nothing pruned for being optional — which is the template itself. An empty list means no optional package at all, which is exactly the tree `appGeneratedProjectGuaranteedPaths` describes and what `verify:container` materializes.

A selection must be closed over `requiredOptionalPackageNames`: naming `@hearthkit/payments` without `@hearthkit/auth`, or `@hearthkit/auth` without `@hearthkit/email`, is `app-template-optional-selection-incomplete`. `create` resolves that itself (plan 4.10 step 2) rather than reporting it to a user.

The full set of things `create` must change instead of copying is `appTemplateScaffoldRewriteTargets`. The first five are Phase 4's; the last four only ever delete:

- `project-package-name` — `package.json` `name`: `@hearthkit/app-template` becomes the project name.
- `hearthkit-dependency-specifier` — every `@hearthkit/*` dependency: `workspace:*` becomes a published version range.
- `repo-only-script` — delete the scripts in `appTemplateRepoOnlyScriptNames` (`test`, `verify:container`).
- `repo-only-dependency` — delete the dev dependencies in `appTemplateRepoOnlyDependencyNames` (`vitest`, `zod`).
- `gitignore-file-rename` — write `gitignore` as `.gitignore`, because npm strips a nested `.gitignore` from a published tarball (see **Verified**).
- `optional-package-section` — delete every path in an unselected package's `ownedTemplatePaths`.
- `optional-package-block` — delete every marked block an unselected package holds in a file that survives.
- `optional-package-dependency` — delete an unselected package's `hearthkitDependencyNames` from `dependencies` and from `transpilePackages`, and its `devDependencyNames` from `devDependencies`.
- `optional-package-script` — delete an unselected package's added scripts from `scripts`, and set `scripts.dev` to `next dev` when nothing is selected or `hearthkit dev` when anything is. Both are JSON field edits, per **`package.json`**.

### 2. Environment variables the running app reads

Declared by the packages that own them and composed by `@hearthkit/config`.

`appTemplateEnvVariableNames` is the set present **whatever the selection is**, and `.env.example` documents exactly these outside every section block:

- `NODE_ENV` — `development`, `test`, or `production`. Optional, defaults to `development`. Example: `production`. Owned by `@hearthkit/config`.
- `GLITCHTIP_DSN` — an http(s) URL in Sentry DSN form. Optional; unset means error reporting is a no-op. Example: `https://abc123@glitchtip.example.com/1`. Owned by `@hearthkit/observability`.
- `LOG_LEVEL` — one of `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Optional, defaults to `info`. Example: `debug`. Owned by `@hearthkit/observability`.

`appTemplateSupersetEnvVariableNames` is the whole set the superset template reads: those three plus each optional package's `envVariableNames`. It is written out by hand rather than derived, so a gate proves the map and the list agree instead of the list being true by construction.

**Compare it as a sorted set, never as an ordered list.** The order in the file is grouped by owner for a reader and matches no `envSchemaFragment`'s key order — `storageEnvSchemaFragment` declares `STORAGE_REGION` last while this list has it third. An ordered comparison fails, and the failure reads like a defect in the map when it is a defect in the comparison. **Every name in it was read off the owning package's `envSchemaFragment`, not off plan section 4**, which is stale in two places: it omits `storage`'s `STORAGE_REGION`, and it says "transport credentials" for `email` where there are seven named variables.

| Owner                 | Variables it owns                                                                                                                                                | Which of those the package requires                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@hearthkit/storage`  | `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`                                                     | all but `STORAGE_REGION`, which defaults to `auto`                                                          |
| `@hearthkit/email`    | `EMAIL_TRANSPORT`, `EMAIL_FROM`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, `EMAIL_RESEND_API_KEY`, `EMAIL_RESEND_BASE_URL` | `EMAIL_TRANSPORT` and `EMAIL_FROM`; the rest are per-transport and checked by `resolveEmailTransportConfig` |
| `@hearthkit/auth`     | `DATABASE_URL`, `AUTH_SECRET`, `AUTH_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                           | the first three; the OAuth halves are paired by `resolveAuthRuntimeConfig`                                  |
| `@hearthkit/payments` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                                                                                                                     | both                                                                                                        |

**No variable is required with an empty selection**, which is why a project that picks nothing still boots on an empty environment. Selecting anything changes that: `app-boot-config-invalid` becomes reachable through a **missing** variable and not only through an invalid one, which is exactly what the Phase 4 contract said would happen once a Phase 5 package contributed a required variable. Empty string counts as unset, per config's rule.

`DATABASE_URL` sits under `@hearthkit/auth` rather than under a `db` entry of its own because a variable belongs to exactly one owner (see **The optional package sections**), and `auth` is the lowest selectable package that needs Postgres. `@hearthkit/payments` reaches it through `requiredOptionalPackageNames`.

Two more variables are read by the Next standalone server itself and never validated by config (`appTemplateContainerEnvVariableNames`):

- `PORT` — optional, defaults to `3000`, set by `ENV PORT` in the Dockerfile.
- `HOSTNAME` — optional, but must be `0.0.0.0` inside a container, set by `ENV HOSTNAME` in the Dockerfile.

### 3. Test-time input

Two variables, neither validated by `@hearthkit/config` and neither in `appTemplateSupersetEnvVariableNames`, because both are read by specs rather than by the app.

- `SMOKE_TEST_BASE_URL` (`appSmokeBaseUrlEnvVariableName`). When set, the Playwright smoke test runs against that already-running server and starts nothing itself; that is how the same spec runs against both `next start` in project CI and the container in the batched verify. When unset it defaults to `appSmokeDefaultBaseUrl` and Playwright's `webServer` starts the app.
- `MAILPIT_API_BASE_URL` (`appMailpitApiBaseUrlEnvVariableName`), read by the email and auth flows. Defaults to `appMailpitDefaultApiBaseUrl`, `http://127.0.0.1:8025`, which is the port `hearthkit dev infra up` publishes for a project. It exists so a run can be pointed at an isolated Mailpit; see the email section for why that isolation cannot live in the spec.

### 4. Named exports inside the tree

The template has no importable package entry, but the gates import these names by path, so they are contract surface and the implementor may not rename them.

- `requireAppRuntimeConfig` in `app-runtime-config.ts` — `(options?: { env?: EnvSource }) => AppRuntimeConfig`. Passes the fragment list to `requireHearthkitConfig` and returns the frozen config, or throws. `env` defaults to `process.env` and exists so a gate can prove the boot-failure path without a container.
- `appEnvSchemaFragments` in `app-runtime-config.ts` — `readonly EnvSchemaFragment[]`. With an empty selection it is `[configEnvSchemaFragment, observabilityEnvSchemaFragment]`; each selected optional package adds its own fragment inside its marked block, so the superset also carries `storageEnvSchemaFragment`, `emailEnvSchemaFragment`, `dbEnvSchemaFragment`, `authEnvSchemaFragment` and `paymentsEnvSchemaFragment`.
- `appHealthCheckRegistry` in `app-health-checks.ts` — `AppHealthCheckRegistry`, that is `readonly NamedHealthCheck[]`. Empty with an empty selection; `@hearthkit/auth`'s block appends the one check named in its `healthCheckNames`, `database`.
- `register` and `onRequestError` in `instrumentation.ts` — Next's own file convention; behavior is in the running-app section below.
- `GET` in `app/health/route.ts` — `(request: Request) => Promise<Response>`, produced by `createHealthRouteHandler`. A gate calls it directly.

Every optional package's own files export names too, listed with each section below. The rule that covers all of them: **a section's exports are imported only from paths that same package owns.** That is the optional-package form of the repo-only import invariant, and it is what makes whole-file pruning safe.

## Outputs

### The template tree

`appTemplateGuaranteedPaths` — 23 literal paths that must exist in `templates/app` **whatever the selection is**:

```
.dockerignore                   app/globals.css          next.config.ts
.env.example                    app/health/route.ts      package.json
.github/workflows/ci.yml        app/layout.tsx           playwright.config.ts
.github/workflows/deploy.yml    app/page.tsx             postcss.config.mjs
.oxlintrc.json                  docs/theming.md          public/.gitkeep
Dockerfile                      e2e/app-smoke.spec.ts    tsconfig.json
README.md                       gitignore
app-health-checks.ts            instrumentation.ts
app-runtime-config.ts
```

The split between what ships and what stays here is one rule plus two files:

- **Copied:** everything not listed below. The Dockerfile, both workflows, `playwright.config.ts`, and `e2e/app-smoke.spec.ts` are project deliverables even though the smoke spec is also a hearthkit gate.
- **hearthkit-only:** everything under the directories in `appTemplateRepoOnlyDirectoryNames` — `src/` (this contract, the shape gates, the container verify script) and `test-fixtures/` (gate fixtures, which may not exist yet; the prune rule must tolerate an absent directory) — plus `CONTRACT.md` and `vitest.config.mts` (`appTemplateRepoOnlyPaths`).
- **Never copied:** `node_modules`, `.next`, `test-results`, `playwright-report` (`appTemplateNeverCopiedDirectoryNames`).

That list is deliberately **not** widened to hold the optional packages' files. `appGeneratedProjectGuaranteedPaths` is derived from it, and that derived list is exactly the project a user gets when they pick nothing — the tree that must stay byte-for-byte what the template produces today. The optional packages' paths live in `appTemplateSectionsByOptionalPackage` instead, so "what does every project have" and "what does this package add" are never tangled in one list. The superset tree is the union of the two, and a gate asserts both halves exist on disk.

**The invariant that makes pruning safe: no file outside the repo-only directories may import from them.** Deleting `src/` and `test-fixtures/` therefore cannot break the app. Runtime files that need a value this contract also holds (the fragment list, the health registry) declare it themselves, and the gate asserts the two agree. The optional-package form of the same invariant is under **The optional package sections**.

`appGeneratedProjectGuaranteedPaths` is the same list with the renames applied, which is what a Phase 6 gate asserts against a scaffolded project that selected nothing.

`public/.gitkeep` is a guaranteed path for two reasons: the runner stage of the Dockerfile copies `public/` unconditionally, and `COPY` fails the build when the directory is absent (Next never creates one); and a real app wants somewhere to put a favicon on day one. Unlike `.gitignore`, `.gitkeep` matches nothing in npm's always-excluded list, so it survives publishing without a rename.

### The optional package sections

The template is the superset and pruning is subtractive (plan section 5 and plan 4.10 step 4). One declared map, `appTemplateSectionsByOptionalPackage`, says what each optional package owns. It follows `localInfraServicesByHearthkitPackage` in `@hearthkit/cli`: one map, one truth, values as lists, `as const satisfies Record<…>`. **This is the value `@hearthkit/create` consumes in Phase 6, so its shape matters more than any individual section.**

Each entry carries ten fields:

| Field                          | What it is                                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `sectionRoutePath`             | The URL the section renders at, and where its Playwright flow starts                                             |
| `flowSpecPath`                 | The one flow per optional package plan section 5 asks for; also appears in `ownedTemplatePaths`                  |
| `ownedTemplatePaths`           | Files this package owns outright, deleted whole when it is not selected                                          |
| `blockPrunedPaths`             | Files this package holds marked blocks in; usually always-present files, and for `payments` two that `auth` owns |
| `envVariableNames`             | The variables it contributes to `.env.example` and to the boot schema                                            |
| `healthCheckNames`             | The names it appends to `appHealthCheckRegistry`                                                                 |
| `hearthkitDependencyNames`     | Runtime `@hearthkit/*` dependencies, which are also its `transpilePackages` entries                              |
| `devDependencyNames`           | Dev dependencies it adds                                                                                         |
| `packageScriptNames`           | `package.json` scripts it adds, or whose value it changes — see **`package.json`**                               |
| `requiredOptionalPackageNames` | Other optional packages a selection must also carry                                                              |

**Two ownership rules, different on purpose.** `ownedTemplatePaths` and `envVariableNames` are **exclusive**: a path or a variable belongs to exactly one package, because pruning must answer "who owns this" with one name and a `.env.example` block must have one owner. Every other list is **unioned and deduplicated** across the selected packages, exactly as `postgres` appears under both `@hearthkit/db` and `@hearthkit/auth` in the cli map — which is why `@hearthkit/cli` may sit in four `devDependencyNames` lists without conflict.

`requiredOptionalPackageNames` is what keeps exclusive env ownership sound. `createAuthServerInstance` takes an `emailTransportConfig`, so `@hearthkit/auth` reads `EMAIL_TRANSPORT` and `EMAIL_FROM` — variables that live in `@hearthkit/email`'s block. Rather than duplicating them, `auth` requires `email`. `@hearthkit/payments` requires `@hearthkit/auth` for the same reason and because `@hearthkit/payments` depends on `@hearthkit/auth` in its own `package.json`.

#### How `isPrunedTemplatePath` changes

Today `isPrunedTemplatePath(relativePath): boolean` in `materialize-app-template-project.ts` answers one question: is this path hearthkit-only? It becomes `decideTemplatePathPrune`, typed `DecideTemplatePathPrune`, and answers two. The name changes with the return type, because "is…" that returns a record is a lie.

- **Input** — `DecideTemplatePathPruneOptions`: `templateRelativePath` (a plain string, because a caller walking a directory has not parsed it yet) and an optional `selectedOptionalPackageNames`.
- **Absent selection means the superset.** Nothing is pruned for being optional, so the answer describes `templates/app` itself. **`verify:container` does not use it** — that command materializes with an **empty** selection, per **The batched container verify command**. Its own call into `materializeAppTemplateProject` is unchanged, because the empty selection lives inside the materializer rather than at the call site.
- **An empty selection means no optional package.** Every path owned by any of the four is pruned. `undefined` and `[]` are never the same answer.
- **The superset would break `verify:container` outright, which is why the empty selection is not merely a preference.** `packWorkspacePackage` packs only `appTemplateRequiredPackageNames`, so a superset manifest would reach the materialized project carrying five unresolvable `workspace:*` specifiers — `@hearthkit/storage`, `email`, `auth`, `db` and `payments` — and the install would fail before Docker was ever reached.
- **Output** — `AppTemplatePruneDecision`, a discriminated union on `kind`: `template-path-copied`, `template-path-never-copied`, `template-path-repo-only`, or `template-path-optional-package-unselected` carrying `owningOptionalPackageName`. Only the first reaches a generated project. A union rather than a boolean so `create` can say _which_ package caused a deletion, which is the second question the old signature could not express.

`.git` and the verify harness's own `hearthkit-packages` directory stay hardcoded in the materializer as `template-path-never-copied`. Neither is part of the template artifact — one is the repo, one is scaffolding the harness writes — so neither joins `appTemplateNeverCopiedDirectoryNames`.

**Both pruners are exported by name from `appTemplatePrunerModulePath`, that is `src/materialize-app-template-project.ts`.** `decideTemplatePathPrune` and `pruneOptionalSectionBlocks` are two halves of one rule — one decides whether a file survives, the other decides which of its lines do — and the gates read both from that module, so neither may be an unexported local the way `isPrunedTemplatePath` was. The module may implement them or re-export them by name; it may not hide them.

#### Marked blocks, and why `.env.example` alone is not enough

A whole file cannot be the unit of pruning everywhere. `app-runtime-config.ts` composes `appEnvSchemaFragments` from **named imports**, so selecting storage means adding an import to a file that exists in every project, and not selecting it means the import must not be there. Whole-file pruning cannot do that. The same is true of `app-health-checks.ts`, of `transpilePackages` in `next.config.ts`, and — by the orchestrator's ruling — of `.env.example`.

**`app-runtime-config.ts` is the file to test hardest, not `.env.example`.** A mis-delimited block there deletes an import and the project fails to build, or worse, deletes an import and leaves a use of it. A mis-delimited block in `.env.example` only breaks boot, with a message from `@hearthkit/config` naming the variable. The `.env.example` case is the more obvious one; it is not the more dangerous one.

**The mechanism deletes between balanced markers and does nothing else.** No value is rewritten, no identifier substituted, no placeholder filled. A need that cannot be met by deleting a marked region comes back to the orchestrator rather than widening this. So the block is the second unit of pruning, and it is one mechanism used in every such file:

- A block **begins** with a line containing `appTemplateSectionBlockBeginPrefix`, one space, and the exact package name — `hearthkit-section:begin @hearthkit/storage`.
- It **ends** with a line containing `appTemplateSectionBlockEndPrefix` and the same package name.
- The marker text carries **no comment character**, so one rule covers `#` in `.env.example` and `//` in a TypeScript file. A marker line is a line that _contains_ the marker; it need not equal it.
- **At most one block is open at any line.** Blocks never nest and never overlap, whatever package they belong to. That single invariant is what makes removal a one-pass line filter.
- A package may hold **more than one block in the same file**, because an import statement and an array entry are two regions of `app-runtime-config.ts` and cannot be one.
- **Order matters and is fixed: blocks are removed from files that survive; a file that is itself pruned takes its blocks with it.** That is how `@hearthkit/payments`' block inside `drizzle.config.ts` and `app-drizzle-schema.ts` — files `@hearthkit/auth` owns — is well defined. A selection carrying payments always carries auth, so those files are always there when the block matters.
- Unbalanced, overlapping, out-of-order or duplicated markers are `app-template-optional-block-malformed`. This is the guard that stops a sloppy rule silently producing a broken file, and it is the reason the loose "contains" match is safe: a stray mention of the marker text anywhere in a block-pruned file fails that gate rather than swallowing lines.

**An absent selection and an explicit one do different things to a marker, and this is the part a reader gets wrong.** An earlier draft of this contract said both "everything else is returned byte for byte" and "no marker survives at any selection including the full superset". Those cannot both hold: a _selected_ package's markers sit outside every removed block, so byte-for-byte preserves exactly what the no-marker rule forbids. The reconciliation:

- **Absent selection — the text is returned unchanged, markers and all.** That call describes the template itself, and **the template must keep its markers or it stops being prunable.** Nothing is deleted and nothing is stripped.
- **Explicit selection, whether empty, partial, or naming all four —** every unselected package's block is deleted from its begin line through its end line **inclusive**, plus any blank lines immediately following the end marker; and every **kept** block has its begin and end lines **stripped**, leaving that block's contents in place. Every other line is returned byte for byte.
- The trailing-blank rule is what makes the result independent of which subset was removed. Each block is written with exactly one blank line after its end marker, so removing any combination leaves one blank line between what remains, and an empty selection returns the file to the state it is in today.

**Two properties make this mechanism safe, and both are gates rather than conventions.** They are stated here so the gate-writer cannot miss them:

1. **A generated project contains no marker text at all** — not one occurrence of `appTemplateSectionBlockBeginPrefix` or `appTemplateSectionBlockEndPrefix` in any file, at **any explicit selection including all four**. That is what the marker-stripping half of the rule above exists to deliver. A surviving marker means the pruner skipped a file it should have processed, and the project still runs, so nothing else catches it. **This property is asserted against a generated project and never against `templates/app`**, whose markers are correct and required.
2. **A generated project still typechecks.** `pnpm typecheck` on the scaffolded project is what proves a deletion did not leave a use without its import. That is the failure a marker-count check cannot see, and it is the one the block mechanism was granted in order to avoid.

For `.env.example` specifically: the four blocks are appended after the always-on variables in `appTemplateOptionalPackageNames` order; each variable appears in exactly one block; a variable found outside its owner's block, or inside two, is `app-template-env-block-mismatch`. The file's header may only state what is true in every selection, since it sits outside every block and is never pruned.

#### The rule that makes whole-file pruning safe

**No file outside an optional package's `ownedTemplatePaths` may import from them**, except through a marked block belonging to that same package. This is the optional-package form of the repo-only import invariant, and it is why `app/page.tsx` is untouched by every section: a home page importing a section would break the moment that section was pruned, and rewriting source content is not something the scaffolder does. Sections are reached by their own route, not from the home page.

#### Section route handler request and response shapes

A section route is contract surface the moment a flow drives it, so three shapes are pinned. The rest of a section's handlers are free, because nothing outside the section calls them.

| Route                          | Request                                                                 | Response                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `POST /api/email/test-message` | `appEmailTestMessageRequestSchema` — `{ "recipientEmailAddress": "…" }` | 2xx on a send; **non-2xx carries `@hearthkit/email`'s own message in the body**, unchanged |
| `POST /api/payments/checkout`  | the price the buyer chose                                               | `createCheckoutSession`'s result, serialized as JSON                                       |
| `POST /api/payments/webhook`   | the **raw** Stripe delivery body, read with `await request.text()`      | `handleStripeWebhook`'s result, serialized as JSON, with the status below                  |

The email route's non-2xx body is what gives `app-section-route-failed` its `owningPackageFailureMessage` and is what the dead-SMTP-port gate reads. The two payments routes answer the package's result value rather than a shape of the template's own devising, so a gate validates the body with `createCheckoutSessionResultSchema` and `handleStripeWebhookResultSchema` — schemas a gate may import and this contract file may not.

**The webhook's status follows the result kind, and every row of this mapping is derived from `@hearthkit/payments`' own contract rather than chosen here.**

| `handleStripeWebhook` result         | Status  | Why                                                                                                                                                                        |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payments-webhook-processed`         | **200** | Recorded.                                                                                                                                                                  |
| `payments-webhook-ignored`           | **200** | A **result, not a failure**. Stripe delivers every subscribed type and most are none of this package's business.                                                           |
| `payments-webhook-signature-invalid` | **400** | `packages/payments/CONTRACT.md:726` specifies it: both signature reasons mean "this request did not come from Stripe", and the caller must "answer 400 and write nothing". |
| `payments-input-invalid`             | **400** | The caller sent something malformed.                                                                                                                                       |
| `payments-database-unavailable`      | **503** | Retryable, and the retry is the operator's signal.                                                                                                                         |
| `payments-request-failed`            | **500** | Retryable, same reason.                                                                                                                                                    |

**The causal chain, stated so nobody simplifies this back to a constant 200: the processed/ignored pair is what keeps normal traffic quiet, and the 5xx pair is what makes an unrecordable checkout visible.** Answering 4xx for an ignored event would put the route into failure on an ordinary Tuesday for every type this package does not handle, and Stripe disables an endpoint that keeps rejecting. Answering 200 for `payments-request-failed` or `payments-database-unavailable` would delete the mechanism `@hearthkit/payments` chose those variants for — a completed checkout it could not record is meant not to vanish quietly, and Stripe's bounded retry is the only thing that makes it visible. Neither half is a preference; both are properties of the owning package that this route can either preserve or destroy.

A 400 for a bad signature carries no retry cost, which an earlier draft of this contract had backwards: **Stripe does not retry a 4xx.** It marks the endpoint as rejecting and surfaces that in the dashboard, which is the right signal for a request that did not come from Stripe.

#### The payments section's markup contract

The payments flow synthesises a `checkout.session.completed` event, and a real delivery carries no `line_items` — `@hearthkit/payments` resolves the purchase path from three session metadata keys instead. A synthesised event must therefore carry the same values, and the flow can only get them from the page. **Without them the flow reaches `checkout-price-metadata-missing`, which is an _ignored_ result rather than the transition the flow exists to prove — a green test that asserted nothing.** So two test ids are contract, not styling:

- `data-testid="billing-reference"` (`appBillingReferenceTestId`) — one element carrying the signed-in billing reference, which the flow stamps into `hearthkit_billing_reference`.
- `data-testid="billing-price"` (`appBillingPriceTestId`) — one element per purchasable price, carrying `data-price-name` (`appBillingPriceNameAttributeName`) and `data-stripe-price-id` (`appBillingStripePriceIdAttributeName`), which become `hearthkit_price_name` and `hearthkit_stripe_price_id`.

Quantity is not in the markup: the section buys one, so the flow sends `hearthkit_quantity` of `1`.

#### Sections must not be prerendered

`next build` runs with an empty environment (see **The container image**). A section page that built a storage connection or a Drizzle client while being prerendered would fail the build with a missing-variable message. So **every section page and section route handler exports `dynamic = appTemplateSectionDynamicMode`, that is `'force-dynamic'`**, and reads config per request rather than at module scope. Route handlers have been dynamic by default since Next 15, but the export is required on them too so the rule is one rule and a gate can check it by reading the file.

#### `@hearthkit/storage` — upload a file

- **Section route:** `/storage`. A file picker that asks a route handler for a presigned upload URL, `PUT`s the bytes straight from the browser to storage, then presigns a download and shows the object back. **The server never handles file bytes** — that is the package's whole point, and the section demonstrates it rather than hiding it.
- **Owns:** `app/storage/page.tsx`; `app/api/storage/upload-url/route.ts` (`POST` → `createPresignedUploadUrl`); `app/api/storage/objects/route.ts` (`GET` → `listStoredObjects`); `app/api/storage/download-url/route.ts` (`POST` → `createPresignedDownloadUrl`); `app-storage-connection.ts`, which builds a `StorageConnection` from config; and its flow spec.
- **Flow, `e2e/storage-upload-flow.spec.ts`:** upload a fixture file, assert it is listed, fetch it back and compare bytes. The fixture is supplied in memory through Playwright's `setInputFiles` payload form, so the template ships no binary and `e2e/` gains no fixture directory.
- **Local infrastructure:** MinIO, already in the repo compose file and already mapped by the CLI.
- **No health check.** Only database reachability is named in plan 4.4, and a bucket ping is not asked for.

#### `@hearthkit/email` — send a test email

- **Section route:** `/email`. A "send a test email" action that posts a recipient address to a route handler, which sends one templated message.
- **Owns:** `app/email/page.tsx`; `app/api/email/test-message/route.ts` (`POST` → `sendTransactionalEmail`); `app-email-transport.ts`, which narrows config through `resolveEmailTransportConfig`; `app-email-test-template.tsx`, a `TransactionalEmailTemplate` the app owns because the package ships only `magic-link-sign-in` and `password-reset`; and its flow spec.
- **Flow, `e2e/email-send-flow.spec.ts`:** trigger the action with a recipient address unique to that run, poll Mailpit, assert the subject and both body parts.
- **Local infrastructure:** Mailpit.
- **Isolation is mandatory, and scoping reads is not enough to achieve it.** An earlier draft offered "scope every read with `GET /api/v1/search?query=to:"<unique address>"` and never issue a removing request" as sufficient. It is not, and the reason is measured rather than theoretical: `@hearthkit/email`'s gates assert Mailpit's `messages_count` exactly, so **the flow's sends inflate a number those gates check**, and `@hearthkit/email`'s own `DELETE /api/v1/messages` **wipes the flow's message before a scoped search can find it**. Scoping reads governs neither direction. The flow must still avoid `DELETE /api/v1/messages` and `DELETE /api/v1/search`, but that is hygiene, not isolation.
- **So the Mailpit address is an input, not a constant.** The flows read `MAILPIT_API_BASE_URL` (`appMailpitApiBaseUrlEnvVariableName`), defaulting to `appMailpitDefaultApiBaseUrl`, that is `http://127.0.0.1:8025`, which is what `hearthkit dev infra up` publishes for a project. **Isolation is applied by whoever runs the Flows tier**, by pointing that variable at an instance no other suite is using.
- **The isolation cannot live in the artifact, and that is why it is an input.** These specs ship into generated projects, so they can carry no Docker orchestration, and `playwright.config.ts` may not import from `test-fixtures/` because the tree gate forbids it. A spec that started its own container would be a spec a user cannot run.
- This section exists because `@hearthkit/email` depends only on `config`, so a project may select it **without** `auth`. Covering email through auth's magic link would leave such a project with a section nothing exercises.

#### `@hearthkit/auth` — sign in

- **Section route:** `/sign-in`, offering password and magic link, plus `/account` showing the session. The largest of the four, and the only one that adds a catch-all route handler.
- **Owns:** `app/sign-in/page.tsx`; `app/account/page.tsx`; `app/api/auth/[...all]/route.ts`, which re-exports the five handlers from `createAuthRouteHandlers`; `app-auth-server.ts`, which builds the `AuthServerInstance` from config, the Drizzle client and the email transport; `app-database-client.ts`, `createDrizzleClient` over `DATABASE_URL`; `app-drizzle-schema.ts`, re-exporting `hearthkitAuthDrizzleSchema` by name; `drizzle.config.ts`; and its flow spec.
- **Flow, `e2e/auth-sign-in-flow.spec.ts`:** sign up with a password, land on `/account` with the session shown, sign out, request a magic link, read it out of Mailpit, open it, complete sign-in, assert the same user.
- **Local infrastructure:** Postgres and Mailpit. It reads the magic link through the same `MAILPIT_API_BASE_URL` input as the email section, and the same isolation rule applies for the same measured reason.
- **The app owns the migration.** The template ships `drizzle.config.ts` and a documented `db:generate` step (`drizzle-kit generate`), not generated SQL. Migrations are then applied with `hearthkit db migrate`. **Consequence: the auth flow cannot run against a database whose tables do not exist**, so generate-and-migrate is a precondition of that flow rather than something the flow assumes.
- **Health check `database`.** The one check any package registers, and the only producer of `app-health-dependency-unavailable`, which was structurally unreachable in Phase 4.
- **Consequence, recorded so nobody "fixes" the wrong file: on the superset, `/health` answers 200 only when Postgres is reachable.** Selecting `auth` registers the `database` check, so the always-on smoke assertion "`/health` returns 200" becomes conditional on a running database. **`e2e/app-smoke.spec.ts` is correct as written and must not be changed** — it runs against a generated project, whose registry holds only what that project selected, and against `verify:container`'s empty-selection container, whose registry is empty. The superset is the only tree where that spec needs a database, and the superset is not what either consumer runs.

#### `@hearthkit/payments` — complete test checkout

- **Section route:** `/billing`, a pricing area plus a billing-portal link, with `/billing/return` as the page Stripe redirects back to. `@hearthkit/payments` requires `@hearthkit/auth`, so the section can assume a session exists.
- **Owns:** `app/billing/page.tsx`; `app/billing/return/page.tsx`; `app/api/payments/checkout/route.ts` (`POST` → `createCheckoutSession`); `app/api/payments/portal/route.ts` (`POST` → `createCustomerPortalSession`); `app/api/payments/webhook/route.ts` (`POST` → `handleStripeWebhook`, reading the **raw** body with `await request.text()`, never `await request.json()`); `app-payments-client.ts`; `payments-catalog.ts`, spelled as plan 4.8 and `@hearthkit/payments`' own contract spell it rather than with the template's `app-` prefix; and its flow spec.
- **Flow, `e2e/payments-checkout-flow.spec.ts`, and it never automates Stripe's hosted UI.** Signed in, choose a price, assert the redirect reaches a `checkout.stripe.com` URL **carrying the `stripeCheckoutSessionId` that `createCheckoutSession` returned**; then post a locally signed `checkout.session.completed` to the webhook route and assert `/billing` reflects it. That is the same transition `@hearthkit/payments`' own gates already prove, and it needs no `stripe listen` session because the webhook secret is a value the flow chooses, not one Stripe issues.
- **Local infrastructure:** Stripe test mode, plus the Postgres the auth section already requires. The template's CI needs `STRIPE_SECRET_KEY` wired the same way the hearthkit repo's `ci.yml` gained it in PR #14.
- **Tag the flow to skip without a key, then check the count, never the exit code.** `docs/STATUS.md` records `37 passed | 8 skipped` as a green exit that had not exercised Stripe at all. A skipped gate is not a passing gate.
- **No health check.** A `payments_*` table check is available through `verifyPaymentsTablesExist` and is deliberately not registered; the plan names only database reachability, which `auth`'s `database` check already covers.

### `package.json`

`name: '@hearthkit/app-template'`, `private: true`, `version: 0.0.0`, `packageManager: 'pnpm@10.33.0'`, `engines.node: '>=24'`. **No `type` field** — the standalone `server.js` Next emits is CommonJS and sits next to a copy of this manifest, and `"type": "module"` is a long-standing standalone breakage (see **Verified**). Every source file is `.ts` or `.tsx` compiled by Next, and `postcss.config.mjs` carries an explicit ESM extension, so nothing needs the field.

Dependencies: the three packages in `appTemplateRequiredPackageNames` at `workspace:*`, plus `next` at `appTemplateNextVersion` and `react`/`react-dom` 19 matching the versions `@hearthkit/ui` develops against. Dev dependencies: `typescript` at `appTemplateTypescriptVersion`, `tailwindcss` and `@tailwindcss/postcss` at `appTemplateTailwindVersion`, `@playwright/test` at `appTemplatePlaywrightVersion`, `oxlint` and `oxlint-tsgolint` matching the repo, the `@types/*` packages TypeScript 7 does not auto-include, and the repo-only `vitest` and `zod`.

On top of that, the superset carries each optional package's `hearthkitDependencyNames` as runtime dependencies at `workspace:*` and its `devDependencyNames` as dev dependencies. `create` deletes the entries of unselected packages (`optional-package-dependency`). `package.json` is JSON and carries no comments, so it has no marked blocks: the manifest is edited field by field, which the scaffolder already does for `repo-only-script` and `repo-only-dependency`.

Every optional package contributes `@hearthkit/cli` as a dev dependency, because selecting any of the four means a local infrastructure service to start. An empty-selection project takes no such dependency, because it has nothing to start.

**`packageScriptNames` covers two cases, and which one applies is decided by whether the name is already in `appTemplateGuaranteedScriptNames`:**

- A name **not** in that list is a script the package **adds**, present only when it is selected. Today that is `db:generate`, from `@hearthkit/auth`.
- A name **in** that list is a script whose **value** the selection changes. Today that is exactly one, `dev`: `next dev` for the empty selection, and `hearthkit dev` as soon as any selected package needs local infrastructure — which is all four, so every one of them lists `dev`.

Both are `package.json` field edits. `package.json` is JSON, and rewriting a JSON field is what the scaffolder has always done to a manifest; neither case touches source. This is why `dev` is not left as `next dev` with a README note telling a user to type `pnpm exec hearthkit dev` instead: `hearthkit dev` starts compose and then Next, which is the CLI's whole purpose, and a project that needs it should get it.

Scripts — `appTemplateGuaranteedScriptNames` ship, `appTemplateRepoOnlyScriptNames` do not, and each optional package's `packageScriptNames` ship or change value only when it is selected:

- `dev` is `next dev` with an empty selection and `hearthkit dev` with any optional package (ships either way).
- `build` is `next build` (ships).
- `start` is `next start` (ships).
- `lint` is `oxlint --type-aware .` (ships).
- `typecheck` is `next typegen && tsc --noEmit` (ships).
- `test:e2e` is `playwright test` (ships).
- `test` is `vitest run`, the fast shape gates (hearthkit-only).
- `verify:container` runs `appTemplateVerifyContainerScriptPath`, the batched Docker and smoke run (hearthkit-only).
- `db:generate` is `drizzle-kit generate`, contributed by `@hearthkit/auth` and present only when it is selected.

`test` must stay the fast gates: the repo-root CI runs `pnpm --recursive --if-present run test` on every pull request, and Playwright must never run there. `typecheck` regenerates `next-env.d.ts` first because that file is gitignored on Next's own instruction.

### Configuration files

- **`next.config.ts`** — `output: 'standalone'` (`appNextConfigOutputMode`) and `transpilePackages` containing every name in `appTemplateRequiredPackageNames`, because those packages ship TypeScript source, plus each selected optional package's `hearthkitDependencyNames` inside that package's marked block, for the same reason. Nothing else is required; the implementor may add `serverExternalPackages` if the build demands it, but never for a package already in `transpilePackages`. `experimental.useTypeScriptCli` must **not** be set: it is already the default in 16.3.3. `cacheComponents` must **not** be set, because turning it on removes the `dynamic` route segment config the sections depend on (see **Verified**). `outputFileTracingRoot` must **not** be set: a generated project is its own tracing root, and the workspace build path is handled by materializing a self-contained directory instead.
- **`tsconfig.json`** — self-contained, **no `extends`**, because a generated project cannot reach `../../tsconfig.base.json`. It mirrors the base's meaningful options (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `verbatimModuleSyntax`, `isolatedModules`, `skipLibCheck`, `forceConsistentCasingInFileNames`, `resolveJsonModule`, `types: ['node']`, `allowImportingTsExtensions`, `erasableSyntaxOnly`) and adds what Next needs: `jsx: 'react-jsx'`, `module: 'preserve'`, `moduleResolution: 'bundler'`, a `lib` including DOM, `noEmit`, and an `include` containing `next-env.d.ts`, `**/*.ts`, `**/*.tsx`, and `.next/dev/types/**/*.ts`. `jsx` and the `.next/dev/types` entry are pre-set so `next build` does not rewrite the file. **No `baseUrl`** — TypeScript 7 removed it and it fails the workspace typecheck with TS5102.
- **`postcss.config.mjs`** — `{ plugins: { '@tailwindcss/postcss': {} } }`, exactly as `docs/theming.md` shows.
- **`app/globals.css`** — `appTemplateGlobalsCssRequiredLines` in order: `@import 'tailwindcss';`, then the theme import built from `hearthkitThemeCssImportSpecifier`, then the literal `tailwindSourceDirectiveForUi`. Both come from `@hearthkit/ui/ui-contract`, the package's JSX-free subpath; neither is retyped here. The `@source` literal is why `globals.css` sits at `app/globals.css`, exactly one level below the app root, and why the template must not use the `src/app` layout.
- **`.oxlintrc.json`** — the repo's rule set, so a generated project lints itself the same way hearthkit does.
- **`gitignore`** — must ignore at least `node_modules/`, `.next/`, `next-env.d.ts`, `.env`, `.env.local`, `test-results/`, `playwright-report/`, `*.tsbuildinfo`, `.DS_Store`.

### The running app

- **`instrumentation.ts`** exports `register()` and `onRequestError`. `register()` calls `requireAppRuntimeConfig()`, then `initializeErrorReporting({ glitchtipDsn, reportingEnvironment: NODE_ENV })`, then logs exactly one line through `createStructuredLogger({ logLevel })` whose message is `appStartupLogMessage`, that is `hearthkit app started`, as newline-delimited JSON on stdout. `onRequestError` forwards the thrown value to `captureError` with the request path, method, and router context as error context. A boot with an invalid variable must fail loudly: the config message reaches stderr and the process does not serve a 200. Next does not document what a throwing `register()` does to the process, so the implementor may exit explicitly to guarantee it.
- **`app/layout.tsx`** imports `./globals.css`, sets `suppressHydrationWarning` on the `html` element, and wraps children in `ThemeModeProvider`.
- **`app/page.tsx`** renders `PageContainer` and `PageHeader` with `ThemeModeToggle` in the actions slot, and a `Card` containing a package `Button`. Its only job is to prove the ui wiring end to end.
- **`app/health/route.ts`** exports `GET = createHealthRouteHandler({ healthChecks: appHealthCheckRegistry })`. No route segment config: GET handlers have been dynamic by default since Next 15, so `/health` is evaluated per request without `force-dynamic`. Body and status codes are observability's `HealthReport`: 200 with `{"status":"ok","checks":[]}` in Phase 4, 503 when a registered check fails.
- **`app-health-checks.ts`** exports `appHealthCheckRegistry`, empty with an empty selection (`appTemplateHealthCheckNames`). `@hearthkit/auth`'s marked block appends `{ healthCheckName: 'database', runHealthCheck }`, which is how a dependency ping reaches `/health` without `@hearthkit/observability` importing `@hearthkit/db`.
- **Each section's page and route handlers** export `dynamic = 'force-dynamic'`, read config per request, and never build a client at module scope. Their behavior is under **The optional package sections**.

### The container image

`Dockerfile`: multi-stage on an exactly pinned `node:24.x-slim` base, `corepack enable pnpm` with `pnpm install --frozen-lockfile`, `next build` in a builder stage **with no environment variables set**, then a runner stage that copies `.next/standalone`, `.next/static`, and `public` (Next copies neither of the last two itself), sets `ENV PORT` and `ENV HOSTNAME=0.0.0.0`, runs `USER node` (`appContainerRunAsUserName`), declares a `HEALTHCHECK` that requests `appHealthRoutePath` on the loopback interface using the image's own Node runtime rather than `curl` or `wget`, and starts `node server.js`.

The image build consumes the project's committed `pnpm-lock.yaml`. The template itself ships none, since the workspace lockfile covers it, which is why the image can only be built from a **materialized project directory**: a copy with the repo-only files pruned, the renames applied, and dependency specifiers that resolve without the workspace. Nothing may symlink outside that directory, or output file tracing drops the hearthkit packages from `.next/standalone`.

### The two workflows

Written in full, at `.github/workflows/` inside the template, so they are inert in the hearthkit repo and live in a generated project. Their required content is pinned as literal strings so a step cannot silently disappear.

- **`ci.yml`** — on pull request: checkout, pnpm, Node 24, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, install the Chromium browser, `pnpm test:e2e`. Every string in `appTemplateCiWorkflowRequiredContent` must appear in the file.
- **`deploy.yml`** — on push to `main`: build the image and push it to `ghcr.io` (`appContainerRegistryHost`) tagged with the commit SHA and `latest`, using the repository's own `GITHUB_TOKEN` with `packages: write`, then call the Dokploy deploy webhook held in the `DOKPLOY_DEPLOY_WEBHOOK_URL` secret (`appDokployWebhookSecretName`). Every string in `appTemplateDeployWorkflowRequiredContent` must appear in the file.

**The webhook step runs only when that secret is set**, which is what keeps build-and-push testable on a throwaway repository with no Dokploy instance. The `secrets` context is not available in any `if` key, so the guard is the documented two-part pattern: map the secret into `env` (allowed in `jobs.<job_id>.env` and step `env`), then condition the step on `env.DOKPLOY_DEPLOY_WEBHOOK_URL != ''`. Both halves are in `appTemplateDeployWorkflowRequiredContent`, so removing either one fails a gate.

### The batched container verify command

`pnpm --filter @hearthkit/app-template run verify:container` runs `appTemplateVerifyContainerScriptPath`. It is implementor-owned code with an observable contract, in this order:

1. Materialize a self-contained project directory in a temporary location **with an empty optional-package selection**: copy the template, drop the repo-only directories and files, drop every optional package's owned paths and marked blocks, apply the renames, delete the repo-only scripts and dev dependencies, and replace every `workspace:*` specifier with something that resolves without the workspace. Packing the three required packages and installing the tarballs is the mechanism that most closely rehearses the published path; the requirement is only that no dependency resolves through a symlink escaping the directory.
2. `pnpm install` in that directory, which also produces the `pnpm-lock.yaml` the image build consumes.
3. `docker build`. On a nonzero exit, print a last stderr line starting with `appImageBuildFailedErrorPrefix` carrying the exit code, and exit 1.
4. Run the container with a published port and poll `appHealthRoutePath` until it answers 200. If it never does within the wait, print a last stderr line starting with `appContainerNotHealthyErrorPrefix` carrying the elapsed milliseconds, dump the container logs, and exit 1.
5. Assert the container's stdout contains `appStartupLogMessage`, which proves config loading, logging, and the standalone server all ran.
6. Run the Playwright smoke against the container with `SMOKE_TEST_BASE_URL` pointing at it.
7. Remove the container and the temporary directory whether or not the run passed, then exit 0 on success and 1 on any failure.

The script and the materializer it calls in step 1 import `src/app-template-contract.ts` directly, so the pruning lists, the health route, the startup log line, and the error prefixes have exactly one source of truth. The mirror module that used to re-declare those values by hand, with a text-substring drift check standing in for a real import, is gone. That is only possible because `@hearthkit/ui/ui-contract` is importable from bare Node: the contract file takes its two theme constants from that subpath rather than from the `@hearthkit/ui` entry point, which resolves through `.tsx` modules that `node` refuses outright (`ERR_UNKNOWN_FILE_EXTENSION`). If the contract ever imports the package entry again, or `@hearthkit/ui` breaks the JSX-free rule on `src/ui-contract.ts`, this script stops being able to read its own contract.

`appVerifyContainerFailedErrorPrefix` — `hearthkit app verify container failed:` — is the prefix the script prints for **its own** failures: a failed `pnpm install`, `docker run`, or `pnpm pack`, a container with no published port, a Playwright run that exited nonzero. It is deliberately **not** a variant of `AppTemplateFailure`: it reports the verification harness failing, not the template artifact being wrong. It is distinct from the two template prefixes named in steps 3 and 4, `appImageBuildFailedErrorPrefix` and `appContainerNotHealthyErrorPrefix`, which do describe a broken artifact.

**Step 1 materializes with an empty selection, not the superset, and that is a ruling rather than an oversight.** This command exists to prove the image builds, boots and serves; the superset would drag Postgres, MinIO, Mailpit and a Stripe key into a check that today needs only Docker, and it would duplicate what the Playwright flows already prove. It stays a Docker-only structural check. The consequence is stated plainly: **`verify:container` never exercises a section**, and the flows are the superset's only proof.

It also makes the empty-selection prune the thing this command runs on every invocation, which is the strongest available check that the always-on project is still exactly what it was: the two block-mechanism gates — no marker text survives, and the result typechecks — both apply to its output.

This command is what makes the Phase 4 definition of done reproducible, and step 1 is a dry run of what `@hearthkit/create` does in Phase 6 from the same lists.

## Failure modes

One discriminated union, `AppTemplateFailure`, on `kind`. Where the app itself emits the failure, the owning package's message is passed through verbatim; where a gate or the verify command observes it, the prefix is what that tool prints.

- **`app-template-path-missing`** — a path in `appTemplateGuaranteedPaths` is absent; carries `missingPath`. Prefix `hearthkit app template path missing:`. Observed by the shape gate.
- **`app-template-repo-only-path-copied`** — a file under a repo-only directory, or `CONTRACT.md`, or `vitest.config.mts`, reached a generated project; carries `copiedPath`. Prefix `hearthkit app template repo-only path copied:`. Observed by the Phase 6 scaffold gate.
- **`app-scaffold-rewrite-missing`** — a rewrite target was skipped, for example a `workspace:*` specifier survived scaffolding; carries `rewriteTarget`. Prefix `hearthkit app template scaffold rewrite missing:`. Observed by the Phase 6 scaffold gate.
- **`app-theme-wiring-missing`** — `globals.css` lost a line of `appTemplateGlobalsCssRequiredLines`, or the layout lost the provider; carries `missingLine`. Prefix `hearthkit app theme wiring missing:`. The app still returns 200 and renders unstyled, so nothing else catches it; observed by the shape gate and by the smoke test's computed-style assertion.
- **`app-workflow-content-missing`** — `ci.yml` or `deploy.yml` lost a required literal, including either half of the webhook guard; carries `workflowPath` and `missingLine`. Prefix `hearthkit app workflow content missing:`. Observed by the shape gate.
- **`app-boot-config-invalid`** — boot rejected the environment. The message is config's own, not re-worded, so it starts with `hearthkit config invalid:` (`configInvalidErrorPrefix`). Observed by a gate calling `requireAppRuntimeConfig({ env })` and by the container run.
- **`app-image-build-failed`** — `docker build` exited nonzero; carries the exit code and a stderr excerpt. Prefix `hearthkit app image build failed:`. Observed by `verify:container`.
- **`app-container-not-healthy`** — the container started but `/health` never returned 200 within the wait; carries `waitedMs`. Prefix `hearthkit app container not healthy:`. Observed by `verify:container`.
- **`app-health-dependency-unavailable`** — `/health` returned 503 with failed or timed-out checks; carries them as observability `HealthCheckResult` values. Prefix `hearthkit app health dependency unavailable:`. Observed by the smoke test, and by Uptime Kuma from Phase 7.
- **`app-template-optional-section-copied`** — a path in an unselected package's `ownedTemplatePaths` reached a generated project; carries `copiedPath` and `owningOptionalPackageName`. Prefix `hearthkit app template optional section copied:`. Observed by the Phase 6 scaffold gate and by the empty-selection materialize gate.
- **`app-template-optional-block-copied`** — an unselected package's marked block survived in a file that was kept; carries `blockPrunedPath` and `owningOptionalPackageName`. Prefix `hearthkit app template optional block copied:`. This is the failure that produces a project importing a package it does not depend on, so it breaks the build rather than degrading quietly.
- **`app-template-optional-block-malformed`** — a block-pruned file's markers do not balance. Carries `blockPrunedPath`, `owningOptionalPackageName`, and `blockMarkerProblem`. **This is the guard on the place a sloppy rule silently produces a broken file**: without it, an unterminated begin marker deletes the rest of the file and the result still parses often enough to be missed. Prefix `hearthkit app template optional block malformed:`.

  **A message names exactly one of the four, and two of them overlap, so the precedence is part of the contract.** A package may hold several blocks in one file, so a duplicate cannot mean "a second block anywhere"; it can only mean a second begin while that same package's block is still open — which is also a begin inside an open block. The tie is broken by whose block is open:

  | Marker problem                | When                                                     |
  | ----------------------------- | -------------------------------------------------------- |
  | `begin-without-end`           | A block is still open at end of file                     |
  | `end-without-begin`           | An end marker with no block open                         |
  | `begin-inside-open-block`     | A begin for a **different** package than the one open    |
  | `duplicate-block-for-package` | A begin for the **same** package as the one already open |

- **`app-template-optional-section-path-missing`** — a path the map says an optional package owns does not exist in `templates/app`; carries `missingPath` and `owningOptionalPackageName`. Prefix `hearthkit app template optional section path missing:`. This is the mirror of `app-template-path-missing`, which is scoped to `appTemplateGuaranteedPaths` and deliberately stays that way: one variant answers "is the always-on tree complete", the other answers "does this package's declared section exist", and merging them would lose the owner name that makes the second diagnosable.
- **`app-template-optional-selection-incomplete`** — a selection names a package without one of its `requiredOptionalPackageNames`; carries both lists. Prefix `hearthkit app template optional selection incomplete:`. Observed by a gate over the map and by the Phase 6 resolver.
- **`app-template-env-block-mismatch`** — a variable is documented outside its owner's `.env.example` block, or in two blocks at once; carries `envVariableName` and `owningOptionalPackageName`. Prefix `hearthkit app template env block mismatch:`. Observed by the shape gate.
- **`app-section-route-failed`** — a section's page or route handler answered outside the 2xx range; carries `sectionRoutePath`, `owningOptionalPackageName`, `observedStatusCode`, and `owningPackageFailureMessage`, which is the owning package's own message unchanged so its prefix stays greppable. Prefix `hearthkit app section route failed:`.

Seven notes on coverage, stated rather than hidden:

- `app-boot-config-invalid` was reachable with an empty selection only through an **invalid value** such as `LOG_LEVEL=nope`. With any optional package selected the **missing-variable** path becomes reachable too, because every one of the four contributes at least one required variable. Both are the same code path in `@hearthkit/config`.
- `app-health-dependency-unavailable` was structurally unreachable with an empty registry. `@hearthkit/auth`'s `database` check is its first and only producer: point `DATABASE_URL` at a closed port and `/health` answers 503.
- `app-section-route-failed` has a **cheap producer that needs no extra service**: the email section with `EMAIL_SMTP_HOST` aimed at a port nothing is listening on. The route answers 5xx and `owningPackageFailureMessage` starts with `@hearthkit/email`'s `emailTransportUnreachableErrorPrefix`. That single gate proves sections surface a package failure rather than swallowing it, and the other three sections are taken to behave the same way by construction rather than by separate gates. Stated under-coverage, deliberately chosen over three near-duplicate gates behind three services.
- `app-template-optional-section-copied` and `app-template-optional-block-copied` are asserted **here** with an empty selection through the materializer, and again in Phase 6 against a real scaffold. The template-side gate is the one that runs on every pull request.
- `app-template-optional-block-malformed` is gated on the template's own files (their markers must balance) and on synthetic text for each of the four `blockMarkerProblem` values, which needs no filesystem. The two overlapping values need one gate each, or the precedence is unasserted and either answer passes.
- `app-template-optional-section-path-missing` is asserted by the same shape gate that walks `appTemplateGuaranteedPaths`, over the map's `ownedTemplatePaths` instead. It is the failure that fires while the sections are being written, so it is the one an implementor sees most.
- `app-image-build-failed` and `app-container-not-healthy` are **observed by running `verify:container`, not by a separate gate**. Both live in implementor-owned code, and forcing them would mean deliberately breaking a Docker build or a health endpoint on every run, which costs minutes for no signal the positive path does not already give. The gates assert the script exists at `appTemplateVerifyContainerScriptPath` and that `verify:container` invokes it; the failure behavior itself is verified by reading the two prefixes in the script's output when a real build breaks. This is stated under-coverage, deliberately chosen over fabricated coverage.
- Everything else in this list is asserted by the fast gates or by a Phase 6 gate written from the same constants.

### How this is gated

Two tiers, because the slow ones must not run per change.

- **Fast** (`pnpm --filter @hearthkit/app-template test`, Vitest, no services): the path lists; the repo-only split and the no-import-from-repo-only-directories invariant; `package.json` scripts, dependency specifiers and version pins; `next.config.ts` imported and inspected for `output` and `transpilePackages`; `tsconfig.json` keys; `globals.css` required lines; both workflows' required content; `.env.example` matching `appTemplateSupersetEnvVariableNames`; `gitignore` entries; Dockerfile text assertions covering the non-root user, the healthcheck, `ENV PORT` and `HOSTNAME`, the pinned base image, and the `public` copy; `app/health/route.ts` imported and its `GET` called directly, parsing the body with `healthReportSchema`; `requireAppRuntimeConfig` with a bad `env` throwing config's prefixed message.
- **Fast, and new with the sections:** the map parses through `appTemplateOptionalPackageSectionSchema`; `ownedTemplatePaths` and `envVariableNames` do not overlap between packages; every owned path exists on disk, reported as `app-template-optional-section-path-missing`; every `flowSpecPath` is also an owned path; `appTemplateSupersetEnvVariableNames` holds the same **set** as the always-on three plus the map's lists; every block-pruned file's markers balance; every package has at least one block in each of its `blockPrunedPaths`; `appTemplatePrunerModulePath` exports both pruners by name; every section page and route handler exports `dynamic = 'force-dynamic'`; the payments section renders both billing test ids with their two data attributes; **an absent selection returns each block-pruned file unchanged, and every explicit selection — empty, partial and all four — leaves no occurrence of either marker prefix**; materializing with an empty selection reproduces `appGeneratedProjectGuaranteedPaths` exactly; and the four `blockMarkerProblem` values against synthetic text, including the two that overlap.
- **Typecheck of the pruned result, which the fast tier cannot do.** A marker count cannot see a deletion that left a use without its import. `pnpm typecheck` on the empty-selection project is what catches it, so it belongs to the batched run (`verify:container` already installs that project) rather than to the Vitest tier.
- **Batched** (`pnpm --filter @hearthkit/app-template run verify:container`, Docker required): the seven steps above. Run once at the Verify step before committing. In CI this runs on manual trigger and on push to `main` only, never on pull requests. The accepted trade-off is that the local run is the real gate and `main` is checked after merge.
- **Flows** (`pnpm --filter @hearthkit/app-template run test:e2e`, services required): the always-on smoke plus one flow per optional package. These need MinIO, Mailpit, Postgres and a Stripe test key, so they are not part of the fast tier and must never run on the repo-root `pnpm --recursive --if-present run test`.

Known untested surface: the Dokploy webhook call in `deploy.yml` cannot be exercised until Phase 7 provisions a Dokploy instance. Build and GHCR push are testable now against a throwaway repository. **And `verify:container` never exercises a section**, by the ruling above; the container it builds is the empty-selection project.

## Dependencies

- **Packages (runtime), always:** `@hearthkit/config`, `@hearthkit/observability`, `@hearthkit/ui`, all at `workspace:*`.
- **Packages (runtime), superset only:** `@hearthkit/storage`, `@hearthkit/email`, `@hearthkit/auth`, `@hearthkit/db`, `@hearthkit/payments`, each at `workspace:*` and each pruned with its owning section. `@hearthkit/db` arrives through `@hearthkit/auth`'s entry and is never selected on its own.
- **Packages (dev), superset only:** `@hearthkit/cli`, contributed by all four optional packages, because selecting any of them means a local infrastructure service to start and makes `scripts.dev` the CLI's `hearthkit dev`. An empty-selection project depends on it not at all.
- **Third-party (runtime):** `next` 16.3.3, `react` and `react-dom` 19.
- **Third-party (dev):** `typescript` 7.0.2, `tailwindcss` and `@tailwindcss/postcss` 4.3.3, `@playwright/test` 1.62.1, `oxlint` and `oxlint-tsgolint` matching the repo, `vitest`, `zod`, the `@types/*` packages TypeScript 7 does not auto-include, and `drizzle-kit`, which only `@hearthkit/auth` contributes.
- **Services for gates:** none for the fast gates, which is the point of keeping the section checks textual. The batched run needs Docker and a Chromium download for Playwright. The flows need MinIO (`storage`), Mailpit (`email`, `auth`), Postgres (`auth`, `payments`) and Stripe test mode (`payments`) — the same services `localInfraServicesByHearthkitPackage` already maps, plus the Stripe key.
- **Contract file imports:** `src/app-template-contract.ts` imports only from `@hearthkit/config`, `@hearthkit/observability` and `@hearthkit/ui/ui-contract`, and **deliberately imports none of the four optional packages**. Their failures reach `AppTemplateFailure` as a carried message string, not as an embedded schema, so the contract file gains no dependency and stays importable from bare Node — which is what lets `verify:container` read it directly. Importing it evaluates schemas and constants and does nothing else.

## Out of scope

- **`@hearthkit/create` itself.** This contract makes `appTemplateSectionsByOptionalPackage` consumable by the scaffolder and says what a correct prune produces; it does not specify `create`'s prompts, its dependency resolution, its `pnpm install` step, or its own gates. Per the settled decision, proving the sections render **conditionally** is Phase 6's job through `create`'s three scaffold variants; Phase 5 proves the superset carries and exercises a section per package.
- **A fifth optional package.** `@hearthkit/db` is not selectable and gets no entry, because plan 4.2 makes it a package `auth` and `payments` pull in. Adding one later is additive: a name in `appTemplateOptionalPackageNames` and an entry in the map, with `DATABASE_URL` and the Drizzle paths moving from `@hearthkit/auth` to it.
- **Health checks beyond `database`.** A storage bucket ping, an SMTP reachability check and `verifyPaymentsTablesExist` are all available and none is registered. Plan 4.4 names database reachability only, and each unregistered check would put a service in the `/health` path of every request.
- **Conditional or templated file content.** No placeholder tokens anywhere. **The scaffolder rewrites JSON fields, deletes files, and deletes marked blocks; it never substitutes a value in source.** (This replaces the Phase 4 wording, "it never string-substitutes source", which was written before any file needed a marked block and which this contract would otherwise contradict. The prohibition it was guarding is unchanged and now says what it means: JSON fields may be rewritten, source may only be deleted from.) **A marked block is a deletion unit, not a template**, which is why `app/page.tsx` carries no block and links to no section: a home page that referenced a section would need content rewritten rather than removed.
- **Sections on the home page.** Each section renders at its own route. Putting them on `app/page.tsx` would mean pruning JSX inside a file every project keeps, and a mis-delimited JSX block leaves unbalanced tags — the failure the block rule exists to prevent, in the one file where it would be worst.
- **Generating `docker-compose.yml`, `.env`, or `infra/tofu.tfvars`.** `@hearthkit/create` generates those (plan 4.10), reusing `generateLocalInfraCompose` from `@hearthkit/cli`. The template ships `.env.example` only, and never a real `.env`.
- **Deployment topology.** Joining the `hearthkit-shared` Docker network, TLS, domains, and the Dokploy application itself are configured on the VPS in Phase 7. Guiding rule 1 holds: a project is a Dockerfile plus environment variables, so none of that lives in the project repo.
- **A shared logger singleton, `paths` aliases, form libraries, or app-owned shadcn components.** Not needed by the home page and all additive later. Component changes follow `docs/theming.md`: token overrides in `globals.css`, then a single copied component, never an edit inside the package.
- **Publishing.** The template is private and never published. How its files reach the published `@hearthkit/create` tarball is a Phase 6 decision; the path lists here make either approach checkable, and the `gitignore` rename already accounts for npm's ignore-file handling.
- **Deferred features (plan section 13).** Preview environments stay open because nothing in the tree encodes an environment name: the image is promoted by tag and configured by variables. Secrets manager, per-project Postgres, multi-region, passkeys, usage billing, and org billing are all invisible to the template because every setting arrives as an environment variable at run time, not at build time.

## Verified

Checked 2026-08-28 against Next.js docs at version 16.3.3.

- `output: 'standalone'` writes `.next/standalone` with a minimal `server.js`; `public` and `.next/static` are **not** copied automatically and must be copied manually; the server reads `PORT` and `HOSTNAME`; in a monorepo the tracing root defaults to the project directory — https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- `instrumentation.ts` lives at the project root, or in `src` when the app uses that layout; `register()` runs once when a server instance is initiated and must complete before requests are served; `onRequestError(error, request, context)` is stable since 15.0.0 — https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
- Route handlers use Web `Request` and `Response`, and **the default caching for `GET` handlers changed from static to dynamic in 15.0.0-RC**, so `/health` needs no `dynamic = 'force-dynamic'` — https://nextjs.org/docs/app/api-reference/file-conventions/route
- `transpilePackages` is the documented opt-in for a `node_modules` dependency that ships raw TypeScript, and a package may not appear in both `transpilePackages` and `serverExternalPackages`, since Next throws at build start — https://nextjs.org/docs/app/api-reference/config/next-config-js/transpilePackages
- **TypeScript 7 is documented as supported:** "Next.js uses the project-local `tsc` CLI by default, so no additional configuration is required", and `experimental.useTypeScriptCli` is the opt-**out**, set to `false` to use the JS compiler API. This confirms the settled decision not to set the flag. The same page: `next-env.d.ts` is regenerated by `next dev`, `next build`, or `next typegen`, its contents are an implementation detail, and it should be **added to `.gitignore`**, which is why `typecheck` runs `next typegen` first and the file is not a guaranteed path — https://nextjs.org/docs/app/api-reference/config/typescript
- The official Next Docker example uses `node:24.x-slim`, `corepack enable pnpm && pnpm install --frozen-lockfile`, `USER node`, `ENV PORT=3000`, `ENV HOSTNAME="0.0.0.0"`, and `CMD ["node", "server.js"]` — https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile
- `"type": "module"` with `output: 'standalone'` produces a CommonJS `server.js` next to an ESM manifest and fails at runtime; open since 2022 — https://github.com/vercel/next.js/issues/41258 and https://github.com/vercel/next.js/issues/62521
- npm applies a nested `.gitignore` as an ignore filter and strips it, along with `.npmrc`, from a published tarball, which is why template repositories store the file dotless and rename it at scaffold time. The always-excluded list is `*.orig`, `.*.swp`, `.DS_Store`, `._*`, `.git`, `.hg`, `.lock-wscript`, `.npmrc`, `.svn`, `.wafpickle-N`, `CVS`, `config.gypi`, `node_modules`, `npm-debug.log`, and the lockfiles; `.gitkeep` matches none of those, so `public/.gitkeep` needs no rename — https://github.com/npm/cli/wiki/Files-&-Ignores and https://docs.npmjs.com/cli/v11/configuring-npm/package-json
- The `secrets` context is **not available** in `jobs.<job_id>.if` or in step-level `if`; it is available in `jobs.<job_id>.env` and step `env`, which is why the deploy guard maps the secret into `env` and tests `env.DOKPLOY_DEPLOY_WEBHOOK_URL != ''` — https://docs.github.com/en/actions/reference/workflows-and-actions/contexts
- Playwright `webServer` takes `command`, `url`, `reuseExistingServer`, and `timeout`, and pairs with `use.baseURL`; latest `@playwright/test` is 1.62.1 — https://playwright.dev/docs/test-webserver and https://registry.npmjs.org/@playwright/test/latest
- Current versions: `next` latest is **16.3.3** with peer `react ^19.0.0`, and `tailwindcss` and `@tailwindcss/postcss` are **4.3.3** — https://registry.npmjs.org/next/latest, https://registry.npmjs.org/tailwindcss/latest, https://registry.npmjs.org/@tailwindcss/postcss/latest
- Current GitHub Actions majors for the deploy workflow: `docker/build-push-action@v7`, `docker/login-action@v4`, `docker/setup-buildx-action@v4` — https://github.com/docker/build-push-action. `actions/checkout@v7`, `actions/setup-node@v7`, and `pnpm/action-setup@v6` are already recorded in `docs/STATUS.md`.
- **Partially verified — Dokploy.** The documented CI-triggerable endpoint is `POST https://<host>/api/application.deploy` with an `x-api-key` header and an `applicationId` body. The refresh-token webhook URL is referenced but its exact format and HTTP method are not published — https://docs.dokploy.com/docs/core/auto-deploy. This is why `deploy.yml` calls a full URL held in a secret and skips when it is absent; Phase 7 confirms the format against a real instance, per plan section 14.

Verified by the orchestrator and not to be re-hedged:

- **Relative `.ts` and `.tsx` import specifiers work in a Next 16.3.3 app build** (2026-08-28). A page importing `'../app-runtime-config.ts'` and `'../components/probe-card.tsx'`, with `allowImportingTsExtensions`, `erasableSyntaxOnly`, and `verbatimModuleSyntax` set, passed `tsc --noEmit`, `next build`, and served HTTP 200 from the standalone server rendering the imported component. The repo-wide specifier rule therefore holds inside the template with no exception.
- **Prettier does not rewrite the `@source` literal** (2026-08-28). Running the repo's Prettier config over a `globals.css` containing all three required lines produced byte-identical output with the double quotes preserved. No Prettier override is needed and the exact-literal assertion is safe.
- **`vitest.config.mts`, not `.ts`** (2026-08-28). Vite's `configLoader: 'native'` warns on ESM syntax in a file loaded as CommonJS and that loader becomes the default in a future major. Since `"type": "module"` is ruled out by the standalone `server.js` constraint above, the extension is the fix, and the file is named in `appTemplateRepoOnlyPaths` accordingly. This is the gate-writer's file.

Checked 2026-09-06 for the optional package sections.

- **`export const dynamic = 'auto' | 'force-dynamic' | 'error' | 'force-static'` is still supported for a Page, a Layout and a Route Handler**, and `'force-dynamic'` forces rendering per request. It is documented on the previous-model caching page rather than in the route-segment-config table, because **`dynamic` is removed when `cacheComponents` is enabled** (Next 16.0.0). The template does not set that flag, so `appTemplateSectionDynamicMode` is valid; turning `cacheComponents` on later would delete it. Docs version 16.3.4, last updated 2026-08-25 — https://nextjs.org/docs/app/guides/caching-without-cache-components and https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config
- **Mailpit's API has `GET /api/v1/search` with a required `query` parameter**, plus `start`, `limit` and `tz`, and the search filter syntax includes `to:"…"`, `from:"…"` and `subject:"…"`, case-insensitive. `DELETE` exists on both `/api/v1/messages` and `/api/v1/search`, which is why the template's flows are forbidden from calling either — that is how they collide with `@hearthkit/email`'s gates. `GET /api/v1/messages` and `GET /api/v1/message/{ID}` are the two endpoints `@hearthkit/email`'s contract already names — https://github.com/axllent/mailpit/blob/develop/server/ui/api/v1/swagger.json and https://mailpit.axllent.org/docs/usage/search-filters/
- **A Checkout Session's `url` uses `checkout.stripe.com` by default, and a Stripe account with the paid Custom Domains feature returns its own subdomain instead.** So the host half of the payments flow's assertion is true of this repo's account and is not universally true; the durable half is that the URL carries the `stripeCheckoutSessionId` `createCheckoutSession` returned — https://docs.stripe.com/api/checkout/sessions/object and https://docs.stripe.com/payments/checkout/custom-domains

Read off the owning packages' contracts on 2026-09-06, not from plan section 4, which is stale for `storage` and `email`:

- `storageEnvSchemaFragment` (`packages/storage/src/storage-contract.ts:151`) declares five variables including `STORAGE_REGION`, which defaults to `auto`.
- `emailEnvSchemaFragment` (`packages/email/src/email-contract.ts:206`) declares eight, of which only `EMAIL_TRANSPORT` and `EMAIL_FROM` are required at the fragment level.
- `authEnvSchemaFragment` (`packages/auth/src/auth-contract.ts:294`) declares six; `DATABASE_URL` comes from `dbEnvSchemaFragment` (`packages/db/src/db-contract.ts:53`).
- `paymentsEnvSchemaFragment` (`packages/payments/src/payments-contract.ts:198`) declares two, both required.
- `createAuthServerInstance` takes an `emailTransportConfig` (`packages/auth/src/auth-contract.ts:526`), and `@hearthkit/auth` depends on `@hearthkit/email` and `@hearthkit/db` in its `package.json`. `@hearthkit/payments` depends on `@hearthkit/auth` and `@hearthkit/db`. Those four facts are what `requiredOptionalPackageNames` encodes.
- `app/api/auth/[...all]/route.ts` is the path `@hearthkit/auth`'s own contract names for the catch-all handler, and `handleStripeWebhook` takes `rawRequestBody`, which in a route handler means `await request.text()` and never `await request.json()`.
- `packages/payments/CONTRACT.md:726` specifies the webhook route's answer to a bad signature: both `signatureFailureReason` arms mean "this request did not come from Stripe" and the caller must "answer 400 and write nothing". That line is where the 400 in the webhook status table comes from, and it is why the two reasons are one failure kind with a discriminator rather than two kinds.
- Mailpit is `axllent/mailpit:v1.31`, MinIO `minio/minio:RELEASE.2025-09-07T16-13-09Z` and Postgres `postgres:17`, pinned in `localInfraServiceImageByName` in `@hearthkit/cli`; `localInfraServicesByHearthkitPackage` maps `@hearthkit/auth` to both `postgres` and `mailpit`, which is the precedent for `@hearthkit/auth` owning `DATABASE_URL` here.

Taken from `docs/STATUS.md` and not re-derived: Next 16.3.3 with `typescript@7.0.2`, `next.config.ts`, and `output: 'standalone'` builds, typechecks, and serves; `next build` rewrites `jsx` to `react-jsx` and appends `.next/dev/types/**/*.ts` to `include`; Tailwind 4.3.3 `@source` follows pnpm symlinks in both layouts Phase 4 can hit, through `@tailwindcss/postcss`; `baseUrl` is removed in TypeScript 7, failing with TS5102.

## Still not verified

Everything here is a claim this contract makes that no measurement backs yet. It is written down rather than hedged into the prose.

- **`@hearthkit/auth` and `@hearthkit/payments` have never been installed into a Next app.** Both bring `drizzle-orm@0.45.2` and `pg`, and `docs/STATUS.md` records that a peer-suffix mismatch materialises a second physical copy of `drizzle-orm` and makes one package's client structurally unassignable to the other's, with a diagnostic that points at Drizzle rather than the manifest. The template will be the first place all of `db`, `auth` and `payments` resolve together outside the workspace, and `verify:container` installs from tarballs, which is a different resolution than the workspace. `@types/pg` must be declared for the same reason it is in `packages/auth`.
- **No section route has been built, so `dynamic = 'force-dynamic'` is asserted from documentation, not from a passing `next build` with an empty environment.** The failure it prevents — a section prerendered at build time reading a required variable — is exactly the shape that is invisible until the build runs.
- **The `.env.example` block rule has never been executed.** The trailing-blank-line clause is what makes the pruned file independent of which subset was removed, and it is reasoned rather than measured. The gate that materializes with an empty selection and compares against today's file is the one that settles it, and it should be written before any block exists.
- **Whether Playwright's in-memory `setInputFiles` payload is enough for the storage flow.** The section `PUT`s bytes straight from the browser to a presigned URL, so the file must be a real `File` in the page, not a path the test runner holds. If it is not enough, the fallback is a small committed fixture under `e2e/`, which adds one owned path to `@hearthkit/storage`.
- **Whether `hearthkit dev infra up` derives the right services for a superset project.** It reads the project's **direct** dependencies only, and the superset declares all four optional packages directly, so it should. A project selecting `payments` alone would not — but `requiredOptionalPackageNames` means no such project exists.
- **Whether `scripts.dev = 'hearthkit dev'` resolves at all in a scaffolded project.** `@hearthkit/cli` reaches the project as a dev dependency and the `hearthkit` bin has to be on the script's `PATH`. That works in the workspace; it has never been run from a project installed from a published range or a tarball, which is the path `create` produces. This became load-bearing with the round-4 ruling on `dev` and is the cheapest thing here to settle — one `pnpm install` and one `pnpm dev` in a materialized directory.
- **The auth flow's migration precondition.** The template ships `drizzle.config.ts` and no generated SQL, so the flow needs `db:generate` and `hearthkit db migrate` to have run against the target database. Nothing in this contract makes that happen, and no measurement says how long it takes or whether it can live inside a Playwright global setup.
- **`app-section-route-failed`'s single producer.** The email-with-a-dead-SMTP-port gate is reasoned from `@hearthkit/email`'s contract, not run. If that route answers 200 with an error body rather than a 5xx, the failure mode needs restating rather than the gate needing a fix.
- **The webhook route's status mapping has never been driven end to end.** Every row is derived from `@hearthkit/payments`' contract rather than measured against Stripe, and the payments flow only exercises the two 200 rows — it posts a locally signed `checkout.session.completed`. The 400 row is cheap to gate offline with a wrong signing secret; the 503 and 500 rows need a broken database, and no gate is planned for them. Under-coverage stated rather than hidden: an implementation that answered 200 for `payments-request-failed` would pass every gate this template plans, and the property it destroyed would only be missed in production.

None of these can be settled at contract time, and each names the gate or the command that settles it.

## Decisions

No open questions. Rounds 1 to 3 are closed, round 4's three questions were ruled on 2026-09-06, round 5 closed nine gaps the gate-writer found the same day, and round 6 reversed one of round 5's rulings after the dispute it was flagged with was upheld.

Round 1, resolved by the orchestrator on 2026-08-28:

1. `docs/theming.md` was corrected: the TypeScript 5.x paragraph is gone, replaced with the TypeScript 7 and Next 16.3.3 position and a warning not to set `experimental.useTypeScriptCli`. The template and the document now agree.
2. The root `.gitignore` gained `test-results/`, `playwright-report/`, and `next-env.d.ts`, which the template's dotless `gitignore` cannot cover in-repo.
3. Implementor access to `templates/app` was already in place; the ownership hook additionally now blocks the implementor from `e2e/*.spec.ts` and `playwright.config.ts`, which are gate-writer files even though they ship to projects.
4. `.oxlintrc.json` stays in the template.
5. `SMOKE_TEST_BASE_URL` and `DOKPLOY_DEPLOY_WEBHOOK_URL` are accepted names.
6. Relative TypeScript-extension specifiers are settled as working; see **Verified**.
7. The Prettier and `@source` concern is disproven; see **Verified**.

Round 2, six gaps closed:

1. `test-fixtures/` would have shipped into generated projects. The single `appTemplateRepoOnlyDirectoryName` became `appTemplateRepoOnlyDirectoryNames` (`src`, `test-fixtures`), and the no-import invariant now covers both directories.
2. `public/.gitkeep` joined `appTemplateGuaranteedPaths`, so the Dockerfile's `COPY` of `public/` is unconditional and a new project has somewhere to put a favicon.
3. `appTemplateTailwindVersion` and `appTemplatePlaywrightVersion` were added, so the manifest gate no longer retypes a pin that lived only in prose.
4. `verify:container` gained an observable contract: an ordered seven-step definition, exit codes, and the two prefixes it prints. Its two failure modes are stated as observed-by-running rather than separately gated.
5. `appTemplateCiWorkflowRequiredContent` and `appTemplateDeployWorkflowRequiredContent` pin the workflow lines that matter, with a new `app-workflow-content-missing` failure mode. The webhook guard cannot evaporate silently, and its two-part `env` form is required because the `secrets` context is unavailable in `if`.
6. `vitest.config.ts` became `vitest.config.mts` in `appTemplateRepoOnlyPaths`, ahead of Vite's native config loader becoming the default.

Round 3 (2026-08-29), one change: the contract now imports its two theme constants from the new JSX-free `@hearthkit/ui/ui-contract` subpath, which makes it importable from bare `node`, so `verify:container` reads the contract directly and the hand-written mirror module is deleted. `appVerifyContainerFailedErrorPrefix` moved into this contract as the harness's own error prefix; no failure-union, path-list, or template-behavior change.

Round 4 (2026-09-06), the optional package sections. Decisions taken here that `docs/phase-5-template-sections.md` did not settle, each recorded so nobody re-derives it:

1. **The map is keyed on the scoped package name**, `@hearthkit/storage` and not `storage`, matching `appTemplateRequiredPackageNames`, `localInfraServicesByHearthkitPackage`, `transpilePackages` and the `package.json` dependency keys. One concept, one spelling.
2. **`@hearthkit/auth` owns `DATABASE_URL` and the Drizzle wiring.** `db` is not selectable (plan 4.2), and `auth` is the lowest selectable package that needs Postgres. The precedent is `localInfraServicesByHearthkitPackage` mapping `@hearthkit/auth` to `postgres`.
3. **`requiredOptionalPackageNames` was added to the map** so exclusive env-variable ownership is sound. Without it, `auth` selected without `email` loses the block holding `EMAIL_TRANSPORT` and `EMAIL_FROM`, which `createAuthServerInstance` requires, and the project fails to boot with no obvious cause.
4. **Paths and variables are exclusive; everything else is unioned.** Two rules rather than one, because pruning needs a single owner for a file and a `.env.example` block, while `@hearthkit/cli` legitimately belongs to all four.
5. **Sections render at their own route, not on the home page**, and `app/page.tsx` links to none of them. Any other arrangement needs content pruned inside a file every project keeps.
6. **`isPrunedTemplatePath` becomes `decideTemplatePathPrune` and returns a discriminated union**, because the second question the brief asks for — which package owns this path — has no room in a boolean, and an `is…` that returns a record is a lie.
7. **An absent selection means the superset; an empty selection means none.** Two different answers, never interchangeable.
8. **`appTemplateRelativePathSchema` was widened** to accept `[`, `]`, `(`, `)` and `@`, because `app/api/auth/[...all]/route.ts` does not parse under the old character class. Widening only accepts more, so nothing previously valid changed.

Three questions were raised with the orchestrator and all three are now ruled. Recorded with the reasoning, because two of them constrain what a later change may do:

1. **Marked blocks in source files, not only in `.env.example` — APPROVED, narrowed.** `app-runtime-config.ts` composes `appEnvSchemaFragments` from named imports, so whole-file pruning cannot add or remove a fragment, and both alternatives — per-route validation, or a `try`/`catch` dynamic import — break plan 4.1's "boot fails with a message naming every missing or invalid variable". The narrowing is binding: **deletion between balanced markers only, no value rewritten, no identifier substituted, no placeholder filled**, and a need that cannot be met that way returns to the orchestrator rather than widening the mechanism. The Phase 4 line it contradicted was amended in **Out of scope** rather than left standing, and the two safety properties — no marker text survives, and the result typechecks — are stated as gates under **Marked blocks**.
2. **`verify:container` materializes with an empty selection — APPROVED.** It stays a Docker-only structural check rather than acquiring Postgres, MinIO, Mailpit and a Stripe key, and the Playwright flows are the superset's only proof. The cost is stated at **The batched container verify command**: that command never exercises a section.
3. **`dev` becomes `hearthkit dev` when anything is selected — OVERRULED IN THE CONTRACT'S FAVOUR, and the reasoning that produced the worse answer is worth recording.** This contract first left `dev` as `next dev` in every selection, on the grounds that changing a script's value is a substitution forbidden by "the scaffolder rewrites JSON fields and deletes files; it never string-substitutes source". **That sentence sanctions the change it was read as forbidding**: `package.json` is JSON and `scripts.dev` is a JSON field, so the prohibition is on source and does not reach it. A real rule was applied to a case it does not cover, and the result was the worst of three options for a user. `dev` is now `next dev` for the empty selection and `hearthkit dev` otherwise, encoded through `packageScriptNames` with no new field.

Two errors found in `docs/phase-5-template-sections.md` while writing this, both confirmed by the orchestrator and fixed in that document rather than here:

- **It said `.env.example` is "the one part where a sloppy rule silently produces a broken file".** It is neither the only part nor the worst: a mis-delimited block in `app-runtime-config.ts` deletes an import and breaks the build, while `.env.example` only breaks boot with a message from `@hearthkit/config` naming the variable. That comparison now sits under **Marked blocks**, because it tells the gate-writer which file to test hardest.
- **Its per-package list omitted `DATABASE_URL` entirely** — zero occurrences — while `createAuthServerInstance` and `createPaymentsClient` both take a Drizzle client and nothing else in the template supplies one. A section built to that list would connect to nothing.

Round 5 (2026-09-06), nine gaps found by the gate-writer building 55 Vitest gates and 4 Playwright flows against round 4. This is what the gate step is for, and it earned its place again.

1. **Two rules contradicted each other and the contract was unsatisfiable.** "Everything else is returned byte for byte" and "no marker survives at any selection including the full superset" cannot both hold, because a selected package's markers sit outside every removed block. Resolved as the gate-writer read it: an **absent** selection returns the text unchanged, because that call describes the template and the template must keep its markers to stay prunable; every **explicit** selection deletes unselected blocks whole and **strips the markers of kept blocks**, leaving their contents. The asymmetry is now stated twice, in the contract file and in **Marked blocks**, because it is the thing a reader gets wrong.
2. **`duplicate-block-for-package` and `begin-inside-open-block` overlapped with no precedence.** Since a package may hold several blocks in a file, a duplicate can only be a second begin while that package's block is open — which is also a begin inside an open block. Ruled: different package open → `begin-inside-open-block`, same package open → `duplicate-block-for-package`. Written as a table, because it binds the implementor and either answer would otherwise pass.
3. **Scoped Mailpit reads are not isolation**, and the argument is the measured one from the `auth` loop: the flow's _sends_ inflate the `messages_count` `@hearthkit/email`'s gates assert, and that package's own `DELETE /api/v1/messages` wipes the flow's message before a scoped search finds it. Scoping reads governs neither direction. And the isolation cannot live in the artifact — these specs ship into projects, so they carry no Docker orchestration, and `playwright.config.ts` may not import `test-fixtures/`. So the Mailpit address became an input, `MAILPIT_API_BASE_URL`, and isolation is the Flows tier runner's job.
4. **`pruneOptionalSectionBlocks` had no declared home.** Both pruners are now required to be exported by name from `appTemplatePrunerModulePath`.
5. **Three section route handlers gained request and response shapes**, because a flow driving a route makes it contract surface. The email route's non-2xx body is what gives `app-section-route-failed` its carried message.
6. **The payments flow needed markup the contract never promised.** A delivery carries no `line_items`, so the synthesised event must carry the same three metadata keys `createCheckoutSession` writes, and the flow can only read them off the page. Without `billing-reference` and `billing-price`, the flow reaches `checkout-price-metadata-missing` — an _ignored_ result — and passes while proving nothing.
7. **No variant covered "an owned path is missing".** Added `app-template-optional-section-path-missing` rather than widening `app-template-path-missing`, so the message can name the owner and the guaranteed-paths variant keeps meaning one thing.
8. **The superset env list is compared as a sorted set**, stated in both files. The declared order groups by owner and matches no fragment's key order.
9. **Recorded, not fixed: on the superset `/health` needs Postgres**, because `auth`'s `database` check registers. `e2e/app-smoke.spec.ts` is right as written for both of its real consumers and must not be "fixed".

Round 6 (2026-09-06), one change, and it is a ruling reversed rather than a gap closed. Round 5 required `POST /api/payments/webhook` to answer **200 unconditionally**. That was implemented and flagged rather than quietly deviated from, the dispute was upheld, and the status now follows the result kind — the table under **Section route handler request and response shapes**.

- **Why the reversal was right:** `@hearthkit/payments` chose `payments-request-failed` so that a completed checkout it cannot record "does not vanish quietly — Stripe's bounded retry then gives an operator a signal". That mechanism exists only if the route answers non-2xx. A constant 200 deletes it, which is the outcome the variant was created to prevent.
- **Two things the dispute got wrong, both worth keeping.** First, it proposed non-2xx only for the retryable pair and 200 for everything else, which would have left a bad signature answering 200; `packages/payments/CONTRACT.md:726` already specifies 400 there. Second, it justified that 200 by fearing perpetual retries — **Stripe does not retry a 4xx.** So the correct mapping is smaller than the dispute proposed and has a source for every row.
- **The half nobody disputed is the half most likely to be broken later:** `payments-webhook-ignored` must answer 200. It is a result, not a failure, and Stripe delivers every subscribed type. A route that answered 4xx for it would fail on ordinary traffic until Stripe disabled the endpoint.
