---
'@hearthkit/config': patch
'@hearthkit/cli': patch
---

Node 24 refuses to strip types from `.ts` files under `node_modules`, so an installed `hearthkit` bin was unrunnable in a generated project. `@hearthkit/config` now ships one JavaScript module, exported as `@hearthkit/config/register-node-modules-type-stripping`, that registers a module load hook stripping types for exactly that set; it is a no-op inside the workspace where packages resolve to real paths. The `hearthkit` bin is now a small JavaScript entry that imports the hook and then the TypeScript bin. The `create` bin and the template's Playwright `test:e2e` script preload the same module. It lives in `config` rather than `cli` because every project depends on `config`, while an empty package selection prunes `cli`.
