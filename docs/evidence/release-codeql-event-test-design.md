# Independent CodeQL Event Regression

Author ownership: `tooling/tests/release-pipeline.contract.test.mjs`,
`tooling/tests/release-adapters.contract.test.mjs`,
`tooling/tests/release-contract.contract.test.mjs`,
`tooling/tests/release-executor.contract.test.mjs`, and this ledger. Starting
tracked tree was clean at `265e86188cb43c79fcdb6067d74075f78a6f3307`.
Parent owns production and other documentation. No production, cloud, GitHub,
credential, deployment, staging or commit operations were performed by this
author. Effects in these tests are injected simulations, not live requests.

## Exact Event Correction

Owner/reviewer evidence reports that the default-setup CodeQL workflow uses
event `dynamic`, path `dynamic/github-code-scanning/codeql`, and workflow ID
`355366692` for the exact mainline commit. Its corrected `dynamic` query returns
the successful run while the old `push` query returns none. This author did not
query GitHub or independently reproduce those live results; the regression
models that API behavior with synthetic run IDs and source hashes.

This is a correction of the observed native event, not an expanded event
allowlist. The contract is exact per workflow kind:

| Workflow kind | Required event | Remaining identity constraints                                                                                                                                                    |
| ------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CodeQL        | `dynamic` only | Fixed numeric workflow ID and dynamic path, exact repository/head repository, main branch, source SHA, latest complete inventory, current run, selected attempt and required jobs |
| Scaffold      | `push` only    | Existing trusted workflow, repository, branch, source, attempt and required-job constraints                                                                                       |
| Images        | `push` only    | Existing publication/dispatch workflow, repository, branch, source, attempt, signing and job constraints                                                                          |

CodeQL labelled `push` or `pull_request` is rejected, not treated as compatible
fallback evidence. Dynamic CodeQL is not image publication or signing authority.
CodeQL inventory queries must omit the event filter entirely: every returned
entry must match the pinned workflow and strict `dynamic` event. Filtering by
`dynamic` could hide a newer unsupported-event run and falsely preserve older
success. Core validation must require the literal
`dynamic/github-code-scanning/codeql` ref, even if policy and evidence refs are
both altered to match a foreign workflow. Scaffold queries remain push-filtered.
No policy schema, manifest shape, exported evidence shape, latest-run ordering,
coverage floor, retry/deadline rule, dispatch envelope or attestation identity
contract is broadened.

## Initial Authored Changes

The initial freeze's four shared valid-run fixtures choose `dynamic` only for CodeQL and
retain `push` for all other kinds. Three CodeQL query/output expectations are
migrated accordingly; the pipeline's shared query assertion now checks the
event by workflow identity. Executor tests receive only this one-line fixture
correction, with no assertion or scenario changes.

Twenty-five focused cases are added:

- Pipeline: nine cases covering a filter-aware successful dynamic query,
  rejection of push-labelled inventory/current/attempt/all CodeQL responses,
  continued rejection of dynamic Scaffold inventory/attempt evidence, and
  rejection of dynamic or PR image publication before dispatch.
- Adapters: nine cases covering the same filter-aware successful dynamic query
  and push-labelled CodeQL boundaries, plus unchanged push-only current/attempt
  checks for Scaffold and images. Evidence returns the original native event.
- Contract: six workflow/event rejection combinations and one rejection of
  CodeQL substituted as image-signing provenance.

Existing CodeQL wrong workflow/path, wrong repository/head repository, wrong
SHA/branch, PR event, malformed/ambiguous/truncated inventory, failed/pending
newest run, changed current attempt, job completeness and coverage cases remain
unchanged apart from their shared valid CodeQL fixture. Request-path assertions
ensure negative cases reach the intended boundary rather than merely passing
because an earlier valid dynamic event was rejected. The all-push cases also
demonstrate that previously accepted synthetic evidence must now be refused.

## Actual RED

Run from `C:/code/stara/stara/tooling` using the pinned local Node executable:

```text
C:/nvm4w/nodejs/node.exe ../node_modules/vitest/vitest.mjs run tests/release-pipeline.contract.test.mjs tests/release-adapters.contract.test.mjs tests/release-contract.contract.test.mjs tests/release-executor.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-codeql-dynamic-test-author/red.json
```

