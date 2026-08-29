---
'@hearthkit/ui': patch
---

Publish a third package subpath, `@hearthkit/ui/ui-contract`, mapping to `src/ui-contract.ts`. Purely additive: the `.` entry still exports everything it did, and it now also re-exports the two new constants that name the subpath, `hearthkitUiPackageExportSubpaths` and `hearthkitUiContractImportSpecifier`.

The `.` entry re-exports `.tsx` component modules, and bare Node refuses that extension outright, so until now no `node`-executed script could import anything that imported this package — however little of it that script actually wanted. `src/ui-contract.ts` imports only `zod` and contains no JSX, so the new subpath loads from plain `node`. That is what lets the app template's `verify:container` read its own contract instead of hand-mirroring its values.

Two gates protect the property, because neither covers the whole of it: one spawns a real `node` process and imports the subpath, catching JSX and `.tsx` imports; the other reads the contract file's own import specifiers and holds them to `['zod']`, catching everything that would load fine under bare Node while still breaking the rule.
