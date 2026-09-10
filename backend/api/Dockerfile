FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS development
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace
RUN npm install --global pnpm@11.19.0
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@stara/api", "dev"]

FROM development AS build
RUN pnpm --filter @stara/api build

FROM build AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
CMD ["node", "backend/api/dist/index.js"]
