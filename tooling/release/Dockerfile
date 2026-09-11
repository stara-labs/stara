FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY tooling/package.json ./tooling/package.json
RUN pnpm --filter @stara/tooling install --prod --frozen-lockfile --ignore-scripts

FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS gh
ADD --checksum=sha256:e4d4bb4498e8d007abe545b6568926793ace1b6447da598294a610018cb164be https://github.com/cli/cli/releases/download/v2.100.0/gh_2.100.0_linux_amd64.tar.gz /tmp/gh.tar.gz
RUN mkdir /opt/gh && tar -xzf /tmp/gh.tar.gz --strip-components=1 -C /opt/gh

FROM node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a AS runtime
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/stara-labs/stara"
RUN apk add --no-cache libcrypto3=3.5.8-r0 libssl3=3.5.8-r0
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
ENV NODE_ENV=production
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/tooling/node_modules ./tooling/node_modules
COPY --from=gh /opt/gh/bin/gh /usr/local/bin/gh
COPY --from=gh /opt/gh/LICENSE /usr/share/licenses/gh/LICENSE
COPY package.json LICENSE.md ./
COPY tooling/package.json ./tooling/package.json
COPY tooling/lib ./tooling/lib
COPY tooling/release ./tooling/release
USER node
ENTRYPOINT ["node", "tooling/release/cli.mjs"]
CMD ["execute"]
