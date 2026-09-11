# Independent Release CLI Test Design

Author role: independent test author. Locke implements `tooling/release/cli.mjs`;
the author owns only this document and `tooling/tests/release-cli.contract.test.mjs`.
Base `319c9bf8fb7c4bbc852497e5742f801f9015aec1`, shared branch
`feat/secure-releases`. No production source, workflows or existing pipeline tests
are edited. Earlier transport test corrections remain independently authored.

## CLI Boundary

`main(argv,{runtime,env,clock,operations})` resolves exactly `0` for success and
throws a sanitized error on failure. `env` defaults to `runtime.env`; default
runtime uses the existing `createRuntime` contract. Exactly one command is
accepted: execute, await-checks, images, safety, publish, dispatch, coverage-export.
No positional paths, shell commands, flags or extra commands are accepted.
Default runtime receives `runId=env.STARA_RELEASE_RUN_ID` when supplied, allowing
separate images/safety/publish processes to share one exact owned run directory.
Otherwise the existing random runtime ID applies; local cross-command reuse
requires an explicitly retained run ID.

Tests use a real owned temporary filesystem, existing runtime with injected Git
and command results, synthetic operations and blocked real process/network/auth.
Imported CLI must not execute commands or change output/exit state. The guarded
executable entry calls main only when its own path matches `process.argv[1]`,
sets exit code 1 on failure and emits no raw exception. Entry tests mock defaults,
not a new subprocess or live cloud client.

Operations retain the pipeline/transport function signatures. Additional factories:

```js
createGitHubReader({ env }); // -> Octokit-compatible read-only request
createArtifactPublisher({ runtime, env, clock }); // -> {registry,storage}
createStagingDispatcher({ runtime, env, clock }); // -> publish function
createAuthenticatedRequest({ clock }); // -> Google-aware request, execute only
```

Default GitHub reader uses pinned `@octokit/request` 10.0.16, not hand-parsed API
routes or GoogleAuth. Cloud/SDK initialization is lazy and branch-specific. Images,
safety and coverage export need no auth; await-checks needs only the read-only
GitHub reader. Provider SDK behavior is separate from these composition tests.

Source is a strict lowercase full SHA from matching GITHUB_SHA/STARA_SOURCE_SHA,
or local Git HEAD only if both variables are absent. An explicitly invalid value
cannot fall back. Execute needs no checkout/source. CI mode is exactly CI=true;
otherwise image verification records working-tree and is not publishable.

## Images, Checks and Safety

Images calls `verifyImages({sourceSha,mode,runtime,clock,trivyImage})` with the
existing approved immutable Trivy pin. It writes the exact validated identity
exclusively to `.artifacts/release-pipeline/<runtime.runId>/result.json` after
verification creates that run. Existing pointers and linked/foreign paths deny.
Public `.artifacts/public-release/results.json` uses real core `publicEvidence`,
only fixed synthetic simulation outcomes, never image metadata/private paths.

Safety strictly reopens that per-run pointer, capped at 64 KiB, and calls
`checkImageEvidence({verified,runtime})`. This new pipeline export reuses receipt
and report validation; CLI must not duplicate or bypass it. Validation errors deny.
No new scan, build, credentials or publication occurs. Local validation does not
relax the separate pipeline rule denying working-tree publication.

Await-checks calls the GitHub reader and existing awaitMainChecks with exact source,
repository 1363262992 and clock. Validated checks go to owned private `checks.json`;
only canonical scaffold ID/positive integer attempt are appended to official
GITHUB_OUTPUT as `scaffold-run` and `scaffold-attempt`. No raw response or canary
is emitted. Missing GITHUB_OUTPUT is allowed for local read-only checks.

## Coverage Export

Read the four actual `.artifacts/coverage/{web,ui,api,tooling}/coverage-summary.json`
files with a 16 MiB ceiling per file, strict UTF-8/JSON and unlinked containment.
Validate total lines, branches, functions and statements: positive integer
denominators, nonnegative integer covered counts no larger than total, zero
skipped counts, finite numeric percentages in [0,100] consistent with covered/total.
Require at least 90% lines and 85% branches, including rejecting zero percentages.
Optional native Istanbul `branchesTrue.pct:"Unknown"` metadata is not one of these
four metrics and is omitted. Private per-file paths are never exported.

Require exact clean HEAD, trusted repository, push/main and canonical current
GitHub run/attempt. Exclusively create `.artifacts/public-release/coverage.json`
with exactly `{schemaVersion:1,sourceSha,runId,runAttempt,coverage}`; four records
are `{target,sourceSha,complete:true,lines,branches}`. Missing/selected-only,
malformed, inconsistent, stale-source or low coverage cannot produce an envelope.
The test proves numeric completeness and composition. Summary files alone do not
attest which command generated them: the reviewed full-run workflow sequence and
exact Actions artifact/run binding remain required external evidence.

