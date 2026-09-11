# Independent Release Pipeline Test Design

Author: independent release test author. Implementer: Locke. The parent owns
workflow, CLI, Compose, Playwright release configuration, and provider wiring;
Mencius owns cloud-adapter tests. A distinct verifier and responsible human
acceptance remain required. Base is `319c9bf8fb7c4bbc852497e5742f801f9015aec1`
on `feat/secure-releases`. This document does not amend REL-01 through REL-11.

The initial assignment owns `tooling/tests/release-pipeline.contract.test.mjs`,
this document, and ignored `.artifacts/release-test-author` evidence. The parent
later explicitly authorized the narrow additive snapshot harness and independent
coverage configuration correction recorded below. Existing test assertions,
requirements, production source and workflows are not edited by this actor.
No commit, push, merge or live publication is performed.

## Agreed Interface

`tooling/release/pipeline.mjs` has four pipeline exports plus the shared evidence
inspection export authorized after initial red. Denials throw sanitized
errors without original error causes, supplied values, HTTP response bodies,
scanner diagnostics or subprocess output. No function accepts a shell command.
Private raw evidence stays in the owned ignored directory; `runtime.output` may
emit only fixed stage/result names and numeric counts.

### Await Main Checks

```js
awaitMainChecks({ sourceSha, repositoryId, request, clock });
// -> {sourceSha, scaffold:{id,attempt}, codeql:{id,attempt}}
```

`sourceSha` is full lowercase Git SHA. `repositoryId` is a positive decimal
string. `clock={now:()=>epochMilliseconds,sleep:async milliseconds=>void}`.
`request(route,parameters)` is an injected Octokit-compatible GET transport,
returning `{data,headers?}`. Parameters always pin `owner:'stara-labs',repo:'stara'`
and carry `request:{signal,timeout}` bounded by the original 20-minute deadline.
No auth mutation, deployment permission, token minting or external destination
is part of this function.

Fixed GitHub roots, accepted from the parent's verified API observations:

| Purpose  | Workflow ID | Path                                  | Required Jobs                                                                                                                  |
| -------- | ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Scaffold | 354641209   | `.github/workflows/checks.yml`        | Candidate verification; Windows package verification; Container journeys; Required scaffold checks; Release image verification |
| CodeQL   | 355366692   | `dynamic/github-code-scanning/codeql` | Analyze (javascript-typescript); Analyze (actions)                                                                             |

Read the repository identity and current `refs/heads/main`; enumerate exact-SHA
main push workflow runs using these numeric workflow IDs. Fetch the selected
run and jobs for its exact `run_attempt`. API run fields are native GitHub fields:
`id,workflow_id,path,run_attempt,event,head_branch,head_sha,status,conclusion,
repository:{id,full_name},head_repository:{id,full_name}`. Jobs include
`id,name,run_id,run_attempt,head_sha,status,conclusion`. IDs from the API may be
safe integers or canonical decimal strings and are normalized to strings.

Both runs and every required job must be completed successfully. A newer attempt
cannot borrow successful jobs from an older attempt. Queued/in-progress runs may
poll, but failure/cancellation/skipping, duplicate or incomplete job inventories,
wrong workflow/repository/source/event/ref, unknown data and stale main deny.
Page complete job inventories or deny incomplete pagination; never promote on
one selected successful page. Recheck main before returning. Waiting and hung
requests consume the original 20 minutes; retries never reset this deadline.

