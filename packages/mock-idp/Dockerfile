# Mock Entra IdP for the local compose `stack` profile (docker-compose.yml). LOCAL DEVELOPMENT ONLY: it is not built by the
# release workflow, never pushed and never deployed; it signs in synthetic people without a password.
# Build from the repository root:
#   docker build -f packages/mock-idp/Dockerfile -t kr-mock-idp .
# Base: node:24-alpine pinned by digest (the same as the service images; bump deliberately).

FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS fetch
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    npm_config_store_dir=/pnpm/store
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable && corepack install && pnpm fetch

FROM fetch AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline \
    && pnpm --filter "@kr/mock-idp..." build \
    && pnpm --filter @kr/mock-idp deploy --prod /out

FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS runtime
LABEL org.opencontainers.image.title="kr-mock-idp" \
      org.opencontainers.image.description="Mock Microsoft Entra ID for the local compose stack (synthetic users, never deployed)" \
      org.opencontainers.image.vendor="KR Surveys"
# Apply Alpine security fixes published after the base image was built (the release scan fails on fixable highs).
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-*
ENV NODE_ENV=production \
    MOCK_IDP_HOST=0.0.0.0 \
    MOCK_IDP_PORT=4010
WORKDIR /app
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
USER node
EXPOSE 4010
CMD ["node", "dist/cli.js"]
