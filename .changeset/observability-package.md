---
'@hearthkit/observability': minor
---

New package: GlitchTip error reporting (Sentry-compatible, no-op without a DSN), pino structured logging to stdout, and a Next.js `/health` route handler with app-wired named checks. Nothing in the package can crash an app; the only throwing path is a boot-time duplicate health check name.
