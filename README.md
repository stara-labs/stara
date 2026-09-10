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
Public visibility does not imply an open-source license; licensing is pending a
separate decision. No package publication or deployment is configured.

This repository is currently source-visible, not yet open source. External pull
requests are not accepted until Stara publishes a license, security policy, code
of conduct, and public contribution policy. Issues and feedback may still be
reviewed, but visibility grants no right to use, modify, or redistribute the code.

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
