---
'@hearthkit/app-template': patch
---

The pruning logic moves to `@hearthkit/create`; the template keeps `app-template-contract.ts` as the section manifest only. The manifest gains `organizations-flag-literal` (the one declared value substitution in source, flipping `appOrganizationsEnabled` to `true`) and `appTemplateNeverCopiedFileNames` for build output that may sit beside the template. The structural tests that the three scaffold variants now cover are deleted, leaving 18 template gates. `materialize-app-template-project.ts` is a thin call into `create` with an empty selection.