Observed exit 1: **783 tests, 688 passed, 95 failed, zero skipped**.

| Suite    | Passed | Failed |
| -------- | -----: | -----: |
| Pipeline |    151 |      9 |
| Adapters |    369 |     57 |
| Contract |    146 |      2 |
| Executor |     22 |     27 |

The two filter-aware success regressions fail under the old push query. The
shared validator rejects valid dynamic evidence but accepts the all-push CodeQL
fixture that its new negative case rejects. Pipeline and adapter failures also
include boundary-reach assertions because valid dynamic inventory is rejected
too early. Executor failures follow the unchanged executor's use of the shared
validator; they are not evidence of 27 separate executor defects. There are no
new module stubs or missing-module failures.

RED was reported to the parent immediately after the retained JSON report was
read. Tests were frozen before parent production implementation. Passing negative
cases under the old early-rejection behavior do not prove their deeper checks;
all four unchanged suites must run GREEN after the correction.

## Initial Freeze Hashes

| Test or report                                           | SHA-256                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------ |
| `tooling/tests/release-pipeline.contract.test.mjs`       | `75f83b63715fce03f3e47b4e1c684afba1d69ca29a79245f0f887b857a01339f` |
| `tooling/tests/release-adapters.contract.test.mjs`       | `966f912b1d3afc569a1e1e530ef3820f3179ec79c367a10d33fd941aa90ab3b5` |
| `tooling/tests/release-contract.contract.test.mjs`       | `94d46a6f114a8e4d0bfe2db44a4933d41ed4da9b282a7ab5114a7ab4abf4f331` |
| `tooling/tests/release-executor.contract.test.mjs`       | `61f12d2623ecfba7f1a100bbd5fbb29efc8515103ae949fe8d9930ce0c647e6e` |
| `.artifacts/release-codeql-dynamic-test-author/red.json` | `049c42e2c2f03f4053c7bf1ffe0a841773127a89ee3a6469f6b3c085473a5b31` |

Production hashes recorded before this RED run, not claims about later parent
edits:

| Production input               | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| `tooling/release/pipeline.mjs` | `2dd5980a910a2558575eabf0367d9001ada904f3e679fae65c93563b894d1bd2` |
| `tooling/release/adapters.mjs` | `dc16afc3891e7723c81c28df74c38b7e38318137368a32d9c1b39d9f0a2e5f8e` |
| `tooling/release/contract.mjs` | `f63f714f005d70d561f58f2bf4a5e599e8e2a118def2c1c4e9ad48d0b7ed5ef2` |
| `tooling/release/executor.mjs` | `1b29229fa911462debf965a3d875d84f2d40f1fb2b692161095ffec2d6ef80c2` |

Scoped ESLint, Prettier, Secretlint and diff checks pass. No protected assertion
was removed. Test changes remain frozen; any later correction requires explicit
independent author review. Generated reports stay in ignored artifacts.

## Reviewed Amendment and Final Freeze

Before production changed, independent review identified that even a `dynamic`
inventory filter could conceal a newer unsupported-event CodeQL run. The owner
explicitly approved amending the frozen tests to omit that filter while retaining
strict event validation. Both pipeline and adapter success/query assertions now
require absence of the event parameter. No fallback to push or broad event
allowlist is permitted.

One new case in each suite models a successful dynamic run plus a newer
push-labelled run with the same workflow/source/repository/branch. The injected
API realistically filters responses when given an event parameter. The test
requires an unfiltered inventory read and rejection before downstream run reads;
it cannot pass by silently dropping the unsupported entry. A further core case
mutates both policy and evidence to the same foreign CodeQL ref, keeps the event
dynamic, and requires rejection. No prior denial assertions were removed.
Executor fixtures remain unchanged from the initial freeze.

The original `red.json` remains unchanged. The first amendment run is retained
as `amended-red.json`; the authoritative final run includes the additional core
literal-ref case and uses the original four-suite command with only
`--outputFile=../.artifacts/release-codeql-dynamic-test-author/amended-freeze-red.json`
changed. Observed exit 1: **786 total, 689 passed, 97 failed, zero skipped**.

