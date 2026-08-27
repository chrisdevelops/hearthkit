# hearthkit

Opinionated stack for shipping many small TypeScript web projects: shared `@hearthkit/*`
packages, a `hearthkit` CLI, a scaffolder, and self-hosted infrastructure.

- Plan: [`docs/PLAN.md`](docs/PLAN.md)
- Current position: [`docs/STATUS.md`](docs/STATUS.md)

## Development

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm lint
pnpm typecheck
```

Packages are built one at a time, contract first, gates second, implementation last. See
`CLAUDE.md` for the build loop and ownership rules.
