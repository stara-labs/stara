# CodeQL pre-commit verification

Date: 2026-09-11. Conclusion: Ready for human review.

## Problem and candidate

PR #8 at `298fad1bfebe4a82ef8cd24b277c8dbc76078b97` passed the CodeQL workflow
jobs but failed the separate result check with a critical `js/request-forgery`
finding in `backend/api/src/mcp/server.ts`. The existing runtime validator
restricted the operator URL to loopback, but returned the input URL's origin.
The correction reconstructs the origin from literal loopback hosts and a
numeric port, retaining all existing input rejection and redirect restrictions.

The pre-commit gate now invokes real CodeQL on its isolated staged snapshot.
It uses CLI 2.27.0, pinned JavaScript/TypeScript and Actions security-extended
suites, and both remote and local threat models. It fails on new findings,
missing tools, analysis failures, and missing/malformed SARIF. The explicit
baseline records 34 existing findings from main revision
`189a066cacd1559a7640bb200bc2c8ba18330ef9`; it grants no MCP SSRF exception.
See [setup and baseline limits](../../tooling/codeql/README.md).

## Evidence and corrections

- Actual Windows CLI extraction/analysis of original commit `298fad1` reproduced
  33 JavaScript findings: 32 inherited and the exact new MCP SSRF fingerprint
  `bae5245f861b972a:1`. The new admission policy rejected that result. Raw local
  evidence is `.artifacts/codeql-baseline/red-local.sarif`.
- The independent test author recorded a behavioral red gate run: one docs
  fast-path test passed and three tests failed because CodeQL was not required.
  Test/source identities and results are retained in
  `.artifacts/codeql-test-author-red/`.
- Sixty-five new control tests passed, including exact occurrence-count
  baselines, changed rule/path/fingerprint rejection, missing reports, failed
  processes, tool/policy version drift, invalid run identifiers, retained
  reports, and real Git staged-byte isolation with an unstaged repair present.
- Actual analysis caught three path-injection findings in the new evidence
  writer. Direct run-identifier validation and filename-component construction
  removed those findings; no baseline entries were added to accept them.
- Actual full analysis then passed: 34 findings, all inherited, zero new.
  Evidence is `.artifacts/gates/92133153-b79b-4d2a-a43a-126f1e3830c8/codeql/`.
- The full Windows workspace coverage run passed 2,326 tests with all existing
  package floors satisfied. Final localized identifier/path corrections and
  additional boundary tests were followed by all 65 targeted control tests.
  API coverage was 125/126 lines and 71/75 branches. Tooling coverage in that
  full run was 2,669/2,763 lines and 1,757/1,885 branches. These counts identify
  that run; they are not a claim of hosted merge-candidate coverage.
- Root lint, typecheck, and secret scanning passed. The independent verifier
  reran 53 then-current CodeQL tests and 27 MCP unit tests, inspected real red
  and green SARIF, and found no remaining actionable code-review findings.
- Independent bounded mutation verification killed all three isolated mutants:
  omitting the commit scan (three test failures), admitting new findings (one
  failure), and ignoring CLI failure (one failure). The unmodified control
  passed 65/65 tests; live source hashes were unchanged. Exact mutation/source
  identities and reports are in `.artifacts/codeql-mutation-author/manifest.json`.

Local setup initially failed because the bundle inherited Stara's ESM package
type, because the sandbox denied access to the temporary source directory, and
because Windows PowerShell prohibited the Actions extractor script. A CommonJS
package boundary around the unchanged bundle and approved unsandboxed execution
with process-only RemoteSigned resolved these prerequisites. No persistent
PowerShell execution policy was changed. Initial command-path mistakes produced
test-startup errors; only the subsequently completed runs are test evidence.

## Ownership and remaining limits

The primary agent implemented the change; `codeql_test_author` independently
authored new tests, and `codeql_verifier` independently reviewed and verified it.
Existing protected tests and coverage thresholds were not changed. The scanner
retains sanitized reports through the existing gate evidence mechanism.

The inherited baseline is an initial regression policy for review, not evidence
that existing alerts are resolved or accepted risks. Its location fingerprints
do not prove identical upstream flows. Linux local execution has not been
verified. Hosted checks and responsible-human Engineering/Product acceptance
remain separate from these local results. The PR remains a draft.
