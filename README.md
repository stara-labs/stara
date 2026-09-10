# Stara

Stara is being built as a place for humans and persistent agents to work together.

This repository is the application monorepo. The initial implementation is tracked
in [the web reference-consumer milestone](https://github.com/stara-labs/stara/issues/1).
This metadata-only seed contains no application implementation.

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
