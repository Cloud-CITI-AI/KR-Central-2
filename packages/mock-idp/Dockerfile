# Mock Entra IdP for the local compose `stack` profile (docker-compose.yml). LOCAL DEVELOPMENT ONLY: it is not built by the
# release workflow, never pushed and never deployed; it signs in synthetic people without a password.
# Build from the repository root:
#   docker build -f packages/mock-idp/Dockerfile -t kr-mock-idp .
# Base: node:24-alpine pinned by digest (the same as the service images; bump deliberately).

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS fetch
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

FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS runtime
LABEL org.opencontainers.image.title="kr-mock-idp" \
      org.opencontainers.image.description="Mock Microsoft Entra ID for the local compose stack (synthetic users, never deployed)" \
      org.opencontainers.image.vendor="KR Surveys"
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
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
