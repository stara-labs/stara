# Stara API

Private, health-only Fastify service. `GET /api/health` returns HTTP 200 and exactly
`{"status":"ok"}`. This reports that the handler can answer a request. It does not
assert dependency health, readiness, authentication, data integrity, or any wider
application state. Other routes and methods return 404.

## Commands

Run from this package with the workspace's installed dependencies and Node
`24.16.0`. The package supplies its own TypeScript and Vitest configuration.

| Script             | Result                                                     |
| ------------------ | ---------------------------------------------------------- |
| `dev`              | `tsx watch src/index.ts`                                   |
| `build`            | Compile `src/` to `dist/` with source maps                 |
| `start`            | Run compiled `dist/index.js`                               |
| `typecheck`        | Check source, tests, and Vitest configuration              |
| `test:unit`        | Configuration, HTTP injection, lifecycle, entrypoint tests |
| `test:integration` | Real loopback HTTP, port conflicts, compiled processes     |
| `test:coverage`    | Both suites with complete `src/**/*.ts` V8 coverage        |

The root integrator owns workspace aggregation, dependency locking, and Docker
wiring. The package does not require external Product System files at runtime or
build time.

The coverage command writes to repository-root `.artifacts/coverage/api/`, including
`coverage-summary.json`. For a write-restricted package worktree, pass
`--coverage.reportsDirectory=.artifacts/coverage/api` to retain reports in this
package instead. This changes only the destination, not coverage selection or gates.

## Configuration And Lifecycle

`HOST` defaults to `127.0.0.1` and accepts an IP address or DNS hostname. Containers
must set `HOST=0.0.0.0`. `PORT` defaults to `3000` and accepts decimal integers
1 through 65535, without whitespace, signs, or leading zeroes. Empty values are
invalid. Variables are read from the process environment; no dotenv file is loaded.
Invalid configuration or a failed bind logs `startup_failed` and exits nonzero.
Configuration values and raw exception details are omitted from failure logs.

`config.ts` validates configuration, `server.ts` constructs an unbound server,
`main.ts` owns listening and shutdown, and `index.ts` is the executable entrypoint.
The startup orchestrator accepts a server and process adapter for isolated tests.

Fastify emits structured JSON logs. Request logging retains the method and a
server-generated request ID, and excludes URLs, query values, bodies, and request
headers. Redaction also covers authorization/cookie fields and response cookies;
error serialization omits raw messages and stacks. Error responses use generic
messages and do not reflect submitted paths or parser details. Additional routes
or custom log fields require their own review of sensitive content.

SIGINT or SIGTERM initiates one idempotent shutdown. Fastify rejects new work while
a `preClose` hook waits for accepted responses to finish or their clients to
disconnect. After that drain, `forceCloseConnections: true` clears remaining
connections on every binding, including both localhost address families. The
five-second deadline covers the drain and Fastify close hooks. A rejected close
or elapsed deadline sets exit code 1 before cancelling the deadline and terminating
the process. Successful shutdown removes signal listeners and allows natural exit.

## Verification Scope

Unit tests use synthetic inputs and simulated process boundaries. Integration
tests use real loopback sockets and freshly compiled Node child processes. Their
shared `sendSignal` helper relays signal events through IPC on Windows, where
`child.kill()` forcibly terminates Node. On Linux, it disconnects IPC first so the
channel cannot hold the child open, then sends native SIGINT or SIGTERM through
`child.kill(signal)`. Windows results do not establish native Linux or container
behavior; those require a recorded Linux run against the integrated source. A
deliberately stalled close hook also checks the real five-second watchdog and
failure exit.

Coverage includes all four production source files, including the entrypoint,
with no exclusions. The enforced package floors are 90% lines and 85% branches.
Subprocess execution supplements behavior evidence; the V8 source report is
collected in Vitest workers. Generated reports, dependencies, and `dist/` remain
ignored. This package's results do not establish repository-wide coverage,
independent review, hosted CI, container acceptance, or Product System conformance.

## Local Evidence

### Initial Scaffold (2026-09-09, Historical)

The initial scaffold was verified in `work/scaffold-api`, based on seed commit
`bbacc3d12ab123a4c778c0a16b65eb79e31b8ed0`, with Node `24.16.0`, TypeScript `6.0.3`,
Fastify `5.12.3`, Vitest/V8 `5.0.0`, and tsx `4.23.13`. Dependencies were installed
inside this package; the integrator must verify the merged workspace lockfile.

Tests were written before production behavior. The expected-red coverage run
used a route-free Fastify instance, throwing configuration/startup stubs, and an
empty entrypoint: 63 tests failed and 4 passed. The health assertion failed with
404 instead of 200. Its ignored local report is `.artifacts/red-tests.json`.

That run passed: `typecheck`, `build`, `test:unit` (67 tests),
`test:integration` (7 tests), and `test:coverage` (74 tests). Coverage was 64/64
lines and 36/36 branches across every source file, with zero exclusions. The real
stalled-close process exited nonzero after approximately five seconds. The
integrator's ESLint configuration and Prettier formatting check also passed.
Ignored evidence is retained in package-local `.artifacts/green-tests.json` and
`.artifacts/coverage/api/` using the output-directory override. The root destination
is configured for the integrator's aggregate run, not populated by this worker.

### Shutdown Correction (2026-09-10)

Independent review subsequently found that Fastify's secondary localhost listener
could retain an incomplete request after `shutdown_complete` was logged and the
deadline cancelled. The original 74-test result did not cover that case. Eight
new regressions exercised both actual listeners: the unchanged implementation
failed five and passed three; the corrected response drain passed all eight.

The corrected Windows suite passed all 82 tests, with complete-source coverage
of 80/80 lines and 41/42 branches and no exclusions. Build, typecheck, lint, and
formatting also passed. Independent original and simultaneous dual-listener probes
verified timeout exit 1, no premature success, rejection of new work during drain,
and successful completion of accepted responses before exit 0. Targeted review
found no remaining issues in that correction or its test-only native-signal
follow-up; this does not negate the original finding or establish broader acceptance.
The native-signal helper retained all assertions and all 82 Windows passes. Native
Linux/container evidence must be recorded separately after integration.

Authored files are `package.json`, `tsconfig.json`, `tsconfig.build.json`,
`vitest.config.ts`, this README, `src/config.ts`, `src/server.ts`, `src/main.ts`,
`src/index.ts`, `tests/helpers.ts`, `tests/fixtures/process.mjs`,
`tests/fixtures/localhost-process.mjs`,
`tests/unit/config.test.ts`, `tests/unit/server.test.ts`,
`tests/unit/main.test.ts`, `tests/unit/index.test.ts`,
`tests/integration/network.test.ts`, `tests/integration/process.test.ts`, and
`tests/integration/localhost-shutdown.test.ts`.