## Target-Neutral Publication

Publication does not read or require STARA_CONFIGURATION_SHA256. The application
manifest is target-neutral, shared across independently configured deployments;
only dispatch/execution bind target configuration. The parent and pipeline test
author approved removal of the earlier unnecessary publication parameter.

Read this run's pointer and the fixed downloaded
`.artifacts/release-inputs/coverage/coverage.json`. Revalidate main checks fresh,
copy original coverage bytes into the owned run, hash those exact bytes and pass
`coverage:{path,sha256}` plus verified/checks/current image-run identity to
publishCandidate with publisher registry/storage. No old checks file substitutes
for fresh eligibility. Core/publisher enforce publication event/ref/identity.
The manifest requires all three distinct run identities: scaffold, images and
CodeQL. Returned scaffold/CodeQL facts must match the freshly obtained checks,
including exact attempt; image facts must match this publishing run. Missing,
mismatched or extra CodeQL identity fields cannot produce public output.
Only a strictly parsed, correctly hashed manifest is written to
`.artifacts/public-release/manifest.json`; no target identifiers, receipts or logs.

## Dispatch and Execute

Dispatch reads the official GITHUB_EVENT_PATH (not a path supplied by event data),
bounded to 1 MiB. The fixed candidate input is
`.artifacts/release-inputs/candidate/manifest.json`, capped at 64 KiB. Preserve its
original bytes including whitespace. Call createStagingDispatcher for publish,
then dispatchCandidate with the existing event/repository/request/publish/topic/
manifest/configurationSha256 contract. Topic and hash come only from fixed env.
No public raw webhook/manifest/dispatch diagnostics are produced.
Legacy two-run candidates without CodeQL deny before dispatcher construction.

Execute delegates exactly `{argv:['execute'],env,clock,request}` to executeCLI,
using configured Google transport. Status succeeded or running maps to exit zero;
failed/degraded/reconciliation_required, unknown or missing outcomes fail.
Running is acknowledgement of an already-owned duplicate only, not a claim of
deployment success: no retry, publication or public success file. Ampere owns the
executor test proving overdue nonterminal duplicates halt for reconciliation and
retain their original lock; CLI delegates that state decision, not a fresh timer.
Broad CLI catches remove private causes/diagnostics instead of trusting generic
runtime errors to be publication-safe. No operation is blindly retried.

## Evidence

Initial red is ready. Missing CLI module/export is detected inside every
collected case before expected denial assertions. It cannot count as a successful
negative case. No test substitutes fake cloud results for live acceptance.
Full affected tooling coverage, real executable/provider integration and a
distinct verifier are required after implementation. No commit/push/merge.

Frozen baseline command, from `C:/code/stara/stara/tooling`:

```text
node ../node_modules/vitest/vitest.mjs run tests/release-cli.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-cli-test-author/red/results.json
```

Result: 115 collected, 115 failed, 0 passed, 0 skipped, exit 1. All failures are
`Missing implementation: tooling/release/cli.mjs; behavior not executed`.
This is an independently collected missing-module red baseline, not observed
production behavior. Locke may begin CLI-only implementation against this contract.
ESLint passed; formatting and diff checks are scoped to these two owned files.

Test SHA-256:
`267bac5946c45f563b73659d8be61ef82394869d3a3b0ca249f03ac62abdc944`.
Ignored report `.artifacts/release-cli-test-author/red/results.json` SHA-256:
`4c5464b2c50306335e607df66c1258c73dcb643e4f3d1f620c67418e6d36b29f`.

The public image summary may use the fixed `REL-10` Passed simulation case;
it cannot represent live staging, actual cloud access or automatic delivery.

Handoff conclusion: More journey evidence required.

## P1 Behavioral Red Handoff

RED READY for Locke's CLI-only correction. The newly approved manifest requires
`runs.codeql` in addition to scaffold/images; publication remains target-neutral,
coverage still binds the scaffold run, and dispatch preserves original bytes.
`main(['execute'])` must acknowledge an executor `running` duplicate with zero,
without changing it to succeeded. Other failure states still deny. There is no
compatibility fallback for an old two-run candidate.

```text
node ../node_modules/vitest/vitest.mjs run tests/release-cli.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-cli-test-author/provenance-codeql-red/results.json
```

