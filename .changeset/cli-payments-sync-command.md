---
'@hearthkit/cli': patch
---

`hearthkit payments sync [--catalog <path>]` pushes a project's `payments-catalog.ts` to Stripe test mode through `syncPaymentsCatalog` from `@hearthkit/payments`, and prints one `hearthkit payments sync complete:` line with created, replaced and unchanged counts. New failure kinds: `cli-payments-catalog-not-found`, `cli-payments-catalog-unloadable`, and `cli-payments-sync-failed` wrapping the payments failure verbatim. `@hearthkit/payments` is now a runtime dependency.
