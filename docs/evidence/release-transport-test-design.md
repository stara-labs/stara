# Independent Release Transport Test Design

Role: independent test author, distinct from transport implementation and final
verification. Base: `319c9bf8fb7c4bbc852497e5742f801f9015aec1`, branch
`feat/secure-releases`. This assignment owns only this document and
`tooling/tests/release-transport.contract.test.mjs`.

Authority: approved release requirements, architecture, and the independently
authored adapter interface. The author previously implemented application UI/API,
not transport, adapters or release execution. Transport production changes remain
with a separate implementer, and CLI production changes remain with the parent.

Status: independently authored contract frozen for initial red execution.
The parent approved the interface and compatible argument correction before
production implementation. Three exports belong in `tooling/release/transport.mjs`:
`createAuthenticatedRequest`, `verifyBundle`, and `executeCLI`. The parent-owned
`cli.mjs` will delegate; its broader command/provider contract is separate work.

## HTTP Boundary

`createAuthenticatedRequest({auth,fetch,clock})` returns
`request(url,{method,headers,body,signal,responseType,deadline?,maxBytes?})`, resolving
`{status,headers,body}`. This retains the existing adapter interface. Headers in
the result are a plain object; byte responses preserve original bytes. JSON
responses reject invalid UTF-8, duplicate keys and trailing input.

The only destinations are exact HTTPS Google API hosts
`storage.googleapis.com`, `run.googleapis.com`,
`iamcredentials.googleapis.com`, `logging.googleapis.com`, plus `api.github.com`
and `staging.app.stara.co`. Credentials, fragments, foreign ports and foreign
hosts deny before auth or fetch. GET/POST/PATCH are explicit; redirect overrides
are denied and fetch uses `redirect: 'error'`. Observed 3xx responses also deny.
The transport never retries: status classification and safe read retries belong
to the adapter/core. Thrown mutation errors cannot imply that no effect occurred.

`auth.getAccessToken()` supplies a nonempty string only for the four Google API
hosts. GitHub receives no authorization. Staging receives only an explicit Bearer
JWT from the adapter, not ambient Google credentials. Caller cookies, proxy auth,
host routing and Google auth overrides are denied. JSON objects serialize once;
uploaded original bytes remain unchanged. Input headers are not mutated.

Every request has a 30-second deadline covering auth, fetch and streamed body
consumption, constrained by any earlier absolute deadline and caller abort.
Cancellation/timeout also settles when an injected dependency ignores signals;
active readers are canceled and timers cleaned up. Byte limits apply to actual
streamed bytes, independently of Content-Length. Default limit is 1 MiB;
explicit byte responses permit at most 5 MiB for existing probe assets. JSON
responses permit at most 1 MiB. Probe adapters must request the larger limit
explicitly, rather than receiving a host-wide implicit exemption.

## GH Verification

`verifyBundle(input,{auth,run,files,clock})` accepts original bundle bytes,
`component`, canonical public `subjectName` (`stara/web` or `stara/api`), a
separate trusted private `imageRepository`, `imageDigest`, `sourceSha`,
`repositoryId`, `workflowRef`, `runId` (canonical positive decimal string),
`runAttempt` (positive safe integer), and signal/deadline. Registry names must not become
public signed subject names. The parent will update the adapter to pass both.

The pinned tool is GH 2.100.0, Linux amd64 tar SHA-256
`e4d4bb4498e8d007abe545b6568926793ace1b6447da598294a610018cb164be`.
The control-image owner, not these injected tests, verifies those archive bytes.
The bridge checks `gh --version` and uses the fixed argv below, with each value
as an independent argument, never a shell string:

```text
gh attestation verify oci://PRIVATE_IMAGE_REPOSITORY@IMAGE_DIGEST
  --bundle OWNED_TEMP_BUNDLE
  --repo stara-labs/stara
  --cert-identity https://github.com/stara-labs/stara/.github/workflows/release.yml@refs/heads/main
  --cert-oidc-issuer https://token.actions.githubusercontent.com
  --source-digest SOURCE_SHA
  --source-ref refs/heads/main
  --signer-digest SOURCE_SHA
  --deny-self-hosted-runners
  --format json
```

Tagged GH source marks `--cert-identity` and `--signer-workflow` mutually
exclusive. The parent approved retaining exact certificate identity and omitting
the conflicting signer flag; build signer facts are checked independently.

