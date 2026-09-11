# Independent Release Adapter Test Design

Current-event correction: the `push` assumptions for default CodeQL below are
superseded by the [CodeQL event regression](release-codeql-event-test-design.md).
They remain here as historical design and evidence; scaffold/image events and
all other eligibility requirements are unchanged.

Role: independent test author, distinct from implementation and final verification.
Base: `319c9bf8fb7c4bbc852497e5742f801f9015aec1`, branch `feat/secure-releases`.
Authority: approved release requirements, release architecture and the independently
authored core contract in `release-test-design.md`. This assignment owns only
`tooling/tests/release-adapters.contract.test.mjs`, this document, ignored evidence,
and legitimate independently reviewed corrections to the earlier infrastructure
tests. The parent owns `tooling/release/adapters.mjs` and HTTP/CLI implementation.

## Injected Interface

`tooling/release/adapters.mjs` exports:

```js
readPrivateConfiguration(raw);
createCloudStore({ configuration, request });
createCloudAdapters({ configuration, request, verifyAttestation, clock });
```

Configuration accepts original UTF-8 text or Uint8Array, at most 65536 bytes,
and returns a detached validated object. Unknown/duplicate keys at every depth,
invalid UTF-8, trailing data, arrays, coercions, unsafe identifiers and production
deny without echoing inputs. The CLI, not this parser, hashes original config bytes.

Exact configuration, all fields required:

```js
{
  schemaVersion: 1,
  targetId,
  environment: 'staging',
  policy, // exact policy shape in release-test-design.md
  projectId,
  region: 'us-central1',
  services: { web, api },
  runtimeServiceAccounts: { web, api },
  imageRepositories: { web, api },
  artifactBucket,
  stateBucket,
  stagingOrigin: 'https://staging.app.stara.co',
  executorServiceAccount,
  loggingProjectId
}
```

All cloud identifiers are private operator configuration, not dispatch input.
Project/bucket/service names use canonical safe GCP forms; service names and
runtime identities differ by component. Runtime service accounts belong to the
target project. Artifact repositories use the configured delivery project,
`us-central1-docker.pkg.dev`, and explicit repository/image paths without tags or
digests. `loggingProjectId` identifies that delivery project. Buckets differ;
the state bucket is target-owned. The exact staging origin has no port, path,
query, credentials or fragment. Config contains neither credentials nor key data.
Factories validate and detach configuration so mutation after construction cannot
change authority. Core target IDs remain supported; slash/dot traversal is denied.

The parent additionally fixed policy repository `1363262992`, checks/release
workflow references under `stara-labs/stara` at main, and all four required target
names. Empty/duplicate job lists deny; additional reviewed required jobs are
allowed. Fixtures use the actual four scaffold jobs and two image jobs defined
by the target root. Cloud Run preservation tests explicitly exclude output-only
container `buildInfo`, while retaining writable resources and other runtime data.

The preactivation P1 correction adds a REQUIRED third manifest run identity,
`runs.codeql = {id, attempt}`, distinct from scaffold and images, and a REQUIRED
private policy entry:

```js
codeql: {
  workflowRef: 'dynamic/github-code-scanning/codeql',
  jobs: ['Analyze (javascript-typescript)', 'Analyze (actions)']
}
```

This raw workflow reference is the parent's final chosen interface. It supersedes
the verifier's earlier normalized-prefix/main-suffix proposal; it is not a claim
that GitHub has a matching checked-in YAML file. The native workflow ID remains
independently fixed to `355366692` and the native path to the same raw dynamic
path. Missing CodeQL policy/run data is ineligible; there is no old-manifest
compatibility fallback. Existing source/target/security checks remain intact.

The injected HTTP function is async:

```js
request(url, {
  method, // GET, POST or PATCH, always explicit
  headers,
  body, // JSON object for cloud APIs; original bytes/text for object uploads
  signal,
  responseType: 'json' | 'bytes',
}); // -> { status: integer, headers: plain object, body }
```

