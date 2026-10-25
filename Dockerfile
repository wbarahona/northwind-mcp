# syntax=docker/dockerfile:1
#
# One build for every image in the stack: api, seed and agent (the chat agent + its page).
#
#   docker build --target api  -t northwind/api  .
#   docker build --target seed -t northwind/seed .
#   docker build --target agent -t northwind/agent .
#
# The build stage compiles the whole workspace once; each target then gets its app from
# `pnpm deploy --prod`: the app's dist plus production dependencies only, with workspace
# packages (@northwind/db, ...) copied in. No secrets: settings come from the environment.

# Another registry when Docker Hub rate-limits: --build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:24-alpine
ARG NODE_IMAGE=node:24-alpine

# ---------------------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    TURBO_TELEMETRY_DISABLED=1 \
    CI=1
ENV PATH="${PNPM_HOME}:${PATH}"
WORKDIR /repo

# pnpm at the version pinned in package.json ("packageManager").
COPY package.json ./
RUN corepack enable && corepack install

# Dependencies, from the lockfile alone: this layer is reused until pnpm-lock.yaml changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch --store-dir /pnpm/store

COPY . .
RUN pnpm install --offline --frozen-lockfile --store-dir /pnpm/store \
 && pnpm turbo run build --filter=@northwind/api --filter=@northwind/seed --filter=@northwind/agent --filter=@northwind/web \
 && pnpm --filter @northwind/api deploy --prod --store-dir /pnpm/store /out/api \
 && pnpm --filter @northwind/seed deploy --prod --store-dir /pnpm/store /out/seed \
 && pnpm --filter @northwind/agent deploy --prod --store-dir /pnpm/store /out/agent \
 && cp -r apps/web/dist /out/agent/web

# ---------------------------------------------------------------------------- runtime base
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER node

# ---------------------------------------------------------------------------- api
FROM runtime AS api
COPY --from=build --chown=node:node /out/api ./
# Inside a container the API must listen on the container's interface; publishing the port
# (Compose: 127.0.0.1 only) decides who can reach it.
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]

# ---------------------------------------------------------------------------- seed
# Resets the database it points at. --yes: the target is the stack's own Mongo, which the
# CLI can't recognise as local by its host name.
FROM runtime AS seed
COPY --from=build --chown=node:node /out/seed ./
CMD ["node", "--enable-source-maps", "dist/cli.js", "--yes"]

# ---------------------------------------------------------------------------- agent
# The chat agent with the built page in ./web. It starts the Northwind MCP server (bundled
# as a dependency) read-only, over stdio, and talks to the API and the model over HTTP.
FROM runtime AS agent
COPY --from=build --chown=node:node /out/agent ./
ENV HOST=0.0.0.0 \
    PORT=5173 \
    WEB_DIR=/app/web
EXPOSE 5173
CMD ["node", "--enable-source-maps", "dist/index.js"]