`run('gh',argv,{env,shell:false,signal,timeout,maxBuffer})` is injected and returns
`{code,stdout,stderr,signal?}`. Process output is bounded to at most 1 MiB. A finite
whole-operation deadline covers version, auth, temporary files and verification;
later phases consume remaining time, not a new allowance. A hung injected runner
must settle under that deadline. Only exit zero, no termination signal and a
nonempty verified JSON array can establish verification. Raw diagnostics are not
returned. Failure and successful verification both clean credentials; failed
cleanup cannot be reported as successful verification.

`files={mkdtemp,writeFile,rm}` creates one unique owned directory outside the
workspace/build contexts, using the OS temporary directory. Files are exclusive
creates (`flag:'wx'`) with mode `0600`. The process receives exactly fixed
`PATH=/usr/local/bin:/usr/bin:/bin`, `GH_HOST=github.com`, and owned temporary
`HOME` and `DOCKER_CONFIG`. No inherited GH, Google, proxy or preload settings
reach it. `config.json` contains only the configured Artifact Registry host's
base64 `oauth2accesstoken:SHORT_LIVED_ADC_TOKEN`; no GH credential is required
for the local `--bundle` flow. Token values never enter argv or process env.

GH wraps each result under `verificationResult`. Require
`signature.certificate`, nonempty `verifiedTimestamps`, and exact SLSA v1
`statement.subject` name/digest. Certificate extensions are flattened JSON under
`signature.certificate`, not a nested `extensions` property. Tests independently
reject missing/mismatched identity, issuer, hosted runner, push trigger, exact
source/signer/build-config URI/ref/SHA, repository `1363262992`, owner `293455507`,
source/owner URI, public visibility and exact run invocation URI. Matching
predicate assertions cannot replace missing or conflicting certificate facts.
The return allowlist is exactly the existing core provenance shape:
`verified,sourceSha,repositoryId,workflowRef,runId,runAttempt,imageDigest,attestationSha256`.
Bundle hash is computed from the original bytes.