`json` responses contain already parsed service response objects. `bytes`
responses contain original UTF-8/object bytes. Response headers are matched
case-insensitively. The transport owns authentication and disables automatic
redirects. Adapters reject 3xx; hostile service URLs, pagination URLs, operation
names and revision names are never followed. HTTP error bodies, token strings
and private canaries must not enter thrown diagnostics or logs.

`clock = { now: () => epochMilliseconds, sleep: async milliseconds => void }`.
The adapter methods and result shapes are exactly the core interface. Every
operation receives `targetId`, `receiptId`, `signal`, and absolute `deadline`.
`notify` additionally receives the admitted `sourceSha`; the parent must forward
it from the validated dispatch through the existing core call. Other core notify
arguments may be present but are not serialized into the public/sanitized event.
No application dispatch value can select an HTTP host, project, identity or command.

## Storage and Evidence

Use Google Cloud Storage JSON API media reads:
`https://storage.googleapis.com/storage/v1/b/{bucket}/o/{encodedObject}?alt=media`.
Fixed objects in the artifact bucket are:

- `manifests/{manifestSha256}.json`, at most 65536 original bytes.
- `attestations/{attestationSha256}.jsonl`, at most 1 MiB original bytes.
- `coverage/{sourceSha}/{scaffoldRunId}-{attempt}.json`, at most 1 MiB; its JSON
  content is the exact coverage array from the core evidence contract.

Attestation bytes are SHA-256 checked before verification. Manifest bytes are
returned unchanged for the core's hash-before-parse validation. Size limits apply
to received bytes regardless of absent or deceptive Content-Length. JSON coverage
rejects duplicate keys, malformed input and missing or synthetic success fields.

The approved P2 store exposes `read(targetId, receiptId)` and
`transact(targetId, receiptId, async state => ({ state, value }))`. It owns
`targets/{targetId}.json` and `receipts/{receiptId}.json` in the configured state
bucket. The archive body is the terminal receipt itself, not an extra envelope.
Missing (404) target state is
`{lock:null,receipts:{}}`; other read failures are not an empty state. Media reads
use the `x-goog-generation` response header as the CAS generation. Existing
generation values remain decimal strings, including values larger than 2^53.
Only a missing target permits its create-if-absent write. Archive writes always
use `ifGenerationMatch=0` and may never overwrite an existing object.

A pure callback returning structurally unchanged active state must return its
value without POST/CAS, generation increment or state rewrite. The dedicated
duplicate-running-receipt fixture verifies this separately from the core's
in-memory transaction behavior. Persisted target state contains at most one active
receipt. Read/callback views contain that active receipt plus the addressed
historical receipt, at most two; hydrated history never enters target persistence.
A historical no-op writes nothing even though that logical view differs from the
stored target. Historical mutations and successor mutation/eviction through a
historical transaction deny. Matching active state is authoritative over any
provisional terminal archive, including running/reconciliation state.

Writes use POST to `/upload/storage/v1/b/{bucket}/o` with `uploadType=media`,
encoded `name` and `ifGenerationMatch`. A transaction rereads and reruns its pure
callback only after a known HTTP 412 conflict. Stop after three such conflicts
(three attempted writes), with no fourth attempt. A timeout, thrown transport
error, 5xx or ambiguous write response stops immediately; it cannot authorize
replay. Failed callbacks do not write. The callback's returned value is exposed
only after the conditional write succeeds. State is detached and survives store
recreation; independent store instances must not lose concurrent accepted updates.
The store accepts only individually bounded (1 MiB), valid JSON target/archive
objects; it rejects malformed/duplicate-key state, absent generation, mismatched
receipt/body/target identities, and more than one persisted receipt. Aggregate
historical archive bytes may exceed that per-object bound.