The independently agreed latest-CodeQL correction permits multiple matching runs
without changing the manifest or exported `{id,attempt}` shape. For CodeQL only,
the fixed workflow query includes exact SHA, main branch, push event, `per_page:100`
and `page:1`, with no success/status filter. Require a complete nonempty inventory:
positive safe-integer `total_count`, exact array length at most 100, and no next-page
link. Incomplete or larger inventories fail closed without pagination expansion.
All entries must match the fixed workflow ID/path, source, branch, event and both
repository identities; IDs must be canonical and unique. Each native `run_number`
must be a positive safe integer. Choose its unique greatest value, independent of
run ID or response order; a tied greatest value denies. GitHub documents that
[workflow run numbers increment for each new run](https://docs.github.com/en/actions/reference/workflows-and-actions/variables),
whereas run IDs are identities, not the ordering authority.

Only the selected run must satisfy successful completion and required jobs; an
older failed run does not poison a newer successful run. Never fall back to an older
success when the newest fails or remains pending. Existing pending-run polling may
wait within the original 20 minutes, but persistent pending cannot return success.
Refetch the selected current run before its exact attempt and jobs, requiring
unchanged ID, attempt and run number across those native run responses. Job identity
and completion checks are unchanged. Scaffold retains its existing single-run
inventory behavior. Private-adapter selection and pre-traffic revalidation contracts
are separately authored by Mencius using this same CodeQL ordering rule.

### Verify Exact Images

```js
verifyImages({ sourceSha, mode, runtime, clock, trivyImage });
// -> {schemaVersion:1,sourceSha,mode,runId,images,evidenceDirectory,
//     receiptSha256,verified:true}
```

`mode` is exactly `ci` or `working-tree`. The injected runtime is the existing
`tooling/lib/process.mjs` `createRuntime` interface: `root,runId,env,run,git,pnpm,
fetch,output`. `run(executable,args,options)` returns `{code,stdout,stderr}`;
arguments are an array, shell execution is absent/false, and command timeouts
are positive and bounded by the remaining 25-minute overall deadline. CLI errors
must be caught and sanitized even though the reusable runtime preserves private
diagnostic details internally.

CI checks exact HEAD and a clean tracked/untracked working tree before and after
verification. The local mode explicitly records `working-tree` and is never
publishable. `runId` is lowercase `[a-z0-9][a-z0-9-]{0,63}`. Only a newly created,
non-symlink `.artifacts/release-pipeline/<runId>` directory is owned; an existing
directory fails before Docker work. Run project name is `stara-release-<runId>`.
Before Compose mutation, require empty read-only Docker inventory using
`docker ps --all --filter label=com.docker.compose.project=stara-release-<runId> --quiet`.
A preexisting project denies without up/down or container removal. This independently
reviewed post-red addition closes an ownership gap identified by the implementer;
fresh disk ownership alone does not establish Docker resource ownership.

Build each component once using its `UI/web/release.Dockerfile` or
`backend/api/release.Dockerfile`, repository-root context, an owned `--iidfile`,
and an explicit local tag. Record and inspect immutable local `sha256:` image IDs.
`images={web:{imageId,tag},api:{imageId,tag}}`. Compose must run these image IDs
through `tests/e2e/release.compose.yaml`, with `STARA_RELEASE_WEB_IMAGE` and
`STARA_RELEASE_API_IMAGE` set to those IDs, without `--build`. Services are api,
web and gateway. Port is validated `runtime.env.STARA_RELEASE_PORT`, default 8173.
Prepare the separate Compose gateway on a cold Docker daemon by pulling only
`nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce`
before Compose. BuildKit having used the base image does not establish that the
gateway is present in the engine's image store. This exact infrastructure image
pull does not permit application image pulls or replacement of the built IDs.
The parent replaced the Trixie gateway pin after actual-image run
`local-release-20260911-c` passed 69 browser cases and four secret scans but failed
the HIGH/CRITICAL vulnerability gate. This is an approved image-input correction,
not suppression of findings; all severity gates and the no-ignore policy remain.
Actual scanning and image verification of the replacement remain required.
Only `http://127.0.0.1:<port>` is used; external base-URL overrides cannot redirect
the probe or browser journey.

After bounded `compose up --wait`, real uninjected-by-Playwright HTTP probes check
GET `/api/health` HTTP 200 exactly `{status:'ok'}` and GET `/api/runtime-config`
HTTP 200 exactly `{schemaVersion:1,environment:'staging'}`. Then run
`pnpm exec playwright test --config tests/e2e/release.config.ts`, using that same
loopback `STARA_E2E_BASE_URL`. A JSON Playwright report is written to the owned
`browser.json` using `PLAYWRIGHT_JSON_OUTPUT_NAME` and CLI reporter selection.
`STARA_E2E_RUN_ID` is exactly `run-release-${runtime.runId}`, accepted by the
existing `tests/e2e/artifact-run.ts` `artifactPaths` contract. The author imports
that actual helper in the regression; its naming rule is not replaced or relaxed.
No browser project filter is allowed. Require a complete successful report with
at least one expected test, zero unexpected/flaky/skipped outcomes and no errors.

`trivyImage` must equal the parent's resolved approved pin exactly:
`aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969`.
An arbitrary digest at an allowed host, tag alone or alternative registry denies.
Run the pinned scanner against saved bytes of each exact built image, including
layers (`image --input`, scanners vuln and secret, HIGH/CRITICAL blocking), image
metadata, and frontend/public files extracted from the exact web image.
Image archives, metadata, extracted files and JSON outputs stay private. Never
mount the whole workspace or a Docker socket into the scanner. Scanner outputs
are read from owned paths and validated, not inferred from exit zero alone.
Any secret, HIGH/CRITICAL vulnerability, malformed/missing report or nonzero
scanner exit fails verification. Raw details must not enter public output.

Trivy 0.74.0 legitimately omits `Results` for a clean filesystem report, as its
[pinned report definition](https://raw.githubusercontent.com/aquasecurity/trivy/v0.74.0/pkg/types/report.go)
declares `json:",omitempty"`. The parent actual-image run's metadata and public-file
reports independently exhibited that format. The narrow exception requires exactly
the six root fields `SchemaVersion,Trivy,ReportID,CreatedAt,ArtifactName,ArtifactType`:
schema 2, exactly `Trivy:{Version:'0.74.0'}` with no nested extras, lowercase canonical
UUID, valid UTC ISO timestamp (impossible/rolled-over dates deny)
(including Go's one-to-nine fractional digits), type `filesystem`, and artifact name
exactly `/evidence/metadata` or `/evidence/public-files` for its respective fixed
report filename. It is not accepted for either image report, and a bare missing
`Results` remains malformed. Present findings still fail at every required severity.
The expected report filename is carried through receipt revalidation/publication.
Metadata is not a signature: trust remains the pinned scanner command and successful
exit, owned paths, original report bytes and receipt hashes. Replacement-image live
scan evidence remains separate from these synthetic format contracts.

Reports have stable local filenames `browser.json`, `web-image-scan.json`,
`api-image-scan.json`, `metadata-scan.json`, `public-files-scan.json`. Scanner
reports are native Trivy JSON (`SchemaVersion:2,Results:[...]`). The immutable
`verified.json` receipt is written only after all checks and cleanup succeed:

```js
{
  schemaVersion:1,sourceSha,mode,runId,images,verified:true,
  reports: {
    browser:{path:'browser.json',sha256},
    webImage:{path:'web-image-scan.json',sha256},
    apiImage:{path:'api-image-scan.json',sha256},
    metadata:{path:'metadata-scan.json',sha256},
    publicFiles:{path:'public-files-scan.json',sha256}
  }
}
```

Return `receiptSha256` over original receipt bytes. All report paths are fixed
relative paths, hashes lowercase SHA-256. Total receipt/report bytes are bounded;
receipt at most 64 KiB, each report at most 16 MiB. Missing, duplicate, unknown
receipt keys and symlink/traversal paths deny. Reports are hashed after writing.

Cleanup always addresses this run's exact Compose project/file and only extraction
containers successfully created by this run. Never run prune, volume deletion,
global down, or cleanup of a collision/preexisting resource. Preserve original
failure if cleanup also fails; cleanup failure itself prevents a verified receipt.

### Inspect Recorded Evidence

`checkImageEvidence({runtime,verified})` returns exactly `true` or throws a sanitized
error. It reuses publication's owned-disk receipt/report validator, including byte
hashes, original returned source/run/image bindings, fixed paths, size bounds,
symlink denial and successful report contents. Both `ci` and `working-tree` receipts
are accepted for this nonpublishing inspection. It performs no command, network,
rebuild, re-scan or publication operation. CI clean-HEAD and live local-image-ID
checks remain additional publication gates. Inspection is not new verification.

The independent Windows run reproduced 89 passing pipeline tests and one `EPERM`
while creating the file-symlink fixture, before production code ran. The author
corrected that fixture to use a Windows evidence-directory junction preserving all
original receipt/report bytes. POSIX retains the report-file symlink scenario.
Neither branch is skipped; both demand denied linked evidence and no publication.
Actual report-file symlink execution on a capable POSIX host remains separate
evidence, not a claimed Windows result.

### Publish Verified Candidate

```js
publishCandidate({
  verified,
  checks,
  coverage,
  imagesRun,
  repositoryId,
  runtime,
  registry,
  storage,
});
// -> {manifest,manifestSha256}
```

`checks` is the awaitMainChecks result. `imagesRun={id,attempt}` uses the current
GitHub Release images run identity. `coverage={path,sha256}` references an owned
private file, at most 1 MiB, whose JSON envelope is exactly
`{schemaVersion:1,sourceSha,runId,runAttempt,coverage:[...]}`. Envelope run/attempt
bind the scaffold result; each complete target record matches the core coverage
contract and source. All four targets meet 90% lines and 85% branches. Uploaded
coverage content is the exact validated array, retaining each record's source.
The parent-owned `coverage-export` CLI generates this envelope from actual complete
coverage summary files after the full run. Publication downloads the exact immutable
Scaffold Actions artifact into this pipeline's private evidence directory. CLI and
transport authors must test summary provenance and artifact identity; this suite's
synthetic coverage envelope cannot prove a full coverage run happened.

Publication is target-neutral and does not accept `configurationSha256` or require
target configuration to exist. Requiring it would create a bootstrap cycle when
target configuration depends on the verified images. This independently reviewed
technical correction leaves `configurationSha256` mandatory for strict dispatch
and the private executor; publishing an artifact does not authorize deployment.

Reopen the fixed owned `verified.json`; check its original byte hash, every fixed
report hash and successful report contents, and exact equality of all returned
source/run/image fields. `verified:true` supplied only in memory is insufficient.
Reject local mode, changed source, dirty tree, stale IDs, outside/symlink evidence,
and source/check/coverage/CI identity mismatch before any external mutation.
CI environment is exact `GITHUB_EVENT_NAME=push`, `GITHUB_REF=refs/heads/main`,
`GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_REPOSITORY_ID`, and
`GITHUB_REPOSITORY=stara-labs/stara`.

`registry={web,api,attest}` contains trusted repository refs at
`us-central1-docker.pkg.dev/<project>/<repository>/<image>`, without tags/digests.
Tag/push the existing verified image IDs only; never rebuild, pull replacement
application images, or promote a mutable local tag without checking its ID.
Origin tags are `sha-<sourceSha>-run-<imagesRun.id>-<imagesRun.attempt>`.
Inspect the pushed refs, requiring unchanged local image ID and canonical digest
in that exact repository. Both image pushes must succeed before manifest upload.

Signed provenance is an injected trusted operation, not generated success JSON:

```js
registry.attest({ component, subjectName, subjectDigest, sourceSha, runId, runAttempt, runtime });
// -> {bundle:Uint8Array,verification:{verified:true,sourceSha,repositoryId,
//     workflowRef,imageDigest,attestationSha256,runId,runAttempt}}
```

The bridge uses actual `@actions/attest` 3.2.0 `attestProvenance` and GH 2.100.0
`verifyBundle`, returning original JSON bundle bytes. Callback `subjectName` is the
private configured OCI repository input, but the public statement subject is exactly
`stara/web` or `stara/api`, derived from component and digest. The bridge supplies the
private OCI reference separately as `imageRepository` during verification and checks
the canonical public statement subject explicitly; digest verification alone is not
enough. Public bundles must not disclose GCP project/repository target inventory.
Public certificate GitHub identities are inherent public provenance, not secrets.
These SDK/transport assertions belong to the separate transport author. Exact bundle
bytes are hashed; trusted verification must match that hash, image digest, source,
repository and `stara-labs/stara/.github/workflows/release.yml@refs/heads/main`.
It also supplies the certified positive-decimal `runId` and positive-safe-integer
`runAttempt`, exactly matching `imagesRun.id/attempt`. The bridge derives these from
the verified certificate run invocation URI; same source/digest in another run or
attempt is not equivalent proof.
Missing/failed/substituted verification or empty/oversized bundles deny. Tests use
labeled synthetic bytes and cannot prove real signing authority.

`storage.put({key,bytes,ifAbsent:true})` creates immutable publisher-owned objects
and returns `{created:true}`; rejected/ambiguous writes are not retried blindly.
Use `attestations/<hash>.jsonl`, `coverage/<source>/<scaffold-id>-<attempt>.json`,
and finally `manifests/<hash>.json`, matching the cloud-adapter contract. Manifest
uses the strict core schema, exact scaffold/images run IDs and observed digests;
`manifest.runs.codeql` is also required and equals `checks.codeql`, with all three
run IDs distinct. Core evidence requires all three workflows; the private CodeQL
policy uses raw `dynamic/github-code-scanning/codeql` with both required Analyze
jobs, and adapters verify its native ID 355366692 plus current and exact-attempt
metadata independently. No old two-run manifest can authorize dispatch.
hash its original bytes and call the real core parser. Never upload local receipt,
scanner reports, image metadata, diagnostics, coverage envelopes or arbitrary
extra files. These are private candidate objects, not public GitHub raw artifacts.
No Cloud Run, IAM, Secret Manager or executor-state operation is allowed.

### Dispatch Completed Images Workflow

```js
dispatchCandidate({ event, repositoryId, request, publish, topic, manifest, configurationSha256 });
// -> strict four-field dispatch
```

`event` is the GitHub workflow_run webhook object, with `action:'completed'`,
`repository:{id,full_name}`, and `workflow_run`. Ignore URL-like event fields.
Independently refetch workflow `.github/workflows/release.yml` (`Release images`),
the event's exact run/attempt and its completed successful required jobs
`Verify release images` and `Publish verified images`. Require push/main, exact
source, numeric repository identity and current main. Do not trust webhook
conclusions or a partially complete publishing workflow. Manifest source and
images run/attempt must match this observed run; the core parser validates bytes.

`manifest` is a `Uint8Array` containing the original downloaded UTF-8 manifest
bytes (`Buffer` is valid), not a parsed object or publish result. Hash those exact
bytes, including whitespace, and validate with the core parser. The CLI must not
parse/reserialize before calling this function.

`topic` is trusted fixed configuration `projects/<project>/topics/<topic>`.
Reject destinations supplied as extra dispatch options; payload never supplies
topic/project/configuration authority. Invoke exactly once:
`publish({topic,data:base64(originalStrictDispatchJSON)})`. Dispatch contains only
`schemaVersion:1,sourceSha,manifestSha256,configurationSha256`. Never publish raw
webhook, manifest, URLs, approvals, credentials, commands or Cloud Run controls.
Transport failure rejects without echo or blind publish retry. The private
executor provides duplicate-delivery idempotency, not this public signal sender.

The injected 25-minute deadline belongs to `verifyImages` only; receipts do not
carry temporal publication authority. The publisher job's outer limit is 40 minutes:
25 for image verification plus up to 15 for authentication, publication and evidence.
The PR image job allows 30 minutes including setup, and prerequisites allow 25
minutes including the bounded 20-minute API polling phase. Publication and dispatch
independently bound their own operations from invocation using real time, without a
new clock argument. None resets the private executor's original 30-minute deadline.
These are ceilings, not measured typical durations or a claim of normal 10-minute
delivery.

## Evidence and Protection

Requirements covered: REL-02/03 exact source, image identity and trusted evidence;
REL-04 absence of production/deployment authority; REL-09 real image config probe;
REL-10 confidential evidence; REL-11 bounded polling, scoped cleanup and denied
uncertain publication. Live IAM, real signatures, Docker/scanner correctness,
real-image browser matrix and merged-main delivery require distinct execution
evidence. Injected command/HTTP fixtures prove control behavior only.

No old protected tests are changed. Test corrections require this independent
author's review and renewed hashes/evidence. No weakening assertions, skipped
cases, narrowed job sets, selective image verification, reduced coverage or
untested inline YAML control logic. All pipeline production source remains in
the complete tooling 90%-line/85%-branch coverage denominator.

Initial red and final test/source identities will be retained under ignored
`.artifacts/release-test-author`; absent-module failures are labeled interface
red, not falsely reported as behavioral execution.

## Snapshot Harness Correction

The original `tooling/tests/run-contracts.mjs` copied only `tooling/lib` and
`tooling/scripts`, one workflow and three root configurations. It omitted real
release source, infra and image inputs, and synthesized the root package manifest.
The unchanged infrastructure suite reproduced 90 passes and 41 missing-source
failures across 131 tests in that harness. With the authorized additive input
snapshot it passes 131/131; core contracts also pass 127/127 in the snapshot.

The harness now copies and hashes source-only release modules/Dockerfiles and
Terraform source/test/example files, all three reviewed workflows, the actual
package manifest/tooling config, and explicit image/Compose/browser config inputs.
Operational state, plans, live tfvars, credentials, caches, nested dependencies and
artifacts are not admitted by the new source allowlists. New source inputs reject
symlinks and paths outside their configured roots. Existing source/workflow/config
overrides, protected test filters and temporary-directory cleanup checks remain.
Dependencies use the existing junction/symlink strategy for the root and tooling
workspace; no dependency tree is copied or installed.

`tooling/tests/vitest.contract.config.mjs` adds `tooling/release/**/*.mjs` to the
coverage include while preserving the original include entries, empty excludes,
90% line and 85% branch floors. These selected runs are not a full coverage pass.
Synthetic boundary checks additionally prove exact source-override hashes,
operational-file exclusion and denied source symlinks without altering their
outside targets. Evidence lives under `.artifacts/release-test-author` and the
harness's existing ignored `tooling/tests/evidence` output location. An initial
boundary-probe fixture omitted the policy import dependency; that recorded harness
error was corrected in the ignored probe, not by changing protected assertions.
Its initial dependency-resolution probe used CommonJS resolution for an ESM-only
SDK export; the author corrected that ignored probe to `import.meta.resolve`.
The final two selected boundary assertions pass, including tooling-workspace SDK
resolution without copying dependencies or executing the signing SDK.

## Author Execution Ledger

Initial pipeline red collected 89 cases with an absent-module failed suite and
89 pending assertions. The Docker project ownership addition recaptured 90
pending interface cases. After implementation, the author observed 89 passes and
the Windows file-link fixture error described above. The corrected fixture made
all original 90 pass while 11 new direct evidence-inspection cases failed on the
explicit absent export. The cold-daemon gateway and target-neutral publication
corrections each received a separate selected behavioral red before implementation.

The final independent selected run passes all 273 core/executor/pipeline cases,
including 102 pipeline cases. Its source/test identities, logs and JSON result
are in `.artifacts/release-test-author/pipeline-core-author-final`. The frozen
snapshot harness passes 131/131 infrastructure contracts; the earlier separate
core snapshot passes 127/127. These results do not claim full tooling coverage,
actual images, live scanners, signature authority, IAM isolation or hosted CI.
Implementer-reported full-tooling failures remain separate evidence for the owning
authors and distinct verifier, not silently converted into acceptance here.

The later verifier corrections have separate preserved behavioral reds: active
pending-intent duplicate protection, mandatory CodeQL run and certified image-run
bindings, the existing browser artifact naming contract, and the approved Alpine
gateway pin. The receipt-addressed memory-store interface records unchanged
transactions without treating them as writes; cloud archive protocol assertions
remain the independent adapter author's scope.

The Trivy empty-filesystem format correction ran 124 pipeline cases before
implementation: 121 passed and exactly three legitimate format acceptance cases
failed. Bare missing results, malformed metadata, wrong scan scope, HIGH/CRITICAL
findings and secret findings continued to deny. After the shared parser change,
the independent selected run passes 434/434 cases: core 141, executor 49, pipeline
124 and publisher 120, with zero skipped and no source/test drift during execution.
Evidence is retained in `.artifacts/release-test-author/verifier-format-author-final`
and the separate `verifier-corrections-handoff.json`; earlier red logs and actual
raw scanner reports remain unmodified. These selected results do not close the
distinct verifier's findings or establish replacement-image scans, full coverage,
hosted CI, real provenance authority or IAM isolation.
