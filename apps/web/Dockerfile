# KR Subdivision Tracker web image: Next.js standalone server plus the same-origin API proxy (ADR-0005, ADR-0008).
# Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg RELEASE_VERSION=<tag> -t kr-web .
# Base: node:24-alpine pinned by digest (multi-arch index digest of 24.21.0 on Alpine 3.24; bump deliberately).

# --- fetch: every dependency in the lockfile into the pnpm store (cached until the lockfile changes) ---------------
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS fetch
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack install && pnpm fetch

# --- build: install offline from the store, build the workspace packages the web uses, then `next build` ------------
FROM fetch AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm install --frozen-lockfile --offline \
    && pnpm --filter "@kr/web..." build

# --- runtime: the traced standalone server only; no pnpm/npm/yarn/corepack, no dev tools, no sources ------------------
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
ARG RELEASE_VERSION=dev
LABEL org.opencontainers.image.title="kr-web" \
      org.opencontainers.image.description="KR Subdivision Tracker web front end (Next.js standalone) and API proxy" \
      org.opencontainers.image.vendor="KR Surveys" \
      org.opencontainers.image.source="https://github.com/cloudcitiwa/kr-central-2" \
      org.opencontainers.image.version="${RELEASE_VERSION}"
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
# HOSTNAME=:: binds IPv6 and IPv4 (dual-stack) so Railway's private network (IPv6) and its health check both reach it.
# Railway injects PORT; 3000 is the local default.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=:: \
    PORT=3000 \
    RELEASE_VERSION=${RELEASE_VERSION}
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Non-root. PID 1 is node itself: Next's server handles SIGTERM/SIGINT and the image spawns no other processes, so no
# init reaper (tini) is needed; the image needs no package repository at build time.
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
