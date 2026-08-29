# A project is a Dockerfile plus environment variables. Nothing here is platform-specific: the image
# is promoted between environments by tag and configured entirely at run time.
#
# Two stages. The builder installs dependencies and runs `next build` with an empty environment, so
# no configuration value can be baked into the image. The runner carries only the standalone server
# Next emits, its static assets, and public/.
#
# The builder copies the whole project before installing, which is what makes any dependency
# specifier work — a registry range, a tarball, a workspace tarball produced by verify:container.
# The cost is that a source change re-runs the install; split the install into its own stage if your
# project grows large enough for that to matter.

FROM node:24.20.0-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV NEXT_TELEMETRY_DISABLED=1

RUN corepack enable pnpm

WORKDIR /app
COPY . ./
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM node:24.20.0-slim AS runner

WORKDIR /app

# Set after the build on purpose: these are run-time defaults, not build inputs. PORT and HOSTNAME
# are read by Next's standalone server itself and are never validated by @hearthkit/config.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next copies neither public/ nor .next/static into .next/standalone, so both are copied by hand.
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static

# The official node images already ship an unprivileged `node` user, so nothing is created here.
USER node

EXPOSE 3000

# The image's own Node runtime does the probing: a slim image has neither curl nor wget, and adding
# one to run a healthcheck is a dependency the app does not otherwise need.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}/health`).then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "server.js"]
