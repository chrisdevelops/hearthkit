---
'@hearthkit/auth': minor
---

Trim the public surface of `@hearthkit/auth` to a fixed allowlist (completion plan step 5). The `.` entry now exports exactly 35 values, down from 113: the twelve functions, `hearthkitAuthDrizzleSchema`, the env fragment, the failure union, `authRuntimeConfigSchema`, the ten result schemas, `authApiBasePath`, `hearthkitAuthTableNames`, and the seven branded schemas an app constructs. The `./auth-contract` subpath now resolves to `src/auth-contract-entry.ts` and carries the 22 contract values plus every public type, down from 100. Error prefixes, Better Auth literals, HTTP statuses, limits, options schemas, per-variant failure schemas and per-arm success schemas are no longer exported; a consumer that imported one must narrow the result union on `kind` instead. Type exports are unchanged. `CONTRACT.md` is rewritten from 1043 lines to 193.
