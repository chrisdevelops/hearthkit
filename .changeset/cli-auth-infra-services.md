---
'@hearthkit/cli': minor
---

`hearthkit dev infra up` now starts Postgres and Mailpit for a project that depends on `@hearthkit/auth`. It previously started **nothing** for such a project and reported success with an empty service list, so auth failed at runtime with a connection error that pointed nowhere near the manifest.

The cause was a gap between two things that were each individually reasonable. The package-to-service map had no `@hearthkit/auth` entry, and `readInfraServicesFromDependencies` reads a project's **direct** `dependencies` and `devDependencies` only — it never walks transitive ones. So `@hearthkit/auth` depending on `@hearthkit/db` and `@hearthkit/email` internally did not help: neither name appeared in the project's own manifest.

**Breaking:** `localInfraServiceByHearthkitPackage` is renamed to `localInfraServicesByHearthkitPackage` and its values become lists, because `@hearthkit/auth` needs two services where every other package needs one:

```ts
export const localInfraServicesByHearthkitPackage = {
  '@hearthkit/db': ['postgres'],
  '@hearthkit/storage': ['minio'],
  '@hearthkit/email': ['mailpit'],
  '@hearthkit/auth': ['postgres', 'mailpit'],
} as const satisfies Record<string, readonly LocalInfraServiceName[]>
```

Both changes land in one edit per call site: nothing compiles through `'postgres'` becoming `['postgres']`, so a consumer updating the shape updates the identifier on the same line. The rename was taken deliberately rather than kept singular — a public name saying _one service per package_ when it means several is a permanent inaccuracy, and the doc comment that would have compensated for it is weaker than a name that does not need compensating.

Two properties are unchanged and now stated in the contract: the derived set collapses duplicates, so a project listing both `@hearthkit/auth` and `@hearthkit/db` gets `postgres` once; and emission order comes from `localInfraServiceNameSchema.options`, never from the map's key order or the manifest's. Both consumers re-normalize independently, which makes those guarantees impossible to violate observably — so the redundant normalization is intentional and must not be simplified away on the grounds that the derivation already guarantees it.

Three gates added, 39 to 42. One drives `dev infra up` end to end from a manifest listing only `@hearthkit/auth` and asserts both containers start; the other two need no containers.

This mapping is deliberately robust to what Phase 6's `create` does. If `create` writes `@hearthkit/db` and `@hearthkit/email` into a project that selects `auth`, the `auth` entry is redundant and harmless because duplicates collapse. If it does not, auth still works. `docs/PLAN.md` section 6's table has no `auth` row and needs one.
