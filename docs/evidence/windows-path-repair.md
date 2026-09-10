# Windows Path Contract Repair

Date: 2026-09-10
Status: Implementer verification; independent review pending
Baseline: `bd610949e023c0fe0f3f3773cb94f1a85f187737`
Actor: `codex-windows-path-repair`
Environment: Windows, Node 24.16.0, pnpm 11.19.0, Vitest 5.0.0
Requirements: GATE-01, GATE-02, GATE-03, and the approved Windows PR gate change

## Failure and Correction

[Mainline run 34533592722](https://github.com/stara-labs/stara/actions/runs/34533592722)
failed seven snapshot and five Compose identity tests. Test fixtures retained
temporary-directory aliases while production guards compared canonical paths.
The former config-level `TMPDIR` workaround did not normalize Windows paths.

Fixture and isolated harness allocation now resolves `realpath(tmpdir())` before
`mkdtemp`. The deterministic regression supplies an owned junction/symlink alias
to a child process without changing the parent's environment. It checks canonical
workspace and destination roots, Compose identity, exact committed/staged bytes,
unchanged source/index, and cleanup. Production guards are unchanged.

The Windows job now runs on PRs. The aggregate requires success on all supported
events; workflow contracts exercise its actual shell and reject failed, canceled,
missing, unknown, and skipped PR results. Pins and coverage floors are unchanged.

## Evidence

The standalone command prefix below was `node tooling/tests/run-contracts.mjs`.
Each run retained test/source hashes, command, timestamps, result, and log digest.
Records were moved intact into ignored `.artifacts/windows-path-evidence/` after
completion so generated reports do not enter source formatting checks.

| Arguments                                                                   | Result                                                            |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `--label windows-alias-red --test-file temporary-paths.contract.test.mjs`   | Failed as expected: noncanonical workspace root; 1 failed         |
| `--label windows-pr-gate-red --test-file workflow.contract.test.mjs`        | Failed as expected: Windows omitted from PRs; 3 failed, 41 passed |
| `--label windows-alias-green --test-file temporary-paths.contract.test.mjs` | Passed: 1 test                                                    |
| `--label windows-pr-gate-green --test-file workflow.contract.test.mjs`      | Passed: 44 tests                                                  |

Red alias log SHA-256:
`44ccf0d885c105f957b02224afa4193b6b464e0d63217feeeda1c79b03ea151d`.
Red workflow log SHA-256:
`6037ca0b8db1dee27baa90c06dae96d40d4d536e50ab09ca1c6dd0de552b5a08`.
Formatting and cleanup-helper changes followed the focused runs; the final test
version was reverified by the complete package command below.

`pnpm test:coverage` passed all 659 package tests, including 547 tooling contracts,
in 124.432 seconds. Scope is each complete eligible package target, not selected
files: tooling 95.03% lines / 89.11% branches; web 96.06% / 94.44%; shared UI
100% / 87.50%; API 100% / 97.61%. The invocation used the existing `createRuntime`
with the pinned pnpm entry point and run ID `windows-path-repair-package-coverage`
to normalize duplicate PATH casing in the local terminal environment.

`tokens:check`, `format:check`, `lint`, `typecheck`, `security:secrets`, and `build`
passed. The working-candidate build manifest records baseline plus dirty source
hashes, dependencies, runtimes, configuration, Product System pin, and artifact
digests. Its SHA-256 before this evidence-only document was added is
`1ebd67a1d8f409a81397d81f1a8d2ec4572d9ab76857fc01186c96d805b7adc6`.
It is not evidence for an unmodified baseline or a future merged revision.

The first standalone full harness invocation omitted its required pnpm entry
point: 542 passed and five prerequisite tests failed. That run is retained, not
counted as passing coverage. Initial formatting and lint failures are also
retained; artifact relocation and the cleanup-helper correction preceded passing
reruns. No coverage exclusion or test skip was introduced.

## Review Boundary

The original protected-test manifest and historical evidence remain unchanged;
they do not attest to this revised test set. These tests and changes are proposals
from the implementer, not independent test-author or verifier sign-off. Independent
test-owner/verifier review and current-candidate hosted Windows/Linux checks are
required before merge. Hosted results and exact committed identities belong in
the repair PR; merged-main verification remains required after an approved merge.

No browser/container journey, Linux execution, mutation evaluation, or deployment
is claimed by this local record. Existing adversarial snapshot assertions remain
intact. UI, API, dependency, token, and production path-control source is unchanged.
