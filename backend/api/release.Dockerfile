FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS build
WORKDIR /workspace
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY UI/web/package.json UI/web/package.json
COPY UI/shared/package.json UI/shared/package.json
COPY backend/api/package.json backend/api/package.json
COPY tooling/package.json tooling/package.json
RUN pnpm install --frozen-lockfile
COPY tooling/config/tsconfig.base.json tooling/config/tsconfig.base.json
COPY backend/api/tsconfig.json backend/api/tsconfig.build.json backend/api/
COPY backend/api/src/ backend/api/src/
RUN pnpm --filter @stara/api build

FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS production-dependencies
WORKDIR /workspace
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY backend/api/package.json backend/api/package.json
RUN pnpm --filter @stara/api install --prod --frozen-lockfile --ignore-scripts

FROM node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a AS runtime
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/stara-labs/stara"
RUN apk add --no-cache libcrypto3=3.5.8-r0 libssl3=3.5.8-r0
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
COPY --from=production-dependencies /workspace/node_modules/ node_modules/
COPY --from=production-dependencies /workspace/backend/api/node_modules/ backend/api/node_modules/
COPY --from=build /workspace/backend/api/dist/ backend/api/dist/
COPY backend/api/package.json backend/api/package.json
COPY LICENSE.md LICENSE.md
USER node
EXPOSE 8080
CMD ["node", "backend/api/dist/index.js"]
