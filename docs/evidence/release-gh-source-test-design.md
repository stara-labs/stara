# Independent GH Source Build Test Design

Status: RED captured; authored tests frozen for parent implementation and a
distinct verifier. This is test-author evidence, not release activation approval.

## Ownership and Scope

This author owns only this document and these four test files for this change:

- `tooling/tests/release-runtime-image.contract.test.mjs`: preserve runtime,
  OpenSSL, non-root and cleanup guards; narrowly permit the pinned Go `gh` stage
  and scratch `gh-artifact` stage in the control Dockerfile only.
- `tooling/tests/release-infra.contract.test.mjs`: replace only the official GH
  binary installer contract with the reviewed source-artifact installer contract.
- `tooling/tests/release-transport.contract.test.mjs`: migrate positive version
  fixtures to `2.100.0-stara.1`; reject official `2.100.0`, a different Stara
  revision and a suffix-spoofed version. Existing verification controls remain.
- `tooling/tests/release-gh-source.contract.test.mjs`: seven initial static
  source-build, provenance, context and CI contracts, plus one reviewed non-root
  builder regression guard after actual upstream permission-test failures.

Parent owns production implementation; Kant is the intended distinct verifier.
No production files, dependencies, other actors' tests, commits, deployments,
authentication, live API calls or Docker/Go processes were changed or invoked by
this author. Earlier runtime-image evidence describes the previous official GH
recipe; this approved migration supersedes that recipe, not its security gates.

## Frozen Contract

The approved source is `https://github.com/cli/cli`, commit
`45437bc7eeeb3359bbfddd1742f79de7652fd3e2`, fetched with Docker `ADD --checksum`
from `https://codeload.github.com/cli/cli/tar.gz/45437bc7eeeb3359bbfddd1742f79de7652fd3e2`.
Its SHA-256 is `e16749bc0d99dc0633a3d5ebadf48ffff1c24beb1ce83e8f6a71bb64ce477e9a`.
The Go builder is
`golang:1.26.8-bookworm@sha256:9fdc884aacc3bec89b20ffc69f4bb369c78210e3e4f600387b5128b12c199f81`.
These pins are approved inputs supplied by the parent, not independently fetched
or rehashed by this author.

Only `golang.org/x/mod` changes, through
`go mod edit -require=golang.org/x/mod@v0.40.0`. The checked-in
`tooling/release/gh-x-mod.sum` must contain exactly:

```text
golang.org/x/mod v0.40.0 h1:hUv+3cXcdRHz08UmSiOob7sadHig73uo5bkXxQ/tvUs=
golang.org/x/mod v0.40.0/go.mod h1:0/weTWkPWGBikyTWAX3dkjVztMmBA5hM0DH6BElSupE=
```

Append these to upstream `go.sum`; download and verify modules, assert the
selected x/mod version, run both complete `go test ./...` and
`go test golang.org/x/mod/sumdb/...` suites, then build. No test skips, broad
dependency upgrades, checksum bypasses, failure suppression or CVE waivers.
Builder environment fixes `GOTOOLCHAIN=local`, `GOSUMDB=sum.golang.org`,
`GOPROXY=https://proxy.golang.org`, `GOFLAGS=-mod=readonly`, `CGO_ENABLED=0` and
`GOMAXPROCS=2`. Build uses `-trimpath`, `-buildvcs=false`, explicit Version
`2.100.0-stara.1` and Date `2026-09-03`, with `./cmd/gh` as input and
`/opt/gh/bin/gh` as output. Additional `-s -w` linker flags are permitted.
`RUN --network=none` for tests/build is permitted, not required; dependency
downloads and actual upstream test behavior must determine feasibility.

`tooling/release/gh-build.json` uses extensible metadata: assertions require
`source.{repository,commit,archive,sha256}`, `toolchainImage`, `version` and
`xMod.{version,sum,goModSum}` matching the above. Extra public fields are allowed;
no artificial schema version is required. This JSON is copied into provenance
as `source.json`. The export includes `bin/gh`, `LICENSE`, and
`provenance/{go.mod,go.sum,modules.txt,version.txt,source.json}`, all seven bound
by `SHA256SUMS`. Module and version text come from the built executable.

The scratch `gh-artifact` export reuses `/opt/gh/` from the same Go stage. Final
runtime keeps its Alpine pin, exact OpenSSL repair, npm/Yarn cleanup and non-root
entrypoint. It copies only GH binary, license and provenance; the agreed
provenance destination is `/usr/share/stara/gh/provenance`. All other existing
Node Bookworm builder pins remain required. Dockerignore admits only the two
specific new metadata/sum inputs in addition to the prior allowlist.

