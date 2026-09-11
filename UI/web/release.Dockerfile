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
COPY UI/web/tsconfig.json UI/web/vite.config.ts UI/web/index.html UI/web/
COPY UI/shared/tsconfig.json UI/shared/tsconfig.json
COPY UI/web/src/ UI/web/src/
COPY UI/shared/src/ UI/shared/src/
RUN pnpm --filter @stara/web build

FROM nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce AS runtime
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/stara-labs/stara"
COPY --from=build /workspace/UI/web/dist/ /usr/share/nginx/html/
COPY UI/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY LICENSE.md /usr/share/nginx/html/licenses/Stara-Apache-2.0.txt
USER 101
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
