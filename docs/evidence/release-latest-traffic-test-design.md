# Stable LATEST Traffic Regression Contract

Status: Independent test contract; red and green adapter results recorded.
Complete-target and distinct verifier acceptance remain separate.

Scope: Restricted synthetic staging, REL-03, REL-07 and REL-11. No production,
live cloud access, operational identities or deployment authority is introduced.

## Problem and Intended Behavior

Cloud Run can report a LATEST traffic allocation without a revision name in its
traffic status. The adapter currently requires every selected status to name a
revision, so revision creation rejects that response before sending its PATCH.

The [Cloud Run Service reference](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services)
describes generation and observedGeneration as decimal strings, and identifies
the readiness, reconciliation and latest-revision fields used to interpret
serving state. During reconciliation, observed state may differ from intended
state. This contract therefore permits the missing-revision fallback only when
the same Service response provides complete, consistent evidence of stability.
It does not infer a serving revision from the requested candidate image.

For an observed LATEST status whose revision is omitted, all of these must hold:

- `reconciling` is absent or boolean false.
- `generation` and `observedGeneration` are equal positive decimal strings.
  Compare their exact representations without conversion to floating point.
- `terminalCondition` has type `Ready` and state `CONDITION_SUCCEEDED`.
- `latestReadyRevision` and `latestCreatedRevision` identify the same valid
  revision of the configured Service.

The adapter then substitutes that established serving revision into an explicit
REVISION allocation while preserving the observed percentage. Revision creation
must include the pinned allocation and original etag in its single guarded
PATCH; the newly requested template revision must not receive traffic through a
remaining LATEST allocation. This fallback also applies to the GET-only
`readTraffic` operation.

Explicit revision allocations retain their existing behavior and do not acquire
the fallback's metadata requirements. A present but invalid revision is not an
omission. Missing non-LATEST revisions and unresolved or contradictory serving
state remain failures before any mutation; safe fallback is not permission to
relax revision scope or percentage validation.

## Independently Authored Cases

The new `stable omitted LATEST revision regression` group lives in
`tooling/tests/release-adapters.contract.test.mjs`. It uses the existing synthetic
Cloud Run transport and exercises public adapter operations rather than an
internal helper. Global live fetch is forbidden by the surrounding contract.

The final 38 selected cases cover:

- Both web and API revision creation with absent or false reconciliation state,
  exactly one PATCH, preserved etag and unchanged input response.
- Both Services through `readTraffic`, with exactly two GETs and no writes.
  An unstable second Service rejects the complete result.
- A mixed 60/40 allocation, resolving only the omitted LATEST entry while
  preserving the other explicit revision and both percentages.
- Existing explicit serving revisions without latest/readiness metadata.
- Equivalent full and short names for the same serving revision.
- Active or malformed reconciliation; missing, stale, numeric, zero or malformed
  generations, including numeric observed generation; missing or non-ready
  terminal condition; missing or conflicting latest revisions; foreign
  Service/project/region or malformed revision names.
- Omitted non-LATEST or unknown/missing-type revisions, null/blank/foreign explicit
  revisions, and incomplete/fractional percentages.

Negative creation cases require `NO_EFFECT`, exactly one Service GET and no POST
or PATCH. Generation fixtures exceed JavaScript's safe integer range, including
an unequal adjacent observed generation, to detect lossy numeric comparisons.
The existing explicit-traffic, guarded mutation and bounded polling tests remain
unchanged.

## Recorded Red Baseline

Independent test author ran the selected group on Windows with Node 24.16.0,
pnpm 11.19.0 and Vitest 5.0.0 on 2026-09-12 UTC, before implementation edits.

| Input                   | Identity                                                           |
| ----------------------- | ------------------------------------------------------------------ |
| Adapter source commit   | `189a066cacd1559a7640bb200bc2c8ba18330ef9`                         |
| Adapter Git blob        | `35b3e86472f6efb7e0fd15fbc14948a721f2783b`                         |
| Regression test SHA-256 | `184ab30ee2942baabaedc7b7611eb1f4f6247b40af946301a53dd3e2ad83a420` |

Command, from `tooling/`:

```text
node node_modules/vitest/vitest.mjs run tests/release-adapters.contract.test.mjs -t "stable omitted LATEST revision regression"
```

Result for the initial 33-case group: **Failed as expected** — 6 failed, 27 passed,
427 unselected. The six
positive fallback cases failed on the existing adapter's unresolved revision;
negative cases and the explicit-revision compatibility case passed. Raw execution
output is retained privately. This is selected synthetic regression evidence,
not complete-target coverage, hosted CI or live deployment acceptance.

## Author Review and Green Adapter Result

After the separate implementer added the guarded fallback, the test author
inspected its boundaries and added five cases covering numeric observed
generation, missing allocation type, foreign region, equivalent revision names
and rejection of an unstable second Service. No production implementation was
edited by the test author.

The full adapter file then **Passed: 465/465 tests** on the same Windows toolchain
on 2026-09-12 UTC. Formatting and ESLint also passed for the changed test file.

| Verified input                             | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Implemented `tooling/release/adapters.mjs` | `c4a560ebe2c10c683c1b7c957ae2a7bf65f592304c2fd8965912d700582c7605` |
| Final regression test file                 | `3ca95bb3a0a892bc33ac341c813d55b9b1728b72c7069c073541730300180e5c` |

Command, from `tooling/`:

```text
node node_modules/vitest/vitest.mjs run tests/release-adapters.contract.test.mjs
```

This is the test author's complete adapter-file result. It does not replace the
distinct verifier, whole-tooling coverage or hosted/image checks. The original
red test identity and failed output remain retained rather than rewritten to
match the expanded suite.

## Advancement and Verification

A separate implementer must make the unchanged contract pass. A distinct verifier
must review the final diff and independently run affected adapter tests plus the
complete tooling target and its required coverage. Source or test changes require
new identities and results; the red result remains part of the record.

Before restoring delivery, independently verify the repaired exact control-image
artifact and a fresh eligible mainline candidate, retain prior failed receipts,
and observe real staging traffic/artifact identities through the existing release
procedure. Local simulated responses do not establish live Cloud Run, IAM,
notification or release acceptance.
