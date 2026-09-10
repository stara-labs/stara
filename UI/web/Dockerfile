FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS development
WORKDIR /workspace
RUN npm install --global pnpm@11.19.0
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node UI/web/package.json UI/web/package.json
COPY --chown=node:node UI/shared/package.json UI/shared/package.json
COPY --chown=node:node backend/api/package.json backend/api/package.json
COPY --chown=node:node tooling/package.json tooling/package.json
RUN pnpm install --frozen-lockfile && chown -R node:node /workspace
USER node
COPY --chown=node:node . .
EXPOSE 5173
CMD ["pnpm", "--filter", "@stara/web", "dev", "--host", "0.0.0.0"]

FROM development AS build
RUN pnpm --filter @stara/web build