The publisher builds `gh-artifact` for Linux amd64 into its owned `RUNNER_TEMP`
directory, verifies `SHA256SUMS` with `--check --strict`, then installs binary,
license and provenance before Google authentication or publication. It cannot
fall back to the old prebuilt archive. Transport accepts only the exact patched
version; the upstream v2.100.0 URL in a version fixture denotes source origin,
not acceptance of the old executable.

The existing `release-images` job must build the control image and scan its saved
archive with the already pinned Trivy image. HIGH/CRITICAL vulnerabilities and
secrets are separate blocking scans; the secret scan has no severity filter.
No job, aggregate dependency, authentication authority or failure bypass is
added. Raw scan reports are not uploaded; only the existing public results
envelope is uploadable. The approved implementation additionally uses a
job-owned fixed directory created with exclusive `mkdir` under `RUNNER_TEMP`,
private JSON reports, and no
Docker socket mount. Those last filesystem/mount details require verifier review;
the frozen CI test checks archive input and blocking/publication boundaries, not
a general shell containment proof. Existing 30-minute image and 40-minute
publisher budgets remain initially; measure actual source-build duration. A
budget overrun is separate evidence, never authority to skip upstream tests.

## Actual RED

Run from `C:/code/stara/stara/tooling` with the pinned local Node executable:

```text
C:/nvm4w/nodejs/node.exe ../node_modules/vitest/vitest.mjs run tests/release-runtime-image.contract.test.mjs tests/release-infra.contract.test.mjs tests/release-transport.contract.test.mjs tests/release-gh-source.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-gh-source-test-author/red/results.json
```

Observed exit 1, **452 tests: 432 passed, 20 failed, zero skipped**.

| Suite          | Passed | Failed |
| -------------- | -----: | -----: |
| Runtime image  |      8 |      2 |
| Infrastructure |    143 |      1 |
| Transport      |    281 |     10 |
| GH source      |      0 |      7 |

The runtime failures require the Go stage and source/provenance migration. The
infra failure rejects the old installer. Transport happy paths reject the new
version under old production code, and the old official-version rejection fails
because production still accepts it. Several unchanged negative transport cases
can currently pass at the old version guard rather than their intended deeper
check: all 291 transport cases must be rerun after implementation. Missing
metadata/source stages account for static-source failures; these are not claims
of a cryptographic exploit or proof of a built binary's contents.

Parent was notified of actual four-suite RED before this ledger was finalized.
Parent independently reports `.artifacts/gh-build-authored-red.json`, 445 tests,
432 passed, 13 failed, zero skipped for the three migrations. The seven additional
failures in this author's retained report are the new source suite.

Private retained RED report SHA-256:
`74fa8d8816b6ec87adac9b954945e2e5370dfc6cebb10bfb807d2ab3503f982e`.
Do not commit the generated report.

## Input and Test Hashes

Pre-implementation production input SHA-256 values recorded for this RED:

| Path                                      | SHA-256                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `tooling/release/Dockerfile`              | `a762ed9642e063ade944d7358d7f5ef2aeb3ce150396bee0defa0fe373d21939` |
| `tooling/release/Dockerfile.dockerignore` | `925315a2aff43c83df3d55e8474d7e52a41359376ce482a5d3781812ac6064fc` |
| `tooling/release/transport.mjs`           | `e9797fc4924e6dd56d9517a3b7ad94723d87de1fd67c4109d7ad0405ac4377c9` |
| `.github/workflows/release.yml`           | `d5f74c758b122ceef3f2ee1e348e261f747359c435159d1b3d805477fba37421` |
| `.github/workflows/checks.yml`            | `8c441252b467fb03f253119541098b25bec4cf9c6f6f74aca08e2e351bded00a` |

`gh-build.json` and `gh-x-mod.sum` did not exist for the initial RED. Parent is
implementing concurrently; the above are historical inputs, not current hashes.

Initial RED authored test SHA-256 values, rechecked after RED:

