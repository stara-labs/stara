# Local Setup

## Prerequisites

Use Git, Node exactly as pinned in `.node-version`, pnpm exactly as declared by
`packageManager`, and a working Docker Linux engine with Compose. Container CLI
installation alone is insufficient: `docker info` must succeed. No database,
cloud account, private Product System access, or application secret is required.

`pnpm start` is the first application command. It verifies runtime pins, performs
a frozen workspace install, installs compatible Git hooks, and starts this
checkout's Compose project with bounded readiness. It reports web/API URLs only
on success. Ports bind to loopback; defaults are 5173 and 3000. Explicit
`STARA_WEB_PORT` and `STARA_API_PORT` values must be valid, distinct available
ports. The API's internal `HOST` and `PORT` contract is described in
[the API guide](../backend/api/README.md).

## Commands

Source commits also require the pinned local CodeQL bundle. See the
[CodeQL setup guide](../tooling/codeql/README.md) for installation, the Windows
PowerShell prerequisite, and the staged-snapshot security check. Application
startup itself does not run CodeQL.

| Command                                                   | Purpose                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm bootstrap`                                          | Frozen install and safe hook installation                    |
| `pnpm start`                                              | Bootstrap and start isolated Docker Compose services         |
| `pnpm dev`                                                | Development environment orchestration                        |
| `pnpm environment:logs`                                   | Bounded logs for this checkout's services                    |
| `pnpm environment:down`                                   | Stop this checkout's services without deleting volumes       |
| `pnpm format` / `pnpm format:check`                       | Apply/check repository formatting                            |
| `pnpm lint` / `pnpm typecheck`                            | Static source and package-boundary checks                    |
| `pnpm test:unit`                                          | All package unit and contract tests                          |
| `pnpm test:integration`                                   | Web composition, API, and real Git/process integration       |
| `pnpm test:coverage`                                      | Complete eligible-target tests and coverage floors           |
| `pnpm test:mutation`                                      | Targeted Stryker evaluation of consequential gate policies   |
| `pnpm browsers:install`                                   | Install Playwright's pinned browser builds                   |
| `pnpm test:e2e` / `pnpm test:a11y`                        | Functional/accessibility journeys against built output       |
| `pnpm build`                                              | Build web/API and identify artifacts and inputs              |
| `pnpm validate`                                           | Full local static, coverage, build, and browser verification |
| `pnpm security:secrets`                                   | Scan source for secrets                                      |
| `pnpm security:dependencies`                              | Audit lockfile dependencies; high/critical findings block    |
| `pnpm tokens:check`                                       | Verify generated CSS integrity and declared revision         |
| `pnpm check:commit` / `pnpm check:push` / `pnpm check:pr` | Gate-specific isolated/affected verification                 |

Run `pnpm build` before direct browser commands. Their default servers exercise
the built web and API outputs; Playwright starts and closes those test servers.
For container verification, set `STARA_EXTERNAL_SERVERS=1` and
`STARA_E2E_BASE_URL` to the verified web endpoint. That selects the existing
container journey; it is not evidence for an unrelated static build.
On Linux, Playwright may additionally need `pnpm exec playwright install --with-deps`.

The web package contains its own Vite configuration. Shared UI is consumed as
workspace source by that build, not published independently. Development
containers are not production deployment images or a persistent data platform.

## Safe Failure and Recovery

Unavailable Docker, invalid configuration, occupied ports, failing readiness,
missing history, and failed commands must produce a nonzero result and actionable
diagnostic. Do not prune Docker, delete volumes, reset Git, or reuse another
checkout's service to manufacture a pass. Resolve the prerequisite or choose
explicit alternate ports, then repeat the command. A failed check remains failed
in evidence even when a subsequent attempt succeeds.

Bootstrap does not silently overwrite a custom hook or hooks path. A maintainer
must reconcile custom hooks before claiming installed gates. Test the exact
staged tree before committing; an unstaged local correction is not staged
evidence. Never bypass hooks to call an incomplete scaffold accepted.

Workspace `frozenLockfile: true` also prevents pnpm's automatic dependency check
from rewriting an out-of-date lockfile before a command reaches bootstrap.
Dependency changes require an intentional `pnpm install --no-frozen-lockfile`
and review of the resulting manifest and lockfile together.

Commit gates materialize the index in an owned temporary directory. Push hooks
pass Git's outgoing records to `pnpm check:push --hook`; each distinct outgoing
commit is materialized and checked independently, including commits other than
the checked-out HEAD. Manual `pnpm check:push` checks HEAD only. Neither uses
unstaged files or the working checkout's installed dependencies as candidate
evidence. The snapshot uses a fresh frozen install and an isolated store; it
cannot repair dependencies automatically. Required results and built artifacts
are retained with the commit/tree identities before temporary cleanup.

Branch updates and lightweight tags pointing directly to commits are supported.
Deletion-only updates, annotated tag objects, malformed records, and unavailable
outgoing objects are rejected before checks run. Those unsupported operations
need a separately reviewed workflow; do not bypass the hook. A mixed push with
an unsupported update is rejected as a whole.

## External Token Maintenance

Only an authorized maintainer with the external private checkout runs:

```sh
pnpm tokens:update --source /absolute/path/to/stara-product-system
pnpm tokens:check
```

The source checkout must be clean and at the exact revision in
`docs/product-system.json`. The generator reads the committed token blob and
uses Style Dictionary; it never copies the private source tree into this repo.
Review generated CSS, provenance, and consumer pin together. An independent
actor regenerates from the same authorized source, then the Product Owner reviews
the proposed change. Ordinary checksums do not replace that upstream check.

## Evidence Locations

Build identity and local coverage/selection artifacts are under ignored
`.artifacts/`. Browser traces, screenshots, and reports are ignored as well.
CI retains candidate-linked diagnostics for 30 days. Record concise, sanitized
evidence summaries in `docs/evidence`; never commit raw private source, secrets,
machine profiles, browser captures, or generated coverage dumps.
