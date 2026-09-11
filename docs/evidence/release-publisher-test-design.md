# Independent Release Publisher Test Design

Independent test author; parent implements `tooling/release/publisher.mjs`.
Hume owns transport/signature-verifier tests; Locke owns pipeline implementation.
This assignment owns only this document and
`tooling/tests/release-publisher.contract.test.mjs`, plus ignored author evidence.
Base `319c9bf8fb7c4bbc852497e5742f801f9015aec1`, branch `feat/secure-releases`.
No production edits, changes to existing assertions, commits or publication.

## Agreed Interface

```js
createArtifactPublisher({ env, request, attest, verifyBundle, clock });
// -> {registry:{web,api,attest},storage:{put}}
createStagingDispatcher({ env, request, clock });
// -> async publish({topic,data}) -> {messageIds:[string]}
```

Factories return synchronously and validate authority before returning facades.
`clock={now:()=>epochMilliseconds,sleep:async milliseconds=>void}`. Each factory
captures one original 15-minute lifetime, never refreshed by another method call.
Each Google request is bounded by 30 seconds and the remaining lifetime; signing
plus verification is bounded by 10 minutes and that same remaining lifetime.
Hung injected dependencies must settle despite ignoring cancellation. All timers
and abort listeners are cleaned up. Every denial is a fixed sanitized Error with
no supplied values, upstream details, cause or enumerable private diagnostics.

`request(options)` matches injected GoogleAuth `client.request`:
`{url,method,data,headers?,signal,timeout,retry:false,maxContentLength}` returning
`{status,data}`. The caller never supplies a URL. Production CLI binds the real
client; tests supply synthetic fixtures. No shell, token minting, Cloud Run,
private executor or arbitrary HTTP authority is part of these factories.

## Publisher Authority

Require exact environment facts: `GITHUB_EVENT_NAME=push`,
`GITHUB_REF=refs/heads/main`, `GITHUB_REPOSITORY=stara-labs/stara`,
`GITHUB_REPOSITORY_ID=1363262992`, `GITHUB_REPOSITORY_OWNER_ID=293455507`,
`GITHUB_WORKFLOW_REF=stara-labs/stara/.github/workflows/release.yml@refs/heads/main`.
`GITHUB_SHA` is full lowercase SHA, `GITHUB_RUN_ID` positive decimal string,
`GITHUB_RUN_ATTEMPT` positive decimal string, and `GH_TOKEN` nonempty. Trusted
`STARA_IMAGE_REPOSITORY` is exactly
`us-central1-docker.pkg.dev/<delivery-project>/app`, without digest/tag/credentials.
`STARA_ARTIFACT_BUCKET` is a canonical configured bucket name, not URL or path.
Unrelated environment variables are ignored; they cannot grant another facade.
Registry refs are `<configured repository>/web` and `/api`.

### Signed Bundle

`registry.attest({component,subjectName,subjectDigest,sourceSha,runId,runAttempt,runtime})`
matches the pipeline contract. Validate web/api, exact configured private OCI ref,
canonical SHA-256 digest, exact current source/run/attempt before any SDK call.
`runtime` is passed through the pipeline interface but supplies no publisher
authority and is not passed to the signing SDK.

Call the injected actual `@actions/attest` 3.2.0 `attestProvenance` exactly with:

```js
{subjects:[{name:'stara/web',digest:{sha256:hex}}],
 token:env.GH_TOKEN,sigstore:'public-good'}
```

Use `stara/api` for API. No private OCI/GCP names, raw environment, diagnostics,
custom predicates, write bypass or runtime objects enter this public signing
input. Public certificates inherently include GitHub identities, not GCP targets.
Installed SDK declarations return `{bundle:SerializedBundle,certificate,...}`,
not byte input. Serialize only that original SDK bundle once with
`Buffer.from(JSON.stringify(result.bundle),'utf8')`; retain those exact bytes
for hash, verification and later upload. Missing/empty/oversized bundle denies.
No locally fabricated statement or success JSON substitutes for signing proof.

Call Hume's trusted `verifyBundle` with one object:
`{bundle,component,subjectName:'stara/web'|'stara/api',imageRepository:<private ref>,
imageDigest,sourceSha,repositoryId,workflowRef,runId,runAttempt,signal,deadline}`. Its exact return
allowlist is `verified,sourceSha,repositoryId,workflowRef,imageDigest,
attestationSha256,runId,runAttempt`, validated against the core provenance contract.
The flat run fields match the publisher's captured GitHub run identity, are
required positive-decimal string/positive-safe-integer respectively, and derive
from the verified certificate's exact run invocation URI. Caller/predicate fields
or a signature from another attempt with the same source/digest are insufficient.
Return
`{bundle:Uint8Array,verification}`. The separate transport suite verifies GH
2.100.0 certificate facts, canonical statement subject and the private registry
lookup. These injected tests do not establish cryptographic or IAM proof.

