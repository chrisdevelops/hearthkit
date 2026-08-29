# hearthkit app

A Next.js App Router project wired to the hearthkit packages: validated configuration, a themed
component library, structured logging, error reporting, and a `/health` endpoint.

## Getting started

```bash
pnpm install
pnpm dev
```

The app serves <http://localhost:3000> and `/health`. Nothing else has to be running: every
environment variable is optional, so the app boots with no `.env` file at all.

## Scripts

| Script           | What it does                                                     |
| ---------------- | ---------------------------------------------------------------- |
| `pnpm dev`       | Development server with fast refresh                             |
| `pnpm build`     | Production build, including the standalone server the image runs |
| `pnpm start`     | Serves the production build                                      |
| `pnpm lint`      | oxlint with type-aware rules                                     |
| `pnpm typecheck` | Regenerates Next's types, then `tsc --noEmit`                    |
| `pnpm test:e2e`  | Playwright smoke test; builds and starts the app first           |

Point the smoke test at a server that is already running instead of starting one:

```bash
SMOKE_TEST_BASE_URL=http://127.0.0.1:8080 pnpm test:e2e
```

## Where things live

| Path                    | What it is                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| `app/`                  | Routes, layouts, and `globals.css`                                  |
| `app/health/route.ts`   | The `/health` endpoint the container and uptime monitors poll       |
| `app-runtime-config.ts` | The environment schema fragments this app validates at boot         |
| `app-health-checks.ts`  | The dependency checks `/health` runs                                |
| `instrumentation.ts`    | Boot: config, error reporting, logging; plus server error reporting |
| `e2e/`                  | Playwright specs                                                    |
| `docs/theming.md`       | How to change the look of the app                                   |

## Configuration

Every variable is documented in `.env.example`. Copy it to `.env` and uncomment what you need. An
invalid value fails the boot with a message that names the variable, rather than starting a server
that misbehaves later.

Nothing is read at build time, which is why one image can be promoted from staging to production by
tag with only its environment changed.

## Theming

The look comes from `@hearthkit/ui`. Change design tokens in `app/globals.css`, not inside the
package. See `docs/theming.md`.

## Deployment

`Dockerfile` builds a self-contained image on Node 24 that runs as a non-root user and healthchecks
itself against `/health`. `.github/workflows/deploy.yml` builds it on every push to `main`, pushes
it to GitHub Container Registry, and calls the Dokploy deploy webhook when the
`DOKPLOY_DEPLOY_WEBHOOK_URL` repository secret is set.

```bash
docker build -t my-app .
docker run --rm -p 3000:3000 my-app
```