Terminal finalization with a null lock first creates the immutable archive, then
conditionally clears the bounded target. Uncertain/pending/reconciliation state
with a non-null lock stays in the target. An archive 412 requires a bounded read
and exact comparison with the frozen upload bytes: JSON equivalence with changed
whitespace is insufficient. A known release CAS 412 permits a bounded reread and
retry only for compatible ownership and material base state. Terminal bytes and
the returned terminal result remain frozen even if a callback clock advances.
Changed ownership, intent, reconciliation state or a successor prevents release.
Ambiguous archive/CAS responses halt without replay; a lost release acknowledgement
does not imply the remote lock was retained.

The independent verifier supplied six simulated durable-prefix cases, now authored:

1. Before archive write: active intent survives recreation; duplicates and failed
   callbacks write nothing and cannot invent terminal success.
2. Archive committed, response lost: one archive mutation, no release CAS; active
   state remains authoritative after recreation.
3. Archive acknowledged, crash before release: provisional archive cannot release
   or hide active state; explicit compatible finalization needs exact-byte 412 proof.
4. Release CAS 412: frozen bytes survive compatible generation changes; material
   changes deny, and three conflicts stop without a fourth target mutation.
5. Release CAS committed, response lost: report uncertainty, including when a
   successor has already acquired the target; recovery reads without blind writes.
6. Historical duplicate after successor admission: selected terminal result is
   hydrated without changing the successor's lock, intent, bytes or generation.

The history fixture seeds 400 individually bounded terminal archives whose combined
bytes exceed 1 MiB. Beginning/middle/end duplicates require only addressed objects,
never enumeration or accumulated history. A fresh admission/finalization and an
old duplicate during its active lock retain the bounded target representation.
These are client protocol simulations, not proofs of GCS atomicity or IAM.

`collectEvidence` independently reads the fixed GitHub repository, main head,
each exact run/attempt and jobs, and raw stored coverage. GitHub API paths derive
from the configured repository/workflow roots, not response URL fields. A
current-main mismatch, failed or incomplete run/job, wrong repo/attempt/path,
missing coverage or selected-only coverage must deny either in the adapter or
when passed to the real core validator. No status or percentage is synthesized.
Pagination must be completed within bounds or explicitly denied, never reported
as a complete successful job inventory. Foreign pagination links are rejected.

Every collection reads all three current runs at `/actions/runs/{id}` as well as
their exact `/attempts/{attempt}` and `/attempts/{attempt}/jobs` endpoints. Current
metadata must match manifest ID/attempt, source, main branch, push event, repository
and successful completion. Current CodeQL native workflow ID/path must match the
fixed trust root, and the fixed workflow metadata endpoint is independently read.
A newer failed/in-progress/cancelled attempt invalidates eligibility even when
the old exact-attempt endpoint and jobs still report success. Both JavaScript and
Actions analysis jobs must be present exactly once and successful; missing,
duplicate, wrong-run/attempt/source or partial inventories deny.

The fixtures keep current-run responses separate from historical-attempt responses
to prove this distinction. Repeated adapter collection rereads current CodeQL and
denies a newly failed attempt or analysis job; no cached admission snapshot may
stand in for the pre-traffic collection. The core author owns the separate proof
that failure at that check prevents traffic mutation. This is observed eligibility
at a check, not an atomic guarantee against later GitHub changes.

The verifier's separate proposal to reject a completely different newer run ID
via exact-SHA workflow inventory was held through the P2 store freeze. The parent
subsequently authorized the bounded selection contract below. Earlier same-ID
attempt tests and green evidence do not cover this later distinct-ID correction.

### Latest CodeQL Run Selection

The adapter author, Ampere pipeline author and Kant verifier agreed on one native
REST inventory request, without changing manifests or normalized evidence:

```text
GET /repos/stara-labs/stara/actions/workflows/355366692/runs
    ?head_sha={manifest.sourceSha}&branch=main&event=push&per_page=100&page=1
```

