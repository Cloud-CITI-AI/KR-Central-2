# KR Subdivision Tracker worker image (ADR-0008). Build from the repository root:
#   docker build -f services/worker/Dockerfile --build-arg RELEASE_VERSION=<tag> -t kr-worker .
# Base: node:24-alpine pinned by digest (multi-arch index digest of 24.21.0 on Alpine 3.24; bump deliberately).
# --- fetch: every dependency in the lockfile into the pnpm store (cached until the lockfile changes) ---------------
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS fetch
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack install && pnpm fetch

# --- build: install offline from the store, compile the worker and the workspace packages it uses, prune to prod -------
FROM fetch AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline \
    && pnpm --filter "@kr/worker..." build \
    && pnpm --filter @kr/worker deploy --prod /out

# --- runtime: production dependencies and compiled code only; no pnpm/npm/yarn/corepack, no dev tools ---------------
# @napi-rs/canvas (pdf page rendering for stamp reading) resolves its prebuilt linux-musl binary at install time.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
ARG RELEASE_VERSION=dev
# The release workflow passes the repository URL (github.server_url/github.repository), so forks and renames label correctly.
ARG IMAGE_SOURCE=
LABEL org.opencontainers.image.title="kr-worker" \
      org.opencontainers.image.description="KR Subdivision Tracker background worker (malware scanning, document parsing, housekeeping)" \
      org.opencontainers.image.vendor="KR Surveys" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.version="${RELEASE_VERSION}"
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production \
    HOST=:: \
    PORT=8081 \
    RELEASE_VERSION=${RELEASE_VERSION}
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# Non-root. PID 1 is node itself and the worker spawns no long-lived children, so no init reaper (tini) is needed; the
# image needs no package repository at build time. Signal handling arrives with WP-12 (SIGTERM: stop claiming, finish
# in-flight work within 25 s): the current WP-12 skeleton installs no SIGTERM handler, and node as PID 1 ignores SIGTERM
# without one, so until WP-12 lands Railway stops this container with SIGKILL after its grace period.
USER node
EXPOSE 8081
CMD ["node", "dist/main.js"]
