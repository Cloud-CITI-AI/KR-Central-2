# KR Subdivision Tracker ops image (ADR-0007, ADR-0008): one image, two Railway services.
#   migrate  start command `node dist/migrate-main.js` (the default CMD): pg_dump, migrate, then /healthz 200
#   backup   start command `node dist/backup-main.js`, Railway cron: nightly dump + incremental object copy
# There is no pnpm/npm in the image, so Railway's start command is the `node` line, not `pnpm start:*`.
# Build from the repository root:
#   docker build -f services/ops/Dockerfile --build-arg RELEASE_VERSION=<tag> -t kr-ops .
# Base: node:24-alpine pinned by digest (multi-arch index digest of 24.21.0 on Alpine 3.24; bump deliberately).

# --- pgclient: pg_dump 17 and its shared libraries, taken from the official image of the same major as the database ----
# Copied instead of `apk add postgresql17-client` so the build needs no package repository and the client is the exact,
# digest-pinned build the tests run (postgres:17-alpine, Alpine 3.24). Bump this digest together with the base's.
FROM postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24 AS pgclient
SHELL ["/bin/ash", "-o", "pipefail", "-c"]
RUN mkdir -p /pgclient/bin /pgclient/lib \
    && cp /usr/local/bin/pg_dump /pgclient/bin/pg_dump \
    && ldd /usr/local/bin/pg_dump | awk '$3 ~ /^\// && $1 !~ /musl/ { print $3 }' \
       | while read -r lib; do cp -L "$lib" "/pgclient/lib/$(basename "$lib")"; done

# --- fetch: every dependency in the lockfile into the pnpm store (cached until the lockfile changes) ---------------
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS fetch
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack install && pnpm fetch

# --- build: install offline from the store, compile ops and the workspace packages it uses, prune to prod ----------
FROM fetch AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline \
    && pnpm --filter "@kr/ops..." build \
    && pnpm --filter @kr/ops deploy --prod /out

# --- runtime: production dependencies, compiled code and pg_dump only; no pnpm/npm/yarn/corepack, no dev tools -------
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime
ARG RELEASE_VERSION=dev
# The release workflow passes the repository URL (github.server_url/github.repository), so forks and renames label correctly.
ARG IMAGE_SOURCE=
LABEL org.opencontainers.image.title="kr-ops" \
      org.opencontainers.image.description="KR Subdivision Tracker ops jobs: migrate (with pre-migration dump) and nightly backup" \
      org.opencontainers.image.vendor="KR Surveys" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.version="${RELEASE_VERSION}"
# pg_dump keeps its own libraries in /opt/pgclient/lib (loaded through the wrapper only), so they cannot shadow the
# system's libssl/libz for anything else in the image. The jobs start pg_dump with an empty PATH, hence the absolute path.
COPY --from=pgclient /pgclient/ /opt/pgclient/
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* \
    && printf '#!/bin/sh\nLD_LIBRARY_PATH=/opt/pgclient/lib exec /opt/pgclient/bin/pg_dump "$@"\n' > /usr/bin/pg_dump \
    && chmod 0755 /usr/bin/pg_dump \
    && /usr/bin/pg_dump --version
ENV NODE_ENV=production \
    HOST=:: \
    PORT=8082 \
    PG_DUMP_PATH=/usr/bin/pg_dump \
    RELEASE_VERSION=${RELEASE_VERSION}
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# Non-root. PID 1 is node itself: it handles SIGTERM/SIGINT and the only child process is pg_dump, which it waits for.
USER node
EXPOSE 8082
CMD ["node", "dist/migrate-main.js"]