The P1 run-binding correction requires the official certificate field
`runInvocationURI` to equal exactly
`https://github.com/stara-labs/stara/actions/runs/{runId}/attempts/{runAttempt}`.
It is not the nonexistent `buildInvocationURI` alias. The official
[Sigstore Extensions definition](https://github.com/sigstore/sigstore-go/blob/v1.3.0/pkg/fulcio/certificate/extensions.go)
was independently checked by this author. Different valid runs/attempts, URL
normalization variants, predicate-only identity, missing inputs and an additional
verified result from a different attempt deny. The two returned run facts are
allowlisted only after that exact certificate comparison. Parent adapter/publisher
must supply both; Ampere owns independent core binding against `manifest.runs.images`.

Post-red independent fixture correction: the tagged Sigstore implementation emits
timestamp types `Tlog` and `TimestampAuthority`, not lowercase spellings. The
happy fixture now uses `Tlog`; additional cases accept both official types and
deny `CurrentTime`, unknown/lowercase types and invalid/missing timestamp values.
One additional case checks that non-settling credential removal denies after
bounded cleanup grace (no more than five seconds beyond the operation deadline),
rather than hanging indefinitely or reporting verified success.
This corrects the injected wire fixture and strengthens validation; it does not
change the retained initial missing-module red or claim real cryptographic proof.

Official source basis supplied by parent and independently inspected by the
implementer: [GH 2.100.0 verify.go](https://github.com/cli/cli/blob/v2.100.0/pkg/cmd/attestation/verify/verify.go),
[Sigstore 1.3.0 certificate summary](https://github.com/sigstore/sigstore-go/blob/v1.3.0/pkg/fulcio/certificate/summarize.go),
and [Sigstore verification result](https://github.com/sigstore/sigstore-go/blob/v1.3.0/pkg/verify/signed_entity.go).
The test author did not execute GH or verify a live signature.

## Execute Wiring

`executeCLI({argv,env,request,verifyAttestation,clock,factories})` accepts exactly
`['execute']`. Factories are `readPrivateConfiguration`, `createCloudStore`,
`createCloudAdapters`, and `createExecutor`; defaults use the real modules.
The parent owns the executable entry guard in the separate thin CLI.

Only `STARA_CONFIGURATION_URI` and `STARA_DISPATCH_PAYLOAD` are selected from
the supplied environment. The URI is canonical
`gs://BUCKET/targets/staging.json`, transformed into a fixed HTTPS GCS media URL.
Payload is canonical base64 of at most 4096 original UTF-8 bytes, accepted only
by strict dispatch validation before configuration I/O. Dispatch cannot select
commands, paths, environments or destinations. Unknown, duplicate, malformed,
oversized and noncanonical payloads fail before requests or core construction.

Read configuration as at most 65536 original bytes, with an explicit bounded
GET. Compare their SHA-256 with dispatch before constructing state/adapters/core;
whitespace changes affect identity. Pass original config bytes to the strict
private parser, then wire its detached validated configuration into adapters and
store. Core receives only `{targetId,environment,configurationSha256,policy}`,
the created adapters/store, and the same clock. Its `run` receives original
decoded dispatch bytes. No inherited env or private receipt fields are returned.
Expose exactly `{status}` for succeeded, running, failed, degraded or
reconciliation_required; missing/unknown outcomes deny.
`running` acknowledges an already-owned duplicate, not successful deployment or
permission to restart it. Main maps that duplicate acknowledgement to exit zero.
Ampere owns the real executor case proving that a duplicate after the original
deadline fails and retains its lock; injected transport status alone cannot prove
that durable-state invariant.

Injected CLI factories prove composition and enforcement at this boundary,
not the already independently tested core or private-config parser internals.

## Isolation and Evidence

All network, credentials, clocks and process execution are synthetic injections.
Uninjected fetch, HTTP clients, GoogleAuth construction and child-process calls
are trapped. No test executes real `gh`, makes live calls, provisions resources,
or claims signature/IAM acceptance. Canary-bearing upstream errors must not be
present in error messages, stacks, causes, enumerable diagnostics or console logs.

The missing module check executes before each behavioral case. An absent module
is a clear failure, never accepted as the expected rejection of hostile input.
Focused red does not establish whole-tooling coverage or release acceptance.
Final verification must include every release module in complete tooling coverage.

## Initial Red Run

Executed from `C:/code/stara/stara/tooling` with the installed Node/Vitest CLI;
no dependency installation, production edits, live calls or GH execution:

```text
node ../node_modules/vitest/vitest.mjs run tests/release-transport.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-transport-test-author/red-formatted/results.json
```

Result: 239 collected, 239 failed, 0 passed, 0 skipped, exit 1. Every case failed
with `Missing implementation: tooling/release/transport.mjs; behavior not executed`.
This establishes an independently collected missing-module red baseline, not
observed production behavioral failures. The implementer may now begin against
the frozen contract. ESLint passed; formatting and diff checks are scoped to the
two author-owned files. No existing protected tests were modified.

Frozen test SHA-256:
`c04981d399cc55b52d8d6dcb9edd8fc0f977e0208e611611f417cc178c74c5c1`.
Ignored report `.artifacts/release-transport-test-author/red-formatted/results.json` SHA-256:
`234e79c085c0e8d5056614a57dde410154f186b59fa83c5eddc53adc342b67bb`.
The earlier pre-formatting red report is retained under `red/results.json`;
the post-formatting run above is the final frozen-input baseline.

Remaining: production implementation, independently observed green and complete
affected-tooling coverage, actual executable/GoogleAuth/registry/cryptographic
integration, control-image archive provenance, hosted execution and distinct
verifier review. Fake verified JSON is explicitly not a cryptographic proof.
The broader `cli.mjs` command/provider tests are separately proposed next; they
are not part of this transport red baseline.

Handoff conclusion: More journey evidence required.

## P1 Behavioral Red

RED READY for the separately approved run-identity and duplicate-acknowledgement
correction. Executed against unchanged transport implementation SHA-256
`650a2eedd0f1cbb7f28156887b44a978eb50840e11ad54575bc61dca8d245fba`:

```text
node ../node_modules/vitest/vitest.mjs run tests/release-transport.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-transport-test-author/provenance-run-red/results.json
```

286 collected: 257 passed, 29 failed, zero skipped, exit 1. Observed behavioral
failures include admitting another valid run/attempt and mixed-attempt results,
not rejecting missing/malformed run inputs before process/auth/files, omitting
verified run facts, and rejecting the newly approved running acknowledgement.
This is not a missing-module baseline. Production source was not edited.

Frozen test SHA-256:
`d9c3f538731fee2d7cde73d2bf399e60544b96c280be0f99b18b6883e93a3d99`.
Report SHA-256:
`c851266bd9277d69ba5d162fd152ac96d838908f742e2395558814cafb78918b`.
Parent/James may implement transport now. No live calls, process execution or
signature claims. Multi-agent `send_input` is unavailable in this author session;
this shared document is the handoff for relay, not a claim of direct delivery.

Final P1 freeze adds two verifier-requested caller-mutation cases: changing
runId/runAttempt while awaiting the tool cannot retarget the original expected
run. The parent-approved flat provenance fields remain authoritative; the
verifier's earlier nested imagesRun proposal was superseded and Ampere confirmed
that correction.

The full-source scanner then flagged the synthetic basic-auth URL literal. The
author mechanically constructs the identical URL using URL.username/password
instead; this preserves the same collected denial case and does not suppress a
rule or alter credentials policy. Full-source Secretlint and scoped ESLint pass.

Final command:

```text
node ../node_modules/vitest/vitest.mjs run tests/release-transport.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-transport-test-author/provenance-run-scanner-red/results.json
```

288 collected: 257 passed, 31 failed, zero skipped, exit 1, against the same
unchanged transport source hash above. The two additional failures demonstrate
caller mutation retargeting. The synthetic credential-URL denial still passes.
The earlier provenance-run-red and provenance-run-mutation-red reports remain
retained, not overwritten. Final test SHA-256:
`d609a17ccc9a86c63fcd1cec68dbdbdb3fe071537ca38cba1d4c3e24522d06c0`.
Final report SHA-256:
`7647f1d1106f98b92dd2ce67c063cba4e03a6830966159e986e469121de4946f`.

## Independent Scoped Green

The independent author reran the unchanged frozen tests after the parent's P1
transport implementation, without production edits or test expansion:

```text
node ../node_modules/vitest/vitest.mjs run tests/release-transport.contract.test.mjs tests/release-cli.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-cli-test-author/p1-final-scoped/results.json
```

Transport: 288 passed, zero failed/skipped. CLI: 114 passed, 7 expected failures
pending the separately owned CLI/shared-contract corrections. Combined: 409
collected, 402 passed, 7 failed, zero skipped, exit 1. This is transport green,
not a green combined gate. Both source hashes were checked before and after.

- Transport source SHA-256: `e9797fc4924e6dd56d9517a3b7ad94723d87de1fd67c4109d7ad0405ac4377c9`.
- Transport test SHA-256: `d609a17ccc9a86c63fcd1cec68dbdbdb3fe071537ca38cba1d4c3e24522d06c0`.
- Combined report SHA-256: `05bc10ea9b1d2acf285e375d6e69c4cdd391471c8fa532b61d8b2f0f092e5d70`.

Scoped source review confirms required run validation, detached input before the
first await, exact certificate invocation comparison for every verified result,
allowlisted run facts only after that comparison, and running acknowledgement.
No additional concrete risk requiring test expansion was identified in that P1
change. Full-source Secretlint and scoped ESLint passed without exceptions.
Formatting and diff checks cover both owned tests/docs. No servers or real cloud
calls were started. Full-tooling coverage, live cryptographic/provider integration
and the distinct verifier's acceptance remain outstanding.

Handoff conclusion: More journey evidence required.

## Coordinated CLI Green

After Locke supplied the CLI/shared-contract correction, the author reran the
same two frozen suites with no test changes. The new report is
`.artifacts/release-cli-test-author/p1-cli-core-green/results.json`: transport
288/288 and CLI 121/121 passed, 409 total, zero failed/skipped, exit 0.
Report SHA-256:
`7c17e613d4a9e30e21a50d43692237244ccdb1c2cd3b99a2f41314e96ad6c039`.
Transport source and test hashes remain those above. CLI source is
`2818220fdc513929300f59e6c1cf938fef0fae6a6657328abce224746338d5aa`;
shared contract is
`f63f714f005d70d561f58f2bf4a5e599e8e2a118def2c1c4e9ad48d0b7ed5ef2`.
Source hashes matched before and after execution. Full-source Secretlint,
scoped ESLint, formatting and diff checks passed. Previous red reports remain
historical evidence. Complete tooling coverage and live/distinct-verifier
acceptance are still not established by these selected suites.
