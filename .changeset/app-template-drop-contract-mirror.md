---
'@hearthkit/app-template': patch
---

Delete `src/verify-app-container-contract-mirror.ts` and read the contract directly. The module re-declared 13 contract values across 118 lines because `src/app-template-contract.ts` imported `@hearthkit/ui`, whose entry resolves through `.tsx` and which bare Node refuses — so `verify:container`, run by plain `node`, could not import its own contract. The contract now takes its two theme constants from the new `@hearthkit/ui/ui-contract` subpath, and `verify-app-container.ts` and `materialize-app-template-project.ts` import the real exports.

This removes a duplication that was one-directional by construction: the mirror's drift check asserted each mirrored literal still appeared somewhere in the contract's source text, so it caught a reworded prefix but never a value **added** to a contract list, and never noticed a value that had moved to a different constant. Every Phase 5 package added to `appTemplateRequiredPackageNames` would have needed a manual mirror update.

`appVerifyContainerFailedErrorPrefix` moves into the contract, where the template's other error prefixes already live. It is deliberately not a variant of `AppTemplateFailure`: it reports the verification harness failing, not the template artifact. A new gate imports the contract from a spawned bare-`node` process, so a future package that drags a `.tsx` module into the contract's import graph fails a fast gate instead of a Docker build.
