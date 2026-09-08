---
'@hearthkit/observability': patch
'@hearthkit/storage': patch
'@hearthkit/email': patch
'@hearthkit/auth': patch
'@hearthkit/payments': patch
'@hearthkit/config': patch
'@hearthkit/db': patch
'@hearthkit/ui': patch
'@hearthkit/cli': patch
---

`@hearthkit/config` is now a runtime `dependency` of `observability`, `storage`, `email`, `auth` and `payments`. Each imported it from `src/` but declared it only under `devDependencies`, which resolved through workspace hoisting and would fail on the first published install.

Node is pinned to exactly `24.20.0` in `.nvmrc` and every `engines` field, matching the plan. CI reads the version from `.nvmrc`. The template ships its own `.nvmrc` and the same pin, and `appTemplateNodeVersion` carries the value in the template contract.

Every `@hearthkit/*` package now versions as one fixed group, so a release bumps all of them together.

Lint is now warning-free. Two small behaviour changes came with removing unsafe casts: `asEnvVariableName` in `config` throws on a key that is not SCREAMING_SNAKE_CASE, and `createHealthRouteHandler` in `observability` throws at boot when a caller bypasses the types with a health check whose name the contract rejects, instead of running it unvalidated.
