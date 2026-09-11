# Secure Release Evaluation

Date: 2026-09-11 UTC
Conclusion: More journey evidence required
Scope: Restricted staging release candidate, not deployment acceptance

## Candidate and Actors

This work is on `feat/secure-releases`, based on merged PR #3 main revision
`319c9bf8fb7c4bbc852497e5742f801f9015aec1`. Mainline prerequisite runs
34545650412 (Scaffold) and 34545650446 (CodeQL) passed before this work.
The Product System revision and `validated: false` consumer record are unchanged.
Issue #1 remains open. Local observations precede the release commit and do not
establish hosted evidence for it or for the unchanged base revision alone.

Ampere authored core, executor, pipeline and publisher tests; Locke implemented
core, executor, pipeline and CLI. Mencius authored infrastructure, adapter and
storage tests. Hume authored transport, CLI and runtime-image tests and implemented
the UI/API surface against independently supplied behavioral tests. James and
the coordinating agent implemented infrastructure and transport; the coordinator
implemented adapters, publisher and integration corrections. Kant independently
reviews controls and reproduced implementation defects. Assignments and contexts
were separated in a shared checkout, not an OS-enforced test-file sandbox.
Human Engineering and Product acceptance remain separate.

Independent red/green records describe tests, source hashes, corrections and limits:
[core](release-test-design.md), [pipeline](release-pipeline-test-design.md),
[publisher](release-publisher-test-design.md), [adapters](release-adapter-test-design.md),
[transport](release-transport-test-design.md), [CLI](release-cli-test-design.md),
[infrastructure](release-infra-test-design.md), and
[runtime images](release-runtime-image-test-design.md).

## Local Evidence

Environment: Windows, Node 24.16.0, pnpm 11.19.0, Linux Docker containers.
Lockfile SHA-256: `4e07e1b1ce7b2bf20528f563ef1614269f99f8a13c2230ab90f951f8027c767b`.

All four complete eligible coverage targets passed after the final CodeQL
selection repair, including unexecuted authored files and new release tooling:

| Target    | Tests |              Lines |           Branches |
| --------- | ----: | -----------------: | -----------------: |
| API       |   101 |     94/95 (98.94%) |     51/53 (96.22%) |
| Shared UI |     3 |       19/19 (100%) |       7/8 (87.50%) |
| Web       |    57 |   244/253 (96.44%) |   240/253 (94.86%) |
| Tooling   |  2022 | 2576/2666 (96.62%) | 1700/1821 (93.35%) |

- Passed: `pnpm validate`, including token output integrity, formatting, ESLint,
  layout, type checks, source Secretlint, the coverage above, both builds,
  36 built-output functional checks and 36 accessibility checks. Token output
  integrity is not private upstream regeneration. Final documentation-only
  evidence additions are checked again by the ordinary commit gate.

- Passed: all three Terraform roots validate and pass 45 mocked plan cases
  (bootstrap 10, delivery 12, target 23), using Terraform 1.16.2 and providers 8.2.0.
  These tests make no live resource changes and do not establish IAM enforcement.
- Passed: real application image run `local-release-20260911-e`, including
  health/runtime configuration, 69 browser scenarios across Chromium, Firefox and
  WebKit, image vulnerability/secret scans, metadata/public-file scans and owned
  Compose cleanup. No browser failures, skips or flaky results. All four scan
  reports have zero secrets; both application images have zero HIGH/CRITICAL
  findings. `release:safety` independently rechecked the saved receipt.
- Passed: targeted policy mutation evaluation, 143 of 150 mutants killed, seven
  survived, no timeouts/errors (95.33%). This campaign covers existing selection,
  coverage and aggregate policy functions, not all new release controls. An
  initial Windows subprocess-cleanup failure was retained; the authorized rerun
  exited successfully. The score is not a survivor waiver.
- Passed: offline, read-only, non-root executor smoke checks for Node 24.16.0,
  official GH 2.100.0, retained licenses and missing-configuration denial.
- Failed: executor image security acceptance, detailed below. Successful process
  startup is not security clearance or verification of real attestations.

The passing application run is explicitly `working-tree` mode and cannot publish.
Its base SHA is not a claim that these images were built from unchanged main.
Exact local image identities are:

- Web OCI index: `sha256:312b22393f290964408eaebcded60d70172d57adb93bd8e6b60809e1949a78ff`.
- API OCI index: `sha256:2ff26e1a0b66f71405b780c221dae318e80cc3fcc3c4c56169293a20af794e97`.
- Verification receipt SHA-256: `cbf3b8c88a0a8430dd721c05654173c16e4965f1808923951c6bd23326db396e`.

