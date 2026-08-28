---
'@hearthkit/ui': minor
---

Guarantee `buttonVariants` as a public export, so the documented shadowed-component workflow can rely on it, and add `hearthkitThemeCssImportSpecifier` — the exact specifier an app's `globals.css` must import — so the scaffolder, template, and docs stop hardcoding the string. The package now also ships the shadcn CLI configuration (`components.json` and a `@/*` path alias) that `shadcn add` needs to write components into `src/components/ui/`.
