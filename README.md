# Stara

Stara is being built as a place for humans and persistent agents to work together.

This repository is the application monorepo. The initial implementation is tracked
in [the web reference-consumer milestone](https://github.com/stara-labs/stara/issues/1).
This first scaffold contains a synthetic-data application shell and a minimal
HTTP API. Authentication, databases, persistent agents, business workflows,
deployment, and release publication are not implemented.

## Start

Install the exact Node version in `.node-version`, pnpm `11.19.0`, Git, and Docker
Desktop with its Linux engine running. Then, from this repository:

```sh
pnpm start
```

Startup installs the frozen workspace, installs compatible hooks safely, builds
isolated Compose services, and prints endpoints only after readiness. Defaults
are [web](http://127.0.0.1:5173) and
[API health](http://127.0.0.1:3000/api/health). The web origin also forwards `/api`.
The health response establishes service availability, not product health.

Repeated startup preserves local state and unrelated Compose projects. Use
`STARA_WEB_PORT` and `STARA_API_PORT` for explicitly chosen alternate ports.
See [setup](docs/setup.md) for prerequisites, commands, failure handling, and
external token maintenance.

## Repository Boundaries

- `UI/web`: web application composition.
- `UI/shared`: shared UI primitives and generated application styles.
- `backend/api`: backend service.
- `tooling`: shared development and verification tools.
- `tests/e2e`: cross-project verification.
- `docs`: application documentation and evidence.
- `.github`: repository-wide workflow and ownership configuration.

Only repository-wide files belong at the root. Project-specific source, tests,
build configuration, and Dockerfiles belong inside their owning projects.

## Status

The scaffold, execution evidence, and Product acceptance are not complete.
No package publication or deployment is configured.

External pull requests are not currently accepted while the security policy,
code of conduct, and public contribution policy are being completed. Issues and
feedback may still be reviewed. This contribution-intake policy does not limit
the rights granted by the license.

## License

Stara's original source code and documentation in this repository are licensed
under the [Apache License, Version 2.0](LICENSE.md), unless otherwise noted.
Workspace packages remain marked `private` to prevent package publication;
that setting does not restrict the Apache-2.0 license grant.

Third-party components retain their own licenses and attribution notices,
including the Inter font under SIL Open Font License 1.1. The application license
does not relicense the external private Product System or grant rights to Stara
trademarks beyond those provided by the license.

## Contracts

- [Requirements and scenarios](docs/requirements/scaffold.md)
- [Architecture and proposed defaults](docs/architecture.md)
- [Verification, CI, and acceptance](docs/verification.md)
- [Initial evaluation and limitations](docs/evidence/scaffold-evaluation.md)
- [Contribution workflow](CONTRIBUTING.md)
- [Agent instructions](AGENTS.md)
- [Product System consumer record](docs/product-system.json)

The public build consumes generated styles only. The private Product System
checkout is not an install, build, or ordinary CI dependency. `validated: false`
is intentional until evidence-backed independent acceptance is complete.