121 collected: 114 passed, 7 failed, zero skipped, exit 1. Failures include the
three-run happy publication/dispatch fixtures being rejected by the old shared
parser, accepting missing CodeQL in publication/dispatch, and rejecting running.
The dispatch error-propagation case also fails because old parsing prevents the
operation from being reached. Wrong-run/attempt CodeQL negatives currently pass
at old-parser rejection, so they must be rerun after shared contract changes to
prove exact fresh-check binding; they are not yet independent behavioral proof.

Production source at red (unchanged by this author):

- CLI SHA-256: `c7c5fdad287e4217d76b971a9316f0727e9ff40ff260e6320660a7444edc7b37`.
- Shared contract SHA-256: `cecd7c710864fa5a1d1d2a074f06690df5d0f8a54ebc5ae1c07cc6ff2dbc350e`.
- Test SHA-256: `62f9ebc5673c740f2ad877eb6a49460c7c42300ef223dbce29248e299ffe17b8`.
- Report SHA-256: `6487f6b49ba5c00dced0c2702bf96f9648ef86bec4ef03dd7ad35cd3c1aaf60e`.

Transport's parent-approved interface uses flat required `runId`/`runAttempt` in
inputs and verified facts, not the verifier's proposed nested `imagesRun` shape.
Ampere confirmed that parent decision and owns independent core/executor/pipeline/
publisher tests. Parent owns those implementations and provider factories; Locke
owns CLI only. Existing coverage/current-candidate/target-neutral tests remain.
Default-provider SDK composition review is deferred behind this P1 correction;
the mocked tests do not claim live auth, signing, HTTP or full tooling coverage.

No multi-agent send_input tool is exposed in this session. This shared handoff
and the author response require parent relay to Locke
`01a08dd7-471e-73a0-ace3-af64bafd60b9`; direct delivery is not claimed.

## Final Scoped Recheck

Unchanged CLI tests were independently rerun with the now-corrected transport
suite. Report: `.artifacts/release-cli-test-author/p1-final-scoped/results.json`.
CLI remains 114 passed, 7 failed, zero skipped against unchanged source
`c7c5fdad287e4217d76b971a9316f0727e9ff40ff260e6320660a7444edc7b37`
and shared contract
`cecd7c710864fa5a1d1d2a074f06690df5d0f8a54ebc5ae1c07cc6ff2dbc350e`.
The failures are the same seven documented in the P1 red handoff, not a new
regression. Locke's running/fresh-CodeQL change and the shared three-run parser
remain pending; the wrong-run/attempt negative limitation still applies.

Transport is independently 288/288 green in that report. Combined status is
402 passed, 7 failed / 409 collected, zero skipped, exit 1. Report SHA-256:
`05bc10ea9b1d2acf285e375d6e69c4cdd391471c8fa532b61d8b2f0f092e5d70`.
CLI test SHA-256 remains
`62f9ebc5673c740f2ad877eb6a49460c7c42300ef223dbce29248e299ffe17b8`.
Full-source Secretlint and scoped source/test ESLint passed. No test expansion,
production edits, servers, signing or live network calls. These scoped checks do
not establish full-tooling coverage or final release acceptance.

Handoff conclusion: More journey evidence required.

## Independent Coordinated Green

After Locke's CLI/shared-contract update, the author reran the unchanged frozen
CLI and transport suites:

```text
node ../node_modules/vitest/vitest.mjs run tests/release-transport.contract.test.mjs tests/release-cli.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-cli-test-author/p1-cli-core-green/results.json
```

CLI 121/121 and transport 288/288 passed: 409 total, zero failed/skipped, exit 0.
The former seven pending failures are now green. Exact fresh CodeQL ID/attempt
negatives now execute with a parser that admits the three-run happy fixture;
source review confirms comparison of both fields before public output. Running
acknowledgement returns zero without public success artifacts or replay. Existing
coverage/current-candidate/target-neutral boundaries remain intact and passing.

- CLI source SHA-256: `2818220fdc513929300f59e6c1cf938fef0fae6a6657328abce224746338d5aa`.
- Shared contract SHA-256: `f63f714f005d70d561f58f2bf4a5e599e8e2a118def2c1c4e9ad48d0b7ed5ef2`.
- CLI test SHA-256: `62f9ebc5673c740f2ad877eb6a49460c7c42300ef223dbce29248e299ffe17b8`.
- Report SHA-256: `7c17e613d4a9e30e21a50d43692237244ccdb1c2cd3b99a2f41314e96ad6c039`.

Source hashes matched before and after execution. Full-source Secretlint and
scoped ESLint, formatting and diff checks passed. No tests were expanded or
weakened; no production changes were made by this author. Prior red reports are
retained. Complete affected-tooling coverage, default provider/live integration
and distinct verifier acceptance remain separate outstanding evidence.

Handoff conclusion: More journey evidence required.
