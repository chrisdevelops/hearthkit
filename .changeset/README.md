# Changesets

This folder is managed by Changesets. Every PR that changes a `@hearthkit/*` package adds a
changeset file here describing the version bump and the reason for it.

- Add one with `pnpm exec changeset`.
- CI blocks merge when package files changed and no changeset is present.
- Releases happen from main via the release workflow, which versions and publishes to npm.

Docs: https://github.com/changesets/changesets
