---
'@hearthkit/db': patch
'@hearthkit/email': patch
---

`@types/pg` and `@types/nodemailer` move from `devDependencies` to `dependencies`. Both packages ship TypeScript source, so a project's `tsc` and `next build` compile that source and need the type packages present in the project's own tree; the first scaffolded project's typecheck failed with `TS7016` on `pg` and `nodemailer` until they were installed by hand.