| Path                                                    | SHA-256                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `tooling/tests/release-runtime-image.contract.test.mjs` | `d7467ec0afb91e9639443e588c8586bc950bc9a7f96b6d912c7c254957d4b3ff` |
| `tooling/tests/release-infra.contract.test.mjs`         | `31052a435be4997866360ba99c53e3b4861dd947817ce94f34c0abd3fcb65138` |
| `tooling/tests/release-transport.contract.test.mjs`     | `7bd0b335e53cbcbe485e2890028c6715a02ef33e413107ee957b3627a95f99a2` |
| `tooling/tests/release-gh-source.contract.test.mjs`     | `6f00bc58fc5ebe9515b414653856305637cf01c3fa14b6ea828c97d118c2fa70` |

## Corrections and Final Freeze

Parent identified one genuine author-helper defect after the original RED:
splitting ENV assignments on every `=` truncated `GOFLAGS=-mod=readonly`.
The author corrected only that helper to split at the first delimiter and retain
the complete value. No assertion was removed or weakened. The three protected
migration files retain their original RED hashes above.

After that correction, the author's same four-suite command exited 0:
**452 passed, zero failed, zero skipped**. Retained report:
`.artifacts/release-gh-source-test-author/post-parser-correction/results.json`,
SHA-256 `eabfc49c2c9b85cabc7803ffab85f739a8b27c75064259c2a8bc309b818baf87`.
This reran all 291 transport cases against the corrected production version
guard. The source test at that point hashed
`c0c577bc8b68845fc011b018996f1c1e0b2f9c195021c37bff57325b22eef23c`.
Parent separately reports `.artifacts/gh-source-contracts-green.json` and retains
intermediate new-suite RED at `.artifacts/gh-source-new-red.json`.

Parent then reported actual upstream test RED: full tests exited 1 after 110.9
seconds, only `internal/config`'s
`TestMigrationWriteErrors/failure_to_write_hosts` and
`TestMigrationWriteErrors/failure_to_write_config` failing because root bypasses
file permissions. No build artifact was produced. This author did not execute
that Docker build or independently inspect its logs. It is parent-reported real
upstream behavioral RED, not a newly observed static-guard RED.

The approved repair creates builder UID 10001 with a home, makes `/src`,
`/opt/gh` and `/go/pkg` builder-owned, sets `HOME=/home/builder`, and selects
`USER builder` (or equivalent UID 10001) before tests and compilation. There is
no return to root in that GH-stage execution. Parent had already applied the
repair when this author read the Dockerfile. The one added regression case
checks creation/ownership/home and USER ordering, and confirms its guard rejects
an in-memory root-run variant. No production file was reverted or altered to
manufacture RED. The new case first ran green; this distinction is intentional.

Final author run: **453 passed, zero failed, zero skipped**, exit 0, using the
same four-suite command with output
`.artifacts/release-gh-source-test-author/nonroot-freeze/results.json`.
Report SHA-256:
`e6987511ebaf17d1b6666750b633a1a7432ecce5fa3d2864bd5fb2429a153dda`.
Final frozen source-test SHA-256:
`a6784a587110e454f1e376cde0387fc6e2763354d89ba32ac91bf2b55135db83`.
The control Dockerfile read immediately after that run hashed
`cb93c7c5c9752af3dbae66edfff817bccf7e836528a0884d263a1dd81d7eede9`.
This shared-tree post-run snapshot is not a claim of immutable build inputs.

Scoped ESLint (four tests), Prettier (four tests and this document), Secretlint
(four tests and this document) and scoped `git diff --check` pass. No coverage
or full-repository gate is substituted by those scoped checks.

Parent's non-root build is running as build d, with its retained log at
`.artifacts/release-control-build-d.log`. The earlier build also preceded a
module-version assertion format change, so it cannot establish final-recipe
acceptance. Final actual build, upstream suites and fresh scans belong to the
parent/verifier handoff. No author-owned servers or build processes need cleanup.
Author work is now frozen and the active slot is free for Kant.

## Verification Limits

These tests do not run Docker, Go, GH, Trivy, cloud APIs or publication. They
cannot prove runtime compatibility, actual upstream suite completion, checksum
validity of downloaded inputs, a module graph with no unrelated changes, or
vulnerability clearance. A version string alone is not binary provenance.
The verifier must inspect actual build logs, exported hash checks, module/version
metadata, final non-root runtime behavior and fresh blocking scan results. No
coverage, whole-repository validation or actual-image acceptance is claimed here.

Conclusion: **More journey evidence required**. RED and scoped contract green are
retained; activation remains blocked pending real image evidence and independent
verification. Protected tests remain frozen unless the author reviews a genuine
contract defect; no expansion is needed for this handoff.
