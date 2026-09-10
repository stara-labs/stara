# Scaffold Architecture

Status: Authorized Evaluation; Human Acceptance Pending
Scope: Issue #1, Initial Application Scaffold
Decision owner: Stara Product Owner and Responsible Engineering Owner
Last reviewed: 2026-09-09

## Decision

Use a private-package pnpm monorepo. `UI/web` composes the application;
`UI/shared` owns used primitives and generated design-token CSS; `backend/api`
owns the HTTP service. `tooling` owns repository controls. Cross-project browser
tests live in `tests/e2e`. Only repository-wide configuration belongs at root.

Web may depend on shared UI through `workspace:*`. Shared UI cannot depend on
web features, and neither UI package may import backend implementation. Add a
shared domain package only when an actual cross-project contract requires one.
The health response is currently verified at the HTTP boundary, not distributed
as a speculative shared model package.

## Proposed Controlled Defaults

The exact versions are authoritative in the root/workspace manifests, runtime
pin, lockfile, Dockerfiles, and workflow action digests. The approved evaluation
uses Node, pnpm, TypeScript, React, Vite, CSS Modules, Fastify, Style Dictionary,
Vitest/V8, Testing Library, Playwright, axe, ESLint, Prettier, simple-git-hooks,
Conventional Commits, and GitHub Actions. These are proposed shared defaults;
this implementation does not declare central acceptance by itself.

pnpm was selected for explicit workspace boundaries and native dependent
filtering. Vite supplies a small build/development layer without introducing a
server-rendered application contract. Fastify supplies validated HTTP responses,
structured logging, and a testable server lifecycle. CSS Modules keep local
composition styles scoped; generated semantic/component tokens remain shared.
Style Dictionary resolves upstream token aliases and emits reproducible CSS.
No custom dependency graph, HTTP framework, or test runner is introduced.

Maintainers must review upgrades, package install scripts, vulnerabilities,
license compatibility, browser support, and container base changes. Exact pins
are reproducibility inputs, not proof that a dependency is safe indefinitely.
The dependency audit blocks high/critical known vulnerabilities; unresolved
material findings require corrective work and responsible-human review.

A scoped `typed-rest-client>qs` override in the workspace configuration resolves
three denial-of-service advisories in Stryker's development-only dependency
chain. Retain the override until the upstream client adopts the patched range,
then remove it through a reviewed lockfile update and renewed mutation evidence.

Semantic-release is the proposed eventual version/release tool, not installed
publication machinery. Deployment, release authorization, and artifact promotion
are separate future work. Packages remain private to prevent publication.

## License Decision

On 2026-09-10, the responsible Engineering owner selected the
[Apache License, Version 2.0](../LICENSE.md) for the Stara application repository.
The root and all workspace package manifests declare `Apache-2.0`. Third-party
licenses and notices remain applicable; this decision does not relicense the
external private Product System. Licensing does not authorize a release or
deployment, establish Product System conformance, or open external PR intake.

## Product System Boundary

The six-field [consumer record](product-system.json) pins external authority.
Ordinary installation, builds, and CI never clone or authenticate to that private
repository. Only generated token CSS and its integrity/provenance record are
included. The maintainer token-update command requires an explicitly supplied
checkout at the recorded immutable revision.

Checksum validation detects local artifact drift; it does not establish upstream
correctness. A changed pin or generated token output requires independent
regeneration against the authorized private checkout and Product Owner review.
Keep `validated: false` until the required independent acceptance is recorded.

## State and Boundaries

Shell data is synthetic and in-session only. A tab represents an open context,
not an execution, grant, or persistent agent. Closing a tab does not stop work.
No fixture claims authentication, persistence, external effects, or live agent
execution. The API health route proves only that this HTTP service is serving.
It is not dependency readiness or product health and is not shown as a product
feature.

Container startup isolates the Compose project by checkout, binds published
ports to loopback, checks readiness, and preserves unrelated projects and data.
The dev proxy and local build-preview proxy send `/api` to the API service.
Vite preview is only a local artifact-verification server, not production hosting.

## Adoption and Migration

This is a first scaffold, not a migration of the parked prototype. Private source
snapshots, stale execution evidence, and unfinished release controls were not
transplanted. Existing consumers do not inherit these proposals automatically.
After independent Engineering and Product acceptance, record the selected
immutable application revision centrally and describe consumer migration there.
Issue #1 remains open until the complete golden-path acceptance contract is met.