Earlier image runs are retained. Run `c` passed 69 browser cases but failed on
66 API and 69 web HIGH/CRITICAL findings. Run `d` reduced those to two API OpenSSL
findings and zero web findings. Reviewed Alpine runtime pins and exact OpenSSL
3.5.8-r0 installation resolved those application findings in run `e`; no CVE
ignore, unpinned upgrade or package-inventory deletion was added. Initial runs
also exposed an E2E artifact-prefix mismatch. Independent regression tests cover
that correction and Trivy's legitimate omitted-Results clean filesystem format.

Visual captures from the actual image journey were inspected, including narrow
layout and doubled text/forced colors with dialogs. Automated text scaling is
not a claim of manual native-zoom or screen-reader acceptance. Product approval
of the staging notice and shell remains outstanding.

## Security Blocker

Kant's independent source review and synthetic probes closed the reported
concurrent-duplicate interruption, exact provenance run/attempt binding,
missing/newest CodeQL eligibility, and unbounded receipt-history defects after
independent red/green corrections. The newest-CodeQL closure covered adapter
SHA-256 `dc16afc3891e7723c81c28df74c38b7e38318137368a32d9c1b39d9f0a2e5f8e`
and pipeline SHA-256
`2dd5980a910a2558575eabf0367d9001ada904f3e679fae65c93563b894d1bd2`.
Those finding closures are not blanket security acceptance or live verification.

After initial commit `6eefd705e25b2f02cfbbaa7ed32243e734e73d0a`, a final
completeness review found that the separate coverage report inventory guard
still recognized only `lib` and `scripts`. Actual V8 reports already included
release files, so the measured coverage above remains valid. Independent
[coverage regressions](../../tooling/tests/release-coverage.contract.test.mjs)
captured three failures and four preservation passes before the one-line
`release` eligibility correction; all seven then passed. Kant independently
closed that P2 with nine read-only probes on `gates.mjs` SHA-256
`06e824b8c67a194fb17b80081ee968cd31947ee3b8d20f0ea1456cdc7c8bff90`.
No source exclusion, metric floor or existing protected assertion was weakened.
The renewed complete tooling coverage run passed 2,029 tests with 2,577/2,666
lines (96.66%) and 1,702/1,821 branches (93.46%). Other package sources are
unchanged from the full validation above. Locke independently reran the new
regression plus existing gate/policy suites: 245/245 passed, with source/test
hashes unchanged. This follow-up is not a new full-root or hosted execution.

The reviewed executor image remains blocked. Its scan contains two HIGH findings
in the official GH 2.100.0 binary: CVE-2026-56864 and CVE-2026-56865,
`golang.org/x/mod` v0.39.0, fixed upstream in v0.40.0. The official latest GH
release was still 2.100.0 when checked. No patched binary was fabricated and no
scan waiver was introduced. See the
[Go security advisory](https://groups.google.com/g/golang-announce/c/n98zX3vaIXs/m/T6fYYbScBAAJ).

The dependency audit also reports one moderate finding in
`@actions/attest > @sigstore/sign > @sigstore/core` 2.0.0:
[GHSA-jfc7-64v2-mr8c](https://github.com/advisories/GHSA-jfc7-64v2-mr8c).
The configured high-severity audit command exits successfully, but that does not
mean zero vulnerabilities. Signing-library applicability and a supported repair
require explicit review; no unreviewed major dependency override was introduced.

The scanned executor OCI index was
`sha256:65707a6dc37d5b908afbb727c79a498f4235d30b5306580fbaf88e67386b151c`;
scan SHA-256 `9fffef49f490021739d93bc696d509a06b821644e2f237a81122bb61f48fea74`.
This image predates the last CodeQL selection correction and is diagnostic only.
Rebuild and rescan the exact independently reviewed control source before any
bootstrap. Neither a passing application scan nor source mocks clear this blocker.

## Required Before Merge

- Resolve executor security findings and audit applicability, then rebuild,
  verify and scan the exact control artifact without weakening the gate.
- Obtain independent final consistency/security review and current-candidate
  Linux, Windows, container and browser hosted evidence. Prior mainline checks
  do not establish this PR's result.
- Record responsible Engineering and Product acceptance; no agent may supply
  either human approval.

## Activation Still Not Executed

No Stara delivery, staging, isolation or production resources have been provisioned
by this change. DNS-provider authorization remains outstanding. Real inputs stay
private, including the two owner-confirmed Google staging identities.

Live IAP allow/deny, direct-service bypass denial, Cloud Run rollout, private
receipts, actual signed provenance, incident/email delivery, cross-project IAM
isolation and merged-main automatic staging are Not executed. Follow the
[private bootstrap sequence](../release-operations.md#bootstrap-sequence) after
the separate review and owner-authorization boundaries. Production remains
disabled; no production DNS, resources or customer activation is authorized.
