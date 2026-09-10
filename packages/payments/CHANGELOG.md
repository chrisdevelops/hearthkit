# @hearthkit/payments

## 0.2.0

### Patch Changes

- @hearthkit/auth@0.2.0
  - @hearthkit/config@0.2.0
  - @hearthkit/db@0.2.0

## 0.1.2

### Patch Changes

- 87ed532: Every package is licensed under MIT: a `LICENSE` file ships in each tarball and the manifest carries `"license": "MIT"`.
- Updated dependencies [87ed532]
  - @hearthkit/auth@0.1.2
  - @hearthkit/config@0.1.2
  - @hearthkit/db@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [49983c4]
  - @hearthkit/config@0.1.1
  - @hearthkit/auth@0.1.1
  - @hearthkit/db@0.1.1

## 0.1.0

### Minor Changes

- 6b88e0f: New package: Stripe subscriptions and one-time purchases, hosted Checkout, the hosted customer portal, a webhook handler, a product catalog defined in the app's code, and Drizzle tables for customers, subscriptions and purchases. Billing scope follows `@hearthkit/auth`'s `organizations` scaffold flag. Every public function returns its failures as values; nothing throws for a failure mode it names.

  Eight functions — `createPaymentsClient`, `syncPaymentsCatalog`, `createCheckoutSession`, `createCustomerPortalSession`, `handleStripeWebhook`, `readPaymentsSubscription`, `listPaymentsPurchases`, `verifyPaymentsTablesExist` — plus `paymentsEnvSchemaFragment`, `hearthkitPaymentsDrizzleSchema` and `hearthkitPaymentsTableNames`. Nine failure variants, each with a unique literal message prefix.

  **This package does not use `@better-auth/stripe`, and the reason is stronger than the one the plan anticipated.** Plan 4.8 asked whether the plugin covers one-time purchases, expecting to add them with the SDK if not. It does not — its dist contains exactly one checkout mode literal, `mode: "subscription"`, and zero occurrences of `mode: "payment"`. But the decisive fact is different: the plugin's `getSchema` spreads a `user` model carrying `stripeCustomerId` in **both** branches of its only conditional, so that column is added whatever options it is given. `hearthkitAuthDrizzleSchema` has no such column, Drizzle table objects cannot be extended from another package, and the Better Auth Drizzle adapter throws `The field "<field>" does not exist in the schema for the model "<model>"` when it is absent. Adopting the plugin would therefore mean editing `@hearthkit/auth` — a package whose contract forbids Stripe knowledge — plus a migration for anything already deployed. The plugin also has no catalog sync of any kind, so `syncPaymentsCatalog` was always going to be ours.

  Vocabulary is not invented where the plugin already has a word: `billingScope`'s values `'user' | 'organization'` are its `customerType` enum, and `CONTRACT.md` carries a column mapping table so a later move to the plugin is a rename with a known target rather than an excavation.

  **The webhook handler never contacts the network, and keeping that property shaped the design.** `Checkout.Session.line_items` is an _includable_ property — present only when expanded on a retrieve, never in a delivery — so resolving a purchase from line items is impossible. `@better-auth/stripe` solves this with `subscriptions.retrieve()`, the only network call in any of its four handlers. This package instead has `createCheckoutSession` stamp `hearthkit_price_name`, `hearthkit_stripe_price_id` and `hearthkit_quantity` into the session's metadata, so every purchase column comes from the delivery itself. The result is that both signature failures, all six ignore reasons, all three webhook outcomes and the replay are gateable with no Stripe key at all.

  That price metadata goes on the session and **never** on `subscription_data.metadata`: a portal upgrade changes a subscription's price without touching metadata stamped at creation, so a stamped price name would go stale and then be reported as fact. The subscription path reads `items.data[].price.lookup_key` live, which cannot. It is offline by construction rather than by luck, because `SubscriptionItem.price` is typed `Price`, not `string | Price`.

  Idempotency is structural rather than a bookkeeping table: every write is an upsert on a unique Stripe id, so a replayed delivery writes the same values to the same row and the row count does not move.

  **45 gates, 37 of which need no Stripe key.** The 8 that do are tagged to skip without one, and `ci.yml` now passes `STRIPE_SECRET_KEY` through from repo secrets so they run on the runner instead of skipping — a skipped gate is not a passing gate. `STRIPE_WEBHOOK_SECRET` is deliberately not wired into CI: signatures are verified by local HMAC, so the gates choose that value themselves and Stripe never issues one.

  Notes for anyone extending this. `error.type` is the SDK's class name; Stripe's own type string is at `error.rawType`, and switching on the wrong one matches nothing and routes every case to the catch-all silently. `Subscription` has no `current_period_start`/`current_period_end` at `stripe@22.6.1` — both live on the subscription item. Four different signature failures share the opening words `No signatures found`, so a substring test on that phrase proves less than it appears to. `'ended'` and `'all'` are members of `SubscriptionListParams.Status`, one union away from the real status enum, and are not statuses. `@types/pg` is declared to pin a peer resolution, not for type convenience: without it pnpm materialises a second physical `drizzle-orm` and `@hearthkit/db`'s client stops being assignable, with a diagnostic that points at Drizzle rather than at the manifest.

  Usage-based billing stays open, as plan section 13 requires: no signature here has to change to add metering.

### Patch Changes

- 8fa8810: `@hearthkit/config` is now a runtime `dependency` of `observability`, `storage`, `email`, `auth` and `payments`. Each imported it from `src/` but declared it only under `devDependencies`, which resolved through workspace hoisting and would fail on the first published install.

  Node is pinned to exactly `24.20.0` in `.nvmrc` and every `engines` field, matching the plan. CI reads the version from `.nvmrc`. The template ships its own `.nvmrc` and the same pin, and `appTemplateNodeVersion` carries the value in the template contract.

  Every `@hearthkit/*` package now versions as one fixed group, so a release bumps all of them together.

  Lint is now warning-free. Two small behaviour changes came with removing unsafe casts: `asEnvVariableName` in `config` throws on a key that is not SCREAMING_SNAKE_CASE, and `createHealthRouteHandler` in `observability` throws at boot when a caller bypasses the types with a health check whose name the contract rejects, instead of running it unvalidated.

- 1bc044f: Release tooling for the first publish (completion plan step 4.1). Every manifest gains `repository` and `homepage` pointing at the public repo, and a `prepublishOnly` guard that stops a publish when the package is private, still at 0.0.0, missing `src/index.ts`, or has an `exports` or `bin` target that does not exist or is outside `files`. The guard accepts the one JavaScript module `@hearthkit/config` ships. No runtime behaviour changes.
- Updated dependencies [c0ecb6d]
- Updated dependencies [08c9000]
- Updated dependencies [f44ed69]
- Updated dependencies [08c9000]
- Updated dependencies [886785b]
- Updated dependencies [8fa8810]
- Updated dependencies [1bc044f]
  - @hearthkit/auth@0.1.0
  - @hearthkit/config@0.1.0
  - @hearthkit/db@0.1.0
