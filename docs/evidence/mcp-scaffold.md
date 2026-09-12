# MCP scaffold verification

Date: 2026-09-11. Conclusion: Ready for human review.

## Candidate and scope

Local working changes on `work/mcp-scaffold`, based on
`ca3b12db3e9aa2f94f84e505a6bbd7a4f5fbb777`, verified on Windows with Node
`24.16.0` and pnpm `11.19.0`. MCP SDK `1.30.0` and Zod `4.6.2` are exact
dependencies. Scope is a local stdio adapter for the two existing public API
endpoints, package scripts, tests, lockfile, and documentation.

The ignored `.artifacts/mcp/source-manifest.json` records SHA-256 hashes of the
three MCP source files, three new test files, API manifest, and lockfile. Its
SHA-256 is `4959c3092fe4caea100d686d1307edc68773de3c16fb04439e8681bf3f0f41e1`.
This identifies local candidate bytes, not a committed revision or hosted run.

## Executed evidence

- Passed: `pnpm --filter @stara/api test:coverage`, 132 tests. Complete API
  coverage is 123/124 lines (99.19%) and 67/69 branches (97.10%), with no source
  exclusions. This includes 27 new MCP unit tests and four MCP integration tests.
- Passed: root `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check`,
  `pnpm tokens:check`, and `pnpm security:secrets`.
- Passed: `pnpm security:dependencies`; the registry audit reported no known
  vulnerabilities.
- Passed: root `pnpm test:coverage`, 2,273 tests across API (132), shared UI (3),
  tooling (2,081), and web (57). Every package met its existing coverage floors.
  Line/branch percentages were API 99.19/97.10, shared UI 100/87.50, tooling
  96.66/93.47, and web 96.44/94.86. The full run included the corrected fixture.
- Passed: independent agent review found no actionable findings. The reviewer
  independently ran the 25 configuration/protocol tests and four integration
  tests. A separate real stdio probe closed stdin during a stalled HTTP request;
  the server returned a sanitized timeout result and exited naturally after
  5.8 seconds, including TypeScript startup.

The integration suite builds the API package before launching its compiled MCP
entrypoint. It verifies discovery and calls against a real loopback Fastify
server, unavailable API behavior, redirect rejection, and EOF/configuration
failure exits. No unrelated existing service is used as test evidence.

## Failures and corrections

The first test run failed because MCP modules did not yet exist. After initial
implementation, five error-path tests failed because omitted tool arguments
were rejected before reaching the API. Adding an empty default preserved strict
argument rejection and allowed omitted arguments. The SDK advertises its generic
empty-object schema for this wrapper; tests verify rejection behavior directly.
The initial red sources were not hashed, so red-stage provenance is limited.

The initial `pnpm exec vitest` invocation could not resolve the executable in
this environment. The owning package test script worked; independent review
used the installed Vitest Node entrypoint. Dependency installation used the
documented `pnpm install --no-frozen-lockfile` after `pnpm add` rejected that flag.

The first formatting check could not scan the existing `.artifacts/private`
directory under the sandbox. The same check passed with approved execution
outside the sandbox. Secret scanning initially flagged a literal fake Basic
Auth credential in an integration fixture. It was replaced with a query marker
on a rejected remote origin; the sanitized startup-error assertions remain.

## Limits

No hosted CI, Linux, Docker/container journey, browser E2E/accessibility journey,
release, or deployment was executed for this scaffold. Agent review is separate
from responsible-human Engineering and Product acceptance. UI behavior and
protected verification controls were not changed.
