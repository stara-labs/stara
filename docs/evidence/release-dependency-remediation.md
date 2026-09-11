# Release Dependency Remediation

Date: 2026-09-11 UTC. Base PR head:
`59e8f053ba6d79149589e18572cbb7573091e135`. Results below are local working-tree
observations, not mainline publication or deployment evidence.

## CodeQL Disposition

The responsible Engineering owner explicitly authorized dismissal of the 27
independently reviewed CodeQL false positives: alerts 2-4 and 9-32. Alert 18's
existing owner dismissal was preserved. All 27 were verified dismissed, and
[findings check 103122677493](https://github.com/stara-labs/stara/runs/103122677493)
changed from failure to success at the unchanged base head. No source suppression,
dependency waiver or future-alert exemption was introduced. The
[PR disposition](https://github.com/stara-labs/stara/pull/4#issuecomment-5629263067)
retains the independent triage and draft/activation boundaries.

## Attestation SDK

Independent test author Ampere froze ten real installed-dependency tests after
capturing three passing and seven failing cases. The
[test-author ledger](release-attestation-dependencies-test-design.md) identifies
the red artifacts and synthetic remote-service substitutions. Parent implementation
changed only scoped workspace overrides and the generated lockfile:
`@actions/attest@3.2.0 -> @sigstore/sign@4.1.1 -> @sigstore/core@3.2.1`.
The obsolete core 2.0.0 dependency is no longer in the lockfile.

- Frozen test SHA-256:
  `bc00f5c12ea0f29756ed3be6820117b59ab172254905f28779b6053814d57fed`.
- Workspace SHA-256:
  `ff25abf6b8c66a34c86215b3db666b712492902b624e02ed611974a4c7241542`.
- Lockfile SHA-256:
  `b9317c5957f60247e24e7893a7994dda979717cc101cb3d0bf29cfc46f52ca35`.
- Node 24.16.0, pnpm 11.19.0, Windows: unchanged ten regression cases plus 120
  publisher cases passed. Report `.artifacts/attestation-and-publisher-green.json`
  SHA-256 `b9eb20eef48ada5d0797b044ec078ffafaf929a862e1e021e6c10851b141c29f`.
- `pnpm audit --audit-level low`: Passed, no known vulnerabilities reported by
  the fresh full-lockfile advisory lookup. This is time-specific, not proof of
  absence of undisclosed vulnerabilities.
- Frozen offline installation and source Secretlint: Passed.
- Complete API/shared UI/web coverage after the lockfile change: 101/3/57 tests
  passed; lines/branches 98.94/96.22%, 100/87.50%, 96.44/94.86%. These are complete
  targets, not selected-test coverage or a tooling coverage claim.

An initial parent invocation supplied a config path relative to the wrong Vitest
root and exited before executing tests. The corrected owning-package invocation
produced the passing results above; the startup error was not a product failure.
Offline SDK compatibility does not prove remote trust-service or IAM behavior.

## GitHub CLI Build

Hume independently authored the source-build contracts and the intentional
version-pin migration. The parent captured 445 existing/migrated cases with
432 passing and 13 failing before implementation. The author's
[ledger](release-gh-source-test-design.md) records the frozen tests, additional
source contracts and the separately identified environment-parser correction.
All 453 finalized source, runtime-image, infrastructure and transport cases then
passed. Static contracts are not artifact execution or security clearance.

The repair uses pinned upstream CLI source, compiler and module checksums;
`golang.org/x/mod` is upgraded to 0.40.0 and the resulting binary identifies itself
as `2.100.0-stara.1`. The exact recipe is shared by the private runtime and hosted
publisher. The existing required read-only image job gains separate blocking
vulnerability and secret scans of a saved executor image selected by its image ID.
No cloud authentication, new privileged workflow or public raw scan upload is added.

Retained actual build failures:

- Build `c` failed the upstream `internal/config` permission-error tests because
  its build user was root. No binary was accepted. The tests were not skipped or
  edited; the builder now uses its own non-root account and home before tests
  and compilation. The initial output is retained in the task transcript, not
  a standalone complete recipe/log artifact.
- Build `d`, logged at `.artifacts/release-control-build-d.log`, passed the complete
  CLI suite as non-root, then failed sumdb's `TestCertificateTransparency` because
  that upstream integration test requires a public endpoint and the stage denied
  external networking. The sumdb suite now has outbound network access without
  build credentials; CLI tests and compilation remain network-isolated. No test
  skip, source patch or failure waiver was introduced.

Complete local package coverage after these implementation changes passed all
2,210 tests, including 2,049 tooling tests. Tooling lines/branches are
96.66/93.46%; API/shared UI/web retain the complete-target values above.
`.artifacts/dependency-remediation-coverage.log` identifies this run. It does not
replace the separately recorded artifact scans, full validation or hosted run.

Build `e` passed both complete upstream suites and compilation. The final
Dockerfile SHA-256 is
`4e9c88b006791598409578f6561fb121c89221cbf2b53abaac37f9e2f64a24b7`.
Its retained `.artifacts/release-control-build-e.log` and build metadata identify
OCI index `sha256:05398249ec4b9c2799046f09280818ba122a9c70fecd754dd818ab7c5b3dc2fc`.
The scanned runtime image ID is
`sha256:fa4a4a796d1c4068bc46ef95c22b7842b7e81a320b76a1907d0da8deea8ab61d`;
an image ID, OCI index and archive checksum are different identities.

Exact artifact checks under ignored `.artifacts/control-remediation/`:

- `control.tar` SHA-256
  `989f1224f51d6abf43d48447be2cd6fe31bb6edaa81e47e90bdb244c80d6c3ef`.
- Pinned Trivy vulnerability scan: Passed, zero HIGH/CRITICAL findings.
  `vulnerabilities.json` SHA-256
  `b440b7774cae69b9eecbc5ca98bd24a820fba41b3591f3ec97869e9c191ca710`.
- Separate unfiltered secret scan: Passed, zero findings.
  `secret-findings.json` SHA-256
  `7abc6b382a8962ce3e4bec7f4a75d339853e62e516c338c13064bb70ba64fd02`.
- The actual runtime runs as UID 1000, preserves the upstream license, contains
  Go 1.26.8/x/mod 0.40.0 metadata and rejects the Unicode PAE substitution using
  its own installed Sigstore graph. `runtime-probe-green.json` SHA-256
  `cec705d693961ff830e2b98043cf0353472a1fff9e0516ec430d34cee6f4031e`.
- The publisher export path passed all seven GNU checksum checks. Its GH binary
  is byte-identical to `/usr/local/bin/gh` in the runtime: SHA-256
  `76ff209a62e757f774bc12d506cf30ebac4b5a4e9061598c48b93cab0f67a4a3`.
  `export-checksums-green.log` SHA-256
  `aa57daf99abe519972e45146573805953387fbe5a0795ba50b7e6ec404a42129`.

Two initial inspection commands failed because the probe used CommonJS resolution
for an ESM-only SDK export and GNU options with Alpine's BusyBox checksum tool.
Their original logs remain retained. Corrected probes use the SDK's actual entry
metadata and GNU checksum tooling, matching the Ubuntu publisher. These were
probe errors; no runtime source or test expectation was changed to obtain a pass.

## Remaining Evidence

Kant independently verified the 22 OCI archive blobs, index/configuration/layer
bindings, the GH binary and all six accompanying export files against runtime
copies, and both exact-archive scans. The effective upstream module files differ
only by x/mod 0.39.0 to 0.40.0 and its two checksum additions. Production and
protected-test hashes remained unchanged after the initial review. No new
P0/P1/P2 finding was identified; this is candidate-specific dependency/artifact
verification, not human acceptance or a general security guarantee.

The independent nonempty-Rekor probe also passed: actual SDK/witness conversion
preserved all synthetic proof fields, with identical bundle-3/bundle-4
serialization and round-trip and zero network calls. The probe is retained only
in the verifier task transcript, not a file: source SHA-256
`412bdc12111d3a79a69a6dd4235f6a73e709dcfc17d277d63b4a1a162ca8e37f`,
stdout SHA-256
`c924e629b389b2952d0ee43cee779b0cd76b6d26cb0509a9bbb72a240bfc476b`.
Synthetic log evidence still does not establish live trust-service compatibility.

The first final `pnpm validate` run passed static checks, builds and all package
tests, then all eleven Firefox page-using scenarios failed before page creation
with `browserContext.newPage` reading undefined `_page`. Chromium/WebKit scenarios
and the Firefox non-browser artifact scenario passed. The run then hung during
teardown; only its positively identified process tree was terminated. Evidence
remains in `.artifacts/dependency-remediation-validate.log` and browser run
`run-7061e18b-c314-4600-a8ec-045c64f7f960`. It is not a passing full validation.
The host-permission rerun uses the existing CI two-worker configuration and all
original scenarios, without source changes or automatic retries.

The clean host-permission rerun of `pnpm validate`, with `CI=1` and the pinned
pnpm CLI, passed static checks, secret scanning, all 2,211 package tests (including
2,050 tooling tests) and
complete-target coverage, builds, 36 functional and 36 accessibility scenarios
across Chromium, Firefox and WebKit. Functional run
`run-056ff3c5-2750-4d72-b8da-5f1d601697e2` and accessibility run
`run-b677feea-f7f3-406b-ae3c-2701eb959f50` are retained under `tests/e2e/.artifacts/`.
The full log is `.artifacts/dependency-remediation-validate-host.log`, SHA-256
`047da051912d3fa4243a05aaab5065c82a9aa6fc586bf600fa6551479bf0828d`. Host
permissions and concurrency both changed, so this does not isolate which caused
the initial Firefox failure. No failed evidence was erased or test relaxed.

Renewed hosted checks are recorded on the PR after pushing the final revision;
the previous head's CI is not reused as current-candidate evidence. The PR remains
draft pending human acceptance and the release milestone's remaining gates.
No merge, cloud bootstrap, DNS change, staging activation or production deployment
occurred.