### Immutable Objects

`storage.put({key,bytes,ifAbsent:true})` accepts original `Uint8Array` bytes, at
most 1 MiB. Only these canonical keys are allowed:

- `attestations/<sha256>.jsonl`, hash matching original bytes.
- `manifests/<sha256>.json`, hash matching bytes and strict core manifest schema.
- `coverage/<sourceSha>/<run>-<attempt>.json`, complete core coverage records for
  all four targets, matching source, meeting 90% lines and 85% branches.

Manifest source/repository and coverage source match the publisher environment.
Manifest has all three distinct required run identities: scaffold, images and
codeql. The old unpublished two-run shape is rejected, not silently upgraded.
The pipeline independently binds the coverage key's run/attempt to trusted full
Scaffold evidence; the storage facade does not infer that run from image-run env.
The CLI's immutable artifact download/export provenance is separate author work.
Never accept operational state, config, arbitrary paths, traversal, caller URLs,
raw reports or mutable overwrite. POST only to
`https://storage.googleapis.com/upload/storage/v1/b/<configured-bucket>/o`, with
`uploadType=media`, `name=<encoded exact key>`, `ifGenerationMatch=0`, and original
bytes as request data. Response must be status 200 with matching `name`, `bucket`
and a positive-decimal `generation`. Return exactly `{created:true}` only then.

412, failures, empty/wrong responses and uncertain writes deny after one request.
In particular, a previously created coverage key is not treated as success.
An operator must obtain a fresh complete Scaffold push run/attempt and coverage
identity before rerunning publication; read permission is not added implicitly.
No blind retry or fabricated exists-equals-created result is permitted.

## Dispatcher Authority

Require the same fixed repository/owner/ref identity but exactly
`GITHUB_EVENT_NAME=workflow_run` and
`GITHUB_WORKFLOW_REF=stara-labs/stara/.github/workflows/dispatch.yml@refs/heads/main`.
`STARA_STAGING_TOPIC` is the configured canonical `projects/<project>/topics/<topic>`.
The factory exposes only a publish function, no registry/storage facade.

Input is exactly `{topic,data}`. Topic must equal configured topic; data must be
canonical base64 of at most 4096 original UTF-8 bytes accepted by strict core
`parseDispatch`. Deny duplicate/unknown JSON keys, invalid UTF-8, oversize input,
approvals, destinations or command injection. Do not require dispatch source to
equal the dispatch workflow's own SHA; the pipeline independently binds the
completed image workflow and downloaded manifest.

POST only to `https://pubsub.googleapis.com/v1/<configured-topic>:publish` with
`{messages:[{data:base64(JSON.stringify({payload:input.data}))}]}`. This intentional
second encoding preserves the Cloud Build message binding. Never include env,
private config, webhook or arbitrary attributes. Require status 200 and exactly
one nonempty message ID; return `{messageIds:[id]}`. Empty, failed or ambiguous
responses reject without retry. Dispatcher cannot upload objects and publisher
cannot send Pub/Sub messages.

## Evidence and Protection

Tests cover REL-02/03 identity and signed evidence, REL-04 no deployment/production
authority, REL-10 public evidence boundaries, and REL-11 bounded operations and
unknown outcomes. Synthetic canaries and injected SDK/Google requests cannot
prove live IAM, real cryptography, immutable server enforcement or hosted release
success. Initial red is executed before implementation and records missing-module
limitations honestly. All release source remains in complete tooling coverage.
Protected tests require independent author review for corrections, renewed hashes
and explicit evidence; no skips, assertion weakening, broader destinations,
coverage exclusions or blanket retry behavior.

## Author Results

Before implementation, the frozen suite collected 117 cases and recorded 117
explicit missing-module failures, zero passes and zero skips. This is interface
red, not exercised behavior. The first source-free red and its lint-only author
correction are retained; the final frozen red is
`.artifacts/release-test-author/publisher-frozen-red`.

After the parent implemented the factory module, the independent author reran
all 117 cases successfully without changing tests. The same 117 cases pass in
the source snapshot harness. Evidence is in
`.artifacts/release-test-author/publisher-author-green` and
`publisher-snapshot-author-green`; per-run manifests record before/after source
and test hashes. Source review found no additional gap requiring new cases in
this agreed scope. Scoped lint and formatting pass.

Both owning-tooling and independent-contract coverage configurations include all
release modules at the unchanged 90% line and 85% branch floors. No selected
coverage result is substituted for the pending full run. No cloud, real signing,
registry upload, Pub/Sub publish or IAM operation was performed. Distinct final
verification and human acceptance remain required.
