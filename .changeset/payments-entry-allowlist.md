---
'@hearthkit/payments': minor
---

Trim the public entry point of `@hearthkit/payments` to a fixed 27-name allowlist (completion plan step 5). The `.` entry now exports the nine plan-named outputs, the env fragment, the failure union, the catalog schema, the eight result schemas, the table names, the synced-price schema and the five Stripe wire constants. The `./payments-contract` subpath resolves to `src/payments-contract-entry.ts` carrying the eighteen contract values and every public type. Error prefixes, Stripe literals and statuses, limits, branded and record schemas, options schemas, per-variant failure schemas and the reason enums are internal; the eleven per-arm success schemas are module-private. `CONTRACT.md` is rewritten from 1304 lines to 197.
