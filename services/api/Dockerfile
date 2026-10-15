# KR Subdivision Tracker API image (ADR-0008). Build from the repository root:
#   docker build -f services/api/Dockerfile --build-arg RELEASE_VERSION=<tag> -t kr-api .
# Base: node:24-alpine pinned by digest (multi-arch index digest of 24.21.0 on Alpine 3.24; bump deliberately).
# --- fetch: every dependency in the lockfile into the pnpm store (cached until the lockfile changes) ---------------
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS fetch
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack install && pnpm fetch

# --- build: install offline from the store, compile the api and the workspace packages it uses, prune to prod -------
FROM fetch AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline \
    && pnpm --filter "@kr/api..." build \
    && pnpm --filter @kr/api deploy --prod /out

# --- runtime: production dependencies and compiled code only; no pnpm/npm/yarn/corepack, no dev tools ---------------
FROM node:24-alpine@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS runtime
ARG RELEASE_VERSION=dev
# The release workflow passes the repository URL (github.server_url/github.repository), so forks and renames label correctly.
ARG IMAGE_SOURCE=
LABEL org.opencontainers.image.title="kr-api" \
      org.opencontainers.image.description="KR Subdivision Tracker API (Fastify)" \
      org.opencontainers.image.vendor="KR Surveys" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.version="${RELEASE_VERSION}"
# Apply Alpine security fixes published after the base image was built (the release scan fails on fixable highs).
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production \
    HOST=:: \
    PORT=8080 \
    RELEASE_VERSION=${RELEASE_VERSION}
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
# Non-root. PID 1 is node itself: the service handles SIGTERM/SIGINT (graceful shutdown) and spawns no long-lived
# children, so no init reaper (tini) is needed.
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