| Suite    | Passed | Failed |
| -------- | -----: | -----: |
| Pipeline |    151 |     10 |
| Adapters |    369 |     58 |
| Contract |    147 |      2 |
| Executor |     22 |     27 |

The core literal-ref denial currently passes because old code already rejects
all dynamic evidence. Its intended binding check must be reached during GREEN;
this RED is not independent proof of that deeper check. Both newer-push inventory
cases fail, in addition to the previous event-related failures. Total additions
are now 28 cases beyond the original reviewed suites.

Final frozen SHA-256 values supersede only the initial test hashes above:

| Test or report                                                          | SHA-256                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `tooling/tests/release-pipeline.contract.test.mjs`                      | `5deb7054d0c00260b4db98fde43256f9f3374dcd024788f73ac69281b75aa5f3` |
| `tooling/tests/release-adapters.contract.test.mjs`                      | `6545b9c6ddc4f267f08792be9ad7fea00613bb9fc15b6ed49a7400acadc36039` |
| `tooling/tests/release-contract.contract.test.mjs`                      | `2bad30a02a138c300b70943aa480749926f5dedf138bf18475b370ef35f0150b` |
| `tooling/tests/release-executor.contract.test.mjs`                      | `61f12d2623ecfba7f1a100bbd5fbb29efc8515103ae949fe8d9930ce0c647e6e` |
| `.artifacts/release-codeql-dynamic-test-author/amended-freeze-red.json` | `32b9780b42a33ea1b91e10de0efcfa2f3c624266181e3f64cb5cc56302d7406b` |

Production pipeline, adapter and contract hashes were rechecked against the
unchanged initial source hashes before notifying the parent that amended RED
was ready. Scoped ESLint, Prettier and Secretlint pass for all four tests. The
parent was notified immediately after final RED counts were read; no further
test changes are authorized without explicit review.

## Parent GREEN Evidence

The parent implemented the three production corrections and reports the same
four-suite command exited 0, changing only the output path to
`.artifacts/release-codeql-dynamic-test-author/green-parent.json`. This author
read that report: `success` is true, **786 passed, zero failed, zero skipped**.
This is inspection of the parent's execution evidence, not an author rerun.

| Suite    | Passed | Failed |
| -------- | -----: | -----: |
| Pipeline |    161 |      0 |
| Adapters |    427 |      0 |
| Contract |    149 |      0 |
| Executor |     49 |      0 |

All four current test files were independently rehashed and exactly match the
final amended freeze values above. The original RED and amended-freeze RED
reports were rehashed and retain their earlier values. No protected test was
edited for GREEN.

| Evidence or current production input                              | SHA-256                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `.artifacts/release-codeql-dynamic-test-author/green-parent.json` | `d6511188869e693def647221ed114f6ba7b2ea286846d72b2e86c5d1891420f0` |
| `tooling/release/pipeline.mjs`                                    | `82dd22620bb88c1104cb51081def81ae4385a22934b042ba0578b4215d6277a1` |
| `tooling/release/adapters.mjs`                                    | `215f3b6253e2243af3249813a870d17834180232fa14d018be633fbfe65e3f3e` |
| `tooling/release/contract.mjs`                                    | `456b2771125260a2ecc7cf2c9db4dd5d8b73296bba51cd5a9a87a65e9de58355` |

Production hashes are the author's current post-run snapshot, not proof of an
atomic immutable input capture during the parent run. Only this ledger was
updated for the handoff. Document formatting, scoped Secretlint and scoped diff
checks pass; test ownership and freeze remain unchanged.

## Limits and Handoff

Whole-tooling coverage, normal hooks and Kant's independent implementation review
remain pending. The parent owns those release gates. This author neither changed
GitHub settings nor enabled dispatch, and these simulated tests do not prove a
successful hosted publication or live executor journey. Historical ledgers are
left intact; the parent owns their supersession notes.

Conclusion: **More journey evidence required**. Exact-event RED, amended frozen
tests and parent GREEN are retained. Remaining release gates and live journey
acceptance are not established by these focused simulated results.
