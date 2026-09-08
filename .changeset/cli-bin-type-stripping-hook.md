---
'@hearthkit/cli': patch
---

The `hearthkit` bin is now a small JavaScript entry that registers a module load hook stripping TypeScript types from `.ts` files under `node_modules`, then imports the TypeScript bin. Node 24 refuses to strip types for files under `node_modules`, so an installed `hearthkit` was unrunnable in a generated project; the hook is a no-op inside the workspace where packages resolve to real paths. The hook is exported as `@hearthkit/cli/register-node-modules-type-stripping` for other entry points (the `create` bin and the template's Playwright workers). This is the one `.js` file a package ships.
