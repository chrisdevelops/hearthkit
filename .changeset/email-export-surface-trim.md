---
'@hearthkit/email': minor
---

Trim the public entry point to a fifteen-name allowlist: the three functions, the two shipped templates, the env fragment, the failure union, the transport config schema, the three result schemas, and the four branded schemas an app or `@hearthkit/auth` constructs (`emailLinkUrlSchema`, `emailProductNameSchema`, `emailTemplateNameSchema`, `emailSubjectSchema`). Every other constant and schema is internal now and is no longer importable from `@hearthkit/email`. The `./email-contract` subpath stays and resolves to a new `email-contract-entry.ts` that exports the same ten contract schemas plus every public type; the three per-arm success schemas are module-private and reachable only through the result unions.
