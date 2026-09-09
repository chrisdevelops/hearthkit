---
'@hearthkit/auth': patch
'@hearthkit/cli': patch
'@hearthkit/config': patch
'@hearthkit/create': patch
'@hearthkit/db': patch
'@hearthkit/email': patch
'@hearthkit/observability': patch
'@hearthkit/payments': patch
'@hearthkit/storage': patch
'@hearthkit/ui': patch
---

Release tooling for the first publish (completion plan step 4.1). Every manifest gains `repository` and `homepage` pointing at the public repo, and a `prepublishOnly` guard that stops a publish when the package is private, still at 0.0.0, missing `src/index.ts`, or has an `exports` or `bin` target that does not exist or is outside `files`. The guard accepts the one JavaScript module `@hearthkit/config` ships. No runtime behaviour changes.