Query order is immaterial; these five parameters are fixed. No status, conclusion,
actor or date filter may hide a newer unsuccessful run. The response is
`{total_count, workflow_runs: [...]}`, with the normal native run identity/scope
fields plus `run_number`. Normal additional GitHub fields remain allowed. Require
an integer count from 1 through 100, exactly that many entries, and no next-page
link or incomplete/ambiguous result. This bounded implementation denies larger
inventories rather than enumerating additional pages.

Validate every entry's canonical positive run ID, positive safe-integer attempt,
workflow ID `355366692`, raw dynamic workflow path, repository/head-repository IDs,
exact source SHA, main branch and push event. IDs must be distinct. Select the
unique greatest positive safe-integer `run_number`, never greatest run ID, array
order or an older successful entry. GitHub documents run_number as incrementing
for each new run of a particular workflow; run_id identifies a run without a
documented chronology guarantee. See the
[official variables reference](https://docs.github.com/en/actions/reference/workflows-and-actions/variables).

Only the selected entry must be completed/successful; an older failed entry does
not disqualify a newer successful selected run. The winner's ID/attempt must equal
`manifest.runs.codeql`, not silently replace it. Current-run and exact-attempt
responses must still match that identity and selected ordinal, and existing
active-workflow metadata and exact successful job checks remain mandatory.
Native `run_number` is internal selection evidence only; it is not added to
manifest, normalized core evidence, provenance or CLI wire schemas.

Each collection repeats this inventory read, including the pre-traffic collection.
A separate newer queued/failed/cancelled run therefore blocks the stale manifest
even while its current/historical endpoints continue to report success. This is
an eligibility observation, not an atomic guarantee against later GitHub changes.
Adapter tests prove repeated collection; executor tests own traffic sequencing.

`verifyProvenance` downloads and hashes the fixed attestation object and invokes:

```js
verifyAttestation({
  bundle, // original bytes
  imageDigest,
  sourceSha,
  repositoryId,
  workflowRef,
  runId, // manifest.runs.images.id: canonical positive decimal string
  runAttempt, // manifest.runs.images.attempt: positive safe integer
  // signal/deadline and other reviewed verification context may be included
});
```

The callback returns trusted verification facts in the core contract shape. The
real core validates every returned identity; false/mismatched/absent verification
denies. The adapter cannot replace this callback with manifest assertions. The
parent's GH CLI/signature bridge needs separate verification; injected fixtures
here are not real cryptographic attestations.

The returned facts must now include REQUIRED flat `runId` and `runAttempt`, derived
by the transport from the verified certificate's run-invocation URI and compared
to the image manifest run. These fields must not be copied into absent/mismatched
verification output to make it pass. Tests reject another same-SHA run, another
attempt, a CodeQL run, missing fields and type coercions. The earlier proposed
nested `imagesRun` provenance field is superseded; nested manifest identities
remain unchanged. The Hume transport author owns actual certificate derivation.

## Cloud Run and Probes

Use `https://run.googleapis.com/v2/` with exact configured project/region/service
names. `createRevision` reads the service and etag, then sends one guarded PATCH
to the template using configured repository plus validated digest and configured
runtime account. Traffic remains pinned to existing explicit revisions; a LATEST
allocation must be resolved from observed trafficStatuses before a template update.
No latest-revision traffic switch is implicit in revision creation. Preserve
the observed template's safe runtime settings. Follow only local long-running
operation names; a returned foreign name after mutation is an unknown outcome.

`waitReady` reads only the selected component's named revision and requires an
explicit succeeded Ready condition. It may poll in-progress states, using
clock.sleep, until the original deadline; failed/missing states are not ready.
`readTraffic` returns web/API observed allocations. `switchTraffic` rereads the
service for its current etag, PATCHes only traffic to 100% of the explicit named
revision, and waits for a bounded operation result. No LATEST target or blind
mutation retry is allowed. Operation and revision response names remain scoped.

Only side-effect-free transient read failures receive `TRANSIENT_READ`, and the
core owns their retries. Explicit rejected mutation responses (for example 400,
403 or 412) receive `NO_EFFECT`. Timeout/5xx/unknown mutation outcome receives
`UNKNOWN_OUTCOME`, without replay. Polling is not permission to reset deadlines.

`probe` calls IAM Credentials `projects/-/serviceAccounts/{executor}:signJwt`.
Payload binds `iss` and `sub` to the configured executor, audience to the configured
staging origin plus `/*`, current iat and an exp no more than five minutes away
and no later than the remaining operation deadline. No local private key or
long-lived token is accepted. The signed JWT is sent only to that staging origin.
Probe checks HTTP 200 and exact health/runtime-config JSON, plus an HTML root
with an app mount and same-origin module asset. Referenced JS/CSS are fetched
from the same origin and must be nonempty with the expected media type. Invalid,
cross-origin, redirect, empty or HTML-as-JS assets do not produce `{ok:true}`.
These are adapter simulations, not live IAP acceptance or visual QA.

## Corrective Notification

`notify` POSTs to `https://logging.googleapis.com/v2/entries:write`, using only
the configured delivery logging project. The one entry has structured jsonPayload
exactly `{event:'release_terminal',status,receiptId,sourceSha}` and deterministic
nonempty `insertId` for the same receipt/status. Transport metadata such as
logName, severity and monitored resource may accompany it. Unknown/raw diagnostic
input, authorization and token data are not serialized. Terminal statuses are
succeeded, failed, degraded or reconciliation_required; running/unknown denies.

Logging acknowledgement means submitted only. Private Terraform-managed Cloud
Monitoring links the terminal-failure condition to an owner email channel. These
tests do not assert an incident/email was delivered, and the adapter must not
claim it created a GitHub issue. A failed/ambiguous log write is not successful
notification and is not blindly retried. Monitoring autoClose is not recovery;
operator reconciliation or a reviewed forward-fix PR is still required.

## Red Evidence and Limits

Focused command from repository root:

```sh
pnpm --dir tooling exec vitest run tests/release-adapters.contract.test.mjs --reporter=verbose
```

The suite loads the real adapters module only inside collected tests. An absent
module produces a clear missing-implementation failure before the behavioral
scenario executes. Negative cases cannot pass by treating that absence as their
expected denial. All injected traffic is synthetic; real fetch/network is disabled.
Logs/results and before/after source/test SHA-256 manifests are captured only in
ignored `.artifacts/release-adapter-test-author/`. The selected red run does not
establish 90/85 whole-target coverage. The independent verifier must later run
complete tooling coverage with all `release/**/*.mjs` in its denominator.

Initial pre-implementation red was captured at
`red-2026-09-11T00-44-12-713Z`: 231/231 missing-module failures, no skips or
source drift. Initial test SHA-256:
`602d0be4a226a653d346afb7eb080066a0386f7f9ac8a7b02ca20b3d8d995dcf`.
The parent's final policy/readonly-template refinements produced a second red at
`red-2026-09-11T00-46-20-825Z`: 240/240 missing-module failures, no skips or
source drift. Current test SHA-256:
`a0e9c1592a5db2ac21232adc0988b3013c9fddf81bb7b0c0aac928784e48aa53`.
Both captures precede parent adapter implementation and remain immutable lineage.
The parent subsequently reported 240 passes; final verification needs a fresh
source-hashed execution, not reinterpretation of the missing-module red.

Before the P1 correction, the author independently captured 240/240 green at
`green-2026-09-11T00-58-46-215Z`, no drift. Initial third-kind/provenance red is
`red-2026-09-11T01-14-18-997Z`: 287 cases, 75 passed, 212 failed, no skips/drift.
The final current-run/no-op correction red is
`red-2026-09-11T01-16-25-627Z`: 305 cases, 75 passed, 230 failed, no skips/drift.
Its test SHA-256 is
`5a8aab44f2e4b3daa298fdcbe8db1f513931ee14e849c2b57c913f249aceedc6`.
Most new scenario failures occur before HTTP execution because the implementation
still rejects the newly required third policy kind. Do not describe those failures
as already executed authorization/HTTP denial cases. Parent implements; Ampere/
Locke and Hume own their disjoint core/transport fixtures. Their coordination
confirmed the raw CodeQL reference and flat provenance fields.

The approved P2 API migration plus 59 new archive cases produced independent red
at `red-2026-09-11T01-25-00-945Z`: 364 cases, 297 passed, 67 failed, no skips or
source drift. Frozen test SHA-256:
`e0f72449c58e3a7239cb5d4f921cdaf84ae25b91fe10982d52e14a6a6a70337f`.
All 275 non-store cases passed on that snapshot. Existing CAS cases were 18/30
passing; new archive cases were 4/59 passing. The old two-argument transaction
implementation blocks callback/mutation execution, and historical reads omit the
selected archive. These results establish interface/behavioral gaps, not execution
of the new crash paths. In particular, incidental denial passes do not establish
the new persisted-state validation. Parent implementation and fresh independent
verification remain necessary. Formatting and focused ESLint passed. Earlier P1
red evidence is unchanged and does not cover these later P2 additions.

After parent store implementation, independent green was captured at
`green-2026-09-11T01-27-32-686Z`: 364/364 passed, zero failed/skipped and no
source drift. The frozen test SHA-256 remains exactly
`e0f72449c58e3a7239cb5d4f921cdaf84ae25b91fe10982d52e14a6a6a70337f`;
implemented adapter SHA-256 is
`c1add23f209d37f99f871cc865d2f9fe01cd179355194ceb7f005e87cfb44291`.
The red-to-green manifests differ only in `tooling/release/adapters.mjs` and
the two author evidence documents; no captured test/core/control fixture changed.
All 59 archive scenarios and 30 existing CAS scenarios now execute successfully,
alongside 275 non-store cases. Required callback, archive-write, release-CAS,
recovery-state and byte-comparison assertions distinguish this execution from
the old-interface red. The author reviewed the corresponding store paths for
active precedence, immutable archive barriers, frozen conflict retry and
historical no-op persistence. Focused test ESLint passed. No test expansion or
assertion correction was needed. This is synthetic client-protocol evidence;
it does not close the verifier's finding or replace full tooling coverage,
independent implementation review, hosted execution or live cloud evidence.

At handoff, current test and adapter hashes still match that green snapshot; no
known defect in the frozen fixtures requires a correction. This is not a blanket
P1 clearance. Kant's independent re-review of the same adapter hash reports that
an older successful CodeQL run remains accepted when a separate newer failed run
ID exists, because collection does not query the fixed workflow's run inventory.
The newer-attempt/same-ID case denies correctly. This is the distinct-run-ID
limitation already recorded above, now reproduced by the verifier, not a new
author-executed test or covered case. Its selection-policy change remains outside
the then-frozen scope pending parent direction. The later approved correction and
its separate red are recorded below. Parent owns full repository coverage; this
author has not duplicated it.

Kant subsequently closed the original P2 unbounded-target-history finding on
adapter hash `c1add23f209d37f99f871cc865d2f9fe01cd179355194ceb7f005e87cfb44291`.
He reviewed the store source, frozen 59 archive assertions and author green report
without rerunning that suite. His separately reported in-memory probes exercised
production store/executor response-loss recovery, compatible release CAS 412,
reconciliation-conflict preservation, and 400 executor-shaped terminal archives
totaling 1,168,000 bytes followed by a fresh successful execution with a 27-byte
durable target. He also reported a production CLI/transport/executor/store active
duplicate returning exit 0/running with no POST or deployment adapter invocation.
These are verifier-reported results, not additional author test executions. The
closure is limited to that P2 finding; the distinct-CodeQL-run-ID P1 remains open.
Neither the probes nor the closure establish live GCS/IAM or full coverage. Tests
and adapter hashes remained unchanged when this review note was recorded.

The parent subsequently approved focused tests for that remaining P1 finding.
Independent red `red-2026-09-11T01-38-41-538Z` contains 417 cases: all 364 prior
cases pass, all 53 new latest-inventory cases fail, with no skips or source drift.
New frozen test SHA-256:
`19e42fb54f2bff4d3a2cc016a87a064a9970ada1a8a23754047bf36410da9a8a`.
Adapter source is unchanged from P2 green:
`c1add23f209d37f99f871cc865d2f9fe01cd179355194ceb7f005e87cfb44291`.
Formatting and focused ESLint pass. Production configuration/code were not edited.

The new independent inventory fixture is detached from both current and historical
run responses. Positive cases require an actual inventory read, including reversed
order, a larger-ID/lower-ordinal older failure, and a complete 100-entry result.
Negative cases reproduce newer failed/pending/cancelled/unbound-successful run 104
against successful manifest run 103; refreshed collection, invalid ordering/scope,
duplicate IDs, ambiguous maximum, changed attempts/ordinals, partial counts,
101-entry results, pagination links and failed inventory reads also deny. In this
red the implementation omits the inventory entirely: positives fail the required
read assertion, and stale/malformed-inventory cases incorrectly return success.
These are actual adapter-execution failures, not missing-module/interface failures.
The previously recorded 364-case green and P2 closure remain valid for their
earlier scope; they cannot be cited as latest-CodeQL-selection verification.

After parent implementation, independent latest-selection green is
`green-2026-09-11T01-42-18-461Z`: 417/417 passed, no failures/skips or source drift.
Test SHA-256 remains frozen at
`19e42fb54f2bff4d3a2cc016a87a064a9970ada1a8a23754047bf36410da9a8a`;
implemented adapter SHA-256 is
`dc16afc3891e7723c81c28df74c38b7e38318137368a32d9c1b39d9f0a2e5f8e`.
The 53 new inventory cases now pass alongside all 364 prior cases, without any
test correction. Between the red and green manifests, `adapters.mjs`, separately
owned `pipeline.mjs`, and this evidence document changed; captured test/core
fixture hashes did not. The author also read the implemented bounded selection
and current/exact ordinal checks. No protected test edits, production edits by
this author, broad test expansion or duplicate full-coverage run were performed.
Evidence and hashes were sent to Kant for independent reproduction reversal and
P1 closure review. This author does not self-close that finding or claim live
GitHub, hosted workflow, IAM or full repository coverage from this selected run.

Kant subsequently closed the latest-CodeQL P1 finding on adapter hash
`dc16afc3891e7723c81c28df74c38b7e38318137368a32d9c1b39d9f0a2e5f8e`
and pipeline hash
`2dd5980a910a2558575eabf0367d9001ada904f3e679fae65c93563b894d1bd2`.
His independent in-memory reproduction of old run 103 success with newer run 104
failure now rejects. He reported nine paired scenarios covering pending/cancelled
successors, newer successful selection versus stale private manifest identity,
counter-ordered IDs, tied ordinals, incomplete counts and current attempt/ordinal
mismatches, plus exact query parameters. Post-probe hashes were unchanged. These
are verifier-reported probes, not additional author suite runs. The earlier P2
archive closure remains retained. The verifier explicitly leaves the GH HIGH
preactivation blocker and Sigstore moderate remediation separate; these finding
closures do not authorize activation or establish live-cloud acceptance.

Live IAM, GCS atomicity, real GitHub evidence, signature verification, Cloud Run
rollout, IAP browser restrictions, Monitoring incidents/email and hosted execution
remain Not executed. No production edits, credentials, cloud operations, commits,
pushes or existing core-test edits belong to this assignment.

References: [Cloud Run PATCH](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/patch),
[GCS conditional insertion](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/insert),
[GitHub run/attempt API](https://docs.github.com/en/rest/actions/workflow-runs),
[IAP programmatic authentication](https://docs.cloud.google.com/iap/docs/authentication-howto).

Handoff conclusion: More journey evidence required.
