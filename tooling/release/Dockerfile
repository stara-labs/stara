FROM node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203 AS dependencies
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY tooling/package.json ./tooling/package.json
RUN pnpm --filter @stara/tooling install --prod --frozen-lockfile --ignore-scripts

FROM golang:1.26.8-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81 AS gh
ENV GOTOOLCHAIN=local GOSUMDB=sum.golang.org GOPROXY=https://proxy.golang.org GOFLAGS=-mod=readonly CGO_ENABLED=0 GOMAXPROCS=2
ADD --checksum=sha256:e16749bc0d99dc0633a3d5ebadf48ffff1c24beb1ce83e8f6a71bb64ce477e9a https://codeload.github.com/cli/cli/tar.gz/45437bc7eeeb3359bbfddd1742f79de7652fd3e2 /tmp/gh.tar.gz
WORKDIR /src
RUN tar -xzf /tmp/gh.tar.gz --strip-components=1 -C /src
COPY tooling/release/gh-x-mod.sum /tmp/gh-x-mod.sum
RUN go mod edit -require=golang.org/x/mod@v0.40.0 \
    && cat /tmp/gh-x-mod.sum >> go.sum \
    && go mod download \
    && go mod verify \
    && test "$(go list -m -f '{{.Version}}' golang.org/x/mod)" = "v0.40.0"
RUN useradd --uid 10001 --create-home builder \
    && mkdir -p /opt/gh \
    && chown -R builder:builder /src /opt/gh /go/pkg
ENV HOME=/home/builder
USER builder
RUN --network=none go test ./...
RUN go test golang.org/x/mod/sumdb/...
RUN --network=none mkdir -p /opt/gh/bin /opt/gh/provenance \
    && go build -trimpath -buildvcs=false -ldflags "-s -w -X github.com/cli/cli/v2/internal/build.Version=2.100.0-stara.1 -X github.com/cli/cli/v2/internal/build.Date=2026-09-03" -o /opt/gh/bin/gh ./cmd/gh \
    && cp LICENSE /opt/gh/LICENSE \
    && cp go.mod go.sum /opt/gh/provenance/ \
    && go version -m /opt/gh/bin/gh > /opt/gh/provenance/modules.txt \
    && /opt/gh/bin/gh --version > /opt/gh/provenance/version.txt
COPY tooling/release/gh-build.json /opt/gh/provenance/source.json
RUN cd /opt/gh && sha256sum bin/gh LICENSE provenance/go.mod provenance/go.sum provenance/modules.txt provenance/version.txt provenance/source.json > SHA256SUMS

FROM scratch AS gh-artifact
COPY --from=gh /opt/gh/ /

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
COPY --from=gh /opt/gh/provenance /usr/share/stara/gh/provenance
COPY package.json LICENSE.md ./
COPY tooling/package.json ./tooling/package.json
COPY tooling/lib ./tooling/lib
COPY tooling/release ./tooling/release
USER node
ENTRYPOINT ["node", "tooling/release/cli.mjs"]
CMD ["execute"]
