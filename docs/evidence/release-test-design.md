# Independent Release Test Design

Role: independent test author; not implementer or final verifier.
Base: `319c9bf8fb7c4bbc852497e5742f801f9015aec1`, branch `feat/secure-releases`.
Authority: `docs/requirements/releases.md` REL-01 through REL-11 and
`docs/release-architecture.md`. These tests do not amend acceptance criteria.

## Implementation Interface

The interface was sent to the parent before test authorship and accepted in
principle. The following tooling arguments are now locked for test authorship.
These are public
test entry points; implementations may have additional private helpers. Denials
throw nonempty, sanitized Errors, without interpolating supplied values.

`tooling/release/contract.mjs` exports:

- `parseDispatch(raw)` accepts a UTF-8 string or Uint8Array, at most 4096 bytes,
  and returns exactly `{schemaVersion:1,sourceSha,manifestSha256,configurationSha256}`.
  Source SHA is 40 lowercase hexadecimal characters; the other hashes are 64.
- `parseManifest(raw, expectedSha256)` hashes original UTF-8 bytes before parsing,
  limits bytes to 65536, and returns the manifest below. All structured JSON
  rejects unknown and duplicate keys at every depth, invalid UTF-8, extra input,
  coercions, noncanonical identities, and dangerous object keys.
- `validateEvidence(manifest, evidence, policy)` throws unless every trusted run,
  required job, current main identity, and complete target coverage matches.
- `validateProvenance(manifest, component, verification, policy)` throws unless
  the independently verified signed provenance matches every identity.
- `validateProductionApproval(request, approval, context)` throws for all live
  production requests, including valid approvals. Only the isolated simulation
  described below permits an approval result.
- `publicEvidence(input)` validates and returns a detached object containing only
  the public schema below. Unknown fields, malformed values, or secret canaries
  cause denial; dropping suspicious input and publishing the rest is not success.

Manifest exact shape:

```js
{
  schemaVersion: 1,
  sourceSha,
  repositoryId,
  images: {
    web: { digest, attestationSha256 },
    api: { digest, attestationSha256 }
  },
  runs: { scaffold: { id, attempt }, images: { id, attempt }, codeql: { id, attempt } }
}
```

`repositoryId` and run `id` are positive decimal strings, `attempt` is a positive
safe integer. Image `digest` is `sha256:` followed by 64 lowercase hex digits.
All three run IDs must be distinct. CodeQL is mandatory in this unpublished schema
version, not an optional compatibility extension.
Attestation hashes are 64 lowercase hex digits. Storage locations, commands,
service identities, targets and image repositories are never manifest fields.

Policy comes exclusively from private reviewed executor configuration:

```js
{
  repositoryId,
  workflows: {
    scaffold: { workflowRef, jobs: ['required-job'] },
    images: { workflowRef, jobs: ['verify-web', 'verify-api'] },
    codeql: { workflowRef: 'dynamic/github-code-scanning/codeql',
      jobs: ['Analyze (javascript-typescript)', 'Analyze (actions)'] }
  },
  provenanceWorkflowRef,
  requiredTargets: ['@stara/web', '@stara/ui', '@stara/api', '@stara/tooling']
}
```

Trusted `evidence` is fetched independently of manifest declarations:

```js
{
  repositoryId, sourceSha, currentMainSha,
  runs: [{ id, attempt, workflowRef, headSha, event: 'push',
    status: 'completed', conclusion: 'success',
    jobs: [{ name, status: 'completed', conclusion: 'success' }] }],
  coverage: [{ target, sourceSha, complete: true, lines: 90, branches: 85 }]
}
```

All three manifest run identities must appear exactly once with their exact attempt,
workflow and source; required jobs must be present exactly once and successful.
Required coverage targets appear exactly once, are complete, and have finite
percentages in [0,100] meeting 90% lines and 85% branches. Selected coverage is
not complete coverage. `verification` is the trusted provenance adapter result:
`{verified:true,sourceSha,repositoryId,workflowRef,imageDigest,attestationSha256,runId,runAttempt}`.
`runId` is a positive decimal string and `runAttempt` a positive safe integer;
both equal `manifest.runs.images.id/attempt`. The trusted verifier derives them
from the verified certificate's exact GitHub run invocation URI, not caller or
predicate assertions. The native CodeQL workflow ID is 355366692 and native path
is `dynamic/github-code-scanning/codeql`; adapters independently check repository,
main push/source, current run metadata and exact attempt/jobs at admission and
again before traffic. Policy/evidence uses the raw CodeQL path, not a fabricated
checked-in workflow or repository-prefixed normalization.
Unknown evidence fields cannot provide authorization. The adapter must actually
verify trust roots and signatures; returning this fixture is not live evidence.

Future approval simulation:

```js
request = { candidateSha, targetId, requester };
approval = { candidateSha, targetId, approver, expiresAt, revoked: false };
context = {
  simulation: true,
  productionEnabled: true,
  now,
  authenticatedRequester,
  authenticatedApprover,
};
```

Candidate SHA is full lowercase Git SHA; targetId is a nonempty bounded identifier.
Both authenticated identities must exactly match their corresponding claims and
be `JohnLozano-Stara` or `sundip`, with requester different from approver.
Expiry must be finite and strictly later than `now`; a changed candidate or target,
revocation, missing input, or any live/non-enabled context denies approval.

Public schema (all fields required except version):

```js
{
  schemaVersion: 1, sourceSha, version: '1.2.3', synthetic: true,
  results: [{ scenario: 'REL-01', result: 'Passed', mode: 'simulation' }]
}
```

Version is a semantic release version; result is exactly `Passed`, `Failed`,
`Not applicable`, or `Not executed`; mode is `simulation` or `live`; scenario is
REL-01 through REL-11. No freeform diagnostic strings, operational identifiers,
URLs, nested extras, environment values, credentials or traces are publishable.

## Executor Boundary

`tooling/release/executor.mjs` exports
`createExecutor({config,store,adapters,clock})`, returning `{run(rawDispatch)}`.
`config = {targetId,environment,configurationSha256,policy}` is trusted and fixed.
Environment must be `staging`; production remains denied even if extra activation
or approval settings are supplied. Dispatch configuration identity must match.
`clock = {now: () => epochMilliseconds, sleep: async milliseconds => void}`.

The injected durable store has `read(targetId,receiptId)` and
`transact(targetId,receiptId,async state => ({state,value}))`. Every executor
transaction must supply its immutable receipt identity. The latter atomically locks,
reads, applies and commits the callback before returning `value`. Initial state
is `{lock:null,receipts:{}}`; absent reads return that shape. Store callbacks and
stored values survive executor recreation; concurrent transactions serialize.
The executor must not replace this boundary with process-local state.
Read and callback views contain `{lock,receipts}` with at most the active and
addressed historical receipt. Historical hydration is ephemeral, never persisted
into the bounded active target record. Mencius owns the cloud archive/CAS tests;
this author's serial filesystem-backed memory fixture proves executor identity
arguments and no-op behavior, not the two-object provider protocol.

A duplicate running receipt before its original durable `totalDeadline` returns
running byte-for-byte unchanged, including pending mutation, owner, effects,
notification, reason and lock. It does not disrupt an owner paused in revision,
traffic or notification work. At or after that deadline it atomically records
reconciliation while retaining original ownership, deadlines, intent and lock;
no mutation, probe or notification is replayed. A state-equal transaction may be
used for admission, but the cloud store must skip its CAS/write. Terminal receipts
return unchanged regardless of age. Receipt expiry never authorizes lock stealing.

Each receipt is keyed by `receiptId`, binding source, manifest and configuration,
with `status`, `startedAt`, `totalDeadline`, and optional `rolloutDeadline` and
`probeDeadline`. Status is `running`, `succeeded`, `failed`, `degraded`, or
`reconciliation_required`. A non-null `pendingEffect` is durably committed before
every external mutation; its observed outcome is recorded afterward. The target
lock identifies `receiptId`. Additional private state fields are permitted.
Terminal duplicates return the receipt without repeating effects. A lock held by
another receipt denies admission. An interrupted receipt with a pending effect
stops for reconciliation and retains the lock, even after deadline expiry.
Store read/write errors deny further mutation.

Every adapter is injected and async. Each operation argument includes `targetId`,
`receiptId`, `signal: AbortSignal`, and numeric `deadline`; identities come only
from validated manifest and trusted configuration. Additional reviewed arguments
may be used. Required arguments and results:

| Adapter            | Additional arguments               | Result                                   |
| ------------------ | ---------------------------------- | ---------------------------------------- |
| `loadManifest`     | `manifestSha256`, `maxBytes:65536` | original string/Uint8Array bytes         |
| `collectEvidence`  | `manifest`, `sourceSha`            | independently read evidence above        |
| `verifyProvenance` | `component`, `manifest`            | verified result above                    |
| `createRevision`   | `component`, `imageDigest`         | `{revision}`                             |
| `waitReady`        | `component`, `revision`            | `{ready:true}`                           |
| `readTraffic`      | none                               | `{web,api}` existing traffic allocations |
| `switchTraffic`    | `component`, `revision`            | `{operationId}`                          |
| `probe`            | none                               | `{ok:true}`                              |
| `notify`           | `status`                           | no return value required                 |

`collectEvidence` runs again after readiness and before any traffic mutation.
Capture current traffic before the first switch; both components must be ready.
Mutations are createRevision, switchTraffic, notify. Error code `NO_EFFECT`
explicitly establishes no mutation occurred; all other mutation exceptions,
including `UNKNOWN_OUTCOME`, require reconciliation. Code `TRANSIENT_READ` is
the only retryable classification and only for side-effect-free reads, at most
two retries. No adapter rejection text is exposed in returned public diagnostics.
Failures after a confirmed switch are degraded; no automatic rollback or code
repair adapter exists. Notifications are idempotent under the same durable receipt.

Total deadline starts at first durable admission and is 30 minutes. Rollout is
15 minutes from durable rollout entry; probe is 5 minutes from durable probe entry;
both are capped by total deadline. Elapsed waiting/retries count. Expired stages
cannot continue mutations. A hung adapter must be aborted and bounded; clock
injection supports deterministic deadline tests without live waiting.

## Runtime Configuration and Notice

The API exposes GET `/api/runtime-config` with exactly
`{schemaVersion:1,environment:'development'|'staging'}`. `STARA_ENVIRONMENT`
defaults to development only when absent; empty, padded, production or unknown
values fail startup. `config.ts` exports `PublicRuntimeConfig` and
`readRuntimeConfig(env)`; existing `readConfig(env)` retains its host/port shape.
`createServer({runtimeConfig?,logStream?})` accepts the validated runtime config,
defaults to development, and sends `Cache-Control: no-store` on runtime config.
`startMain` validates runtime configuration inside sanitized startup handling.
Existing direct calls default to development. Existing
health remains HTTP 200 with exactly `{"status":"ok"}`.

Web `runtime-config.ts` exports `PublicRuntimeConfig`, `parseRuntimeConfig(value)`
and `loadRuntimeConfig(signal?)`. The loader fetches `/api/runtime-config` using
`cache:'no-store'` and forwards the optional AbortSignal. `RuntimeApp` waits for
valid config and exposes a generic failure state without the normal shell on
failure. `App` accepts optional `environment`, defaulting to development.
Web `main.tsx` mounts the actual runtime-aware root. Tests import the real entry
point and mount its real component tree.
Pending, missing, invalid or failed configuration cannot silently show the normal
shell without a notice. Valid staging renders exactly one accessible `note`
named `Staging environment`, without aria-live, containing exactly:

> Internal staging. Synthetic data only. Drafts are temporary and may be lost on reload or when this page closes.

Direct `App` renders may default development for existing tests. The notice stays
in the outer layout row when no modal is open and appears inside the active
ContextPicker or New dialog while its background is inert, preserving one
accessible notice with the complete wording. The new browser
suite intercepts only runtime config with synthetic responses; it does not claim
to exercise staging IAM or real deployment. It covers reload, contexts, inspection,
themes, 1100/900/700 widths, keyboard, forced colors, reduced motion and 200% text.

### Reviewed Test Harness Corrections

The author checked the shared native Dialog `onCancel` handler and existing
control tests. jsdom's local `showModal` shim sets `open` but does not synthesize
native `cancel` from Escape. The new integration test therefore dispatches
`cancel` and asserts dismissal; the real-browser journey retains keyboard Escape.
Unsupported Testing Library `exact:true` options were removed from three new
calls; literal accessible names already match exactly. No existing test changed.
The API negative cases explicitly check that `readRuntimeConfig` exists before
checking rejection, so an absent export cannot masquerade as a passing denial.

The author inspected the initial Chromium 1100px forced-colors failure report
and screenshot. The report used authored foreground `#f4f4f6` against white,
while the captured text was visibly black on white. The
[CSS Color Adjustment specification](https://www.w3.org/TR/css-color-adjust-1/#forced-colors-properties)
distinguishes forced used colors from authored computed colors, and
[axe's documentation](https://www.deque.com/axe/core-documentation/api-documentation/)
describes computed-style analysis. This supports a measurement mismatch for the
inspected glyphs, not blanket dismissal of contrast or other accessibility errors.

The revised browser test keeps every axe rule enabled and scans the same state,
theme, text zoom and reduced-motion mode in the authored palette. It restores
forced colors in `finally`; interactions, geometric checks and saved screenshots
remain in forced-colors mode. The forced-colors path also verifies the media query
is active and measures actual screenshot pixels inside every notice word's text
range, excluding borders. Each word requires painted contrast of at least 4.5:1
and at least 2.5% contrasting glyph pixels. This detects missing or faint notice
text; it is not a complete screenshot-based audit of every application glyph.
Missing landmarks and inspector crowding remain implementation failures.

The reviewed Firefox error was `browserContext.newPage` failing before navigation.
Those browser cases are Not executed for application assertions, not Passed.
The parent subsequently reported a permitted Firefox launch passing all 11
application cases; the initial failures remain retained. This author did not
reexecute that run. The distinct verifier must bind the corrected complete matrix
to its source/test identities, including the required hosted Linux evidence.

## Scenario Coverage and Remaining Acceptance

| Scenario | Independently authored local evidence                              | Required external evidence                                   |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------ |
| REL-01   | No local IAM assertion                                             | Ungranted UI/API denial, direct service bypass denial        |
| REL-02   | Exact dispatch, manifest, independent evidence and ordered rollout | Merged-main signal, real verified images and auto-staging    |
| REL-03   | Failed/missing/canceled/stale/substituted/selected evidence denial | Real GitHub job and signature adapter verification           |
| REL-04   | Production denial before side effects                              | No production resources, IAM, DNS or dispatch bindings       |
| REL-05   | Isolated authenticated two-human simulation                        | No live production activation in this milestone              |
| REL-06   | Target-specific store and calls, no B effects                      | Denied real permissions in owned temporary project           |
| REL-07   | Pre-switch failures leave traffic unchanged                        | Running artifact remains served during live failure          |
| REL-08   | Partial switch degrades, receipt prevents repeat effects           | Private diagnostics and reviewed forward repair              |
| REL-09   | API startup, real entry, browser notice matrix                     | Restricted staging browser matrix and Product review         |
| REL-10   | Exact public field allowlist and synthetic canaries                | Independent built bundle/image metadata/layer/artifact scans |
| REL-11   | Durable serialized state, duplicate/race/deadline/unknown tests    | Durable backend atomicity, operation reconciliation drill    |

## Evidence and Protection

Generated red reports and source/test SHA-256 identities are retained only in
ignored `.artifacts/release-test-author`. An absent module/import failure is an
interface red, not proof that its behavioral assertions executed. Runtime tests
against existing source distinguish assertion failures from collection errors.
Selected red runs do not establish coverage or release readiness. The distinct
verifier must run complete owning targets, with release production files included
in tooling coverage, retaining 90% lines and 85% branches. Coverage configuration
is parent-owned and must include `release/**/*.mjs` in both normal and independent
tooling coverage denominators.

### Executed Author Evidence

All runs below capture exact source and test hashes before and after execution,
the command, actor, Node/platform, timestamps and output hash. The Git base alone
does not identify concurrently edited working-tree source; the source manifests do.

| Local run label                    | Result | Interpretation                                                                                                                                                                                    |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core-contract-red`                | Failed | Missing-module interface failure; 127 assertions not executed                                                                                                                                     |
| `executor-interface-red`           | Failed | Missing-module interface failure; initial 39 assertions not executed                                                                                                                              |
| `api-runtime-red`                  | Failed | 10 failed, 9 passed; real HTTP 404 and invalid startup failures. The initial 9 negative cases could pass through an absent-export TypeError and were corrected, not counted as validated behavior |
| `web-runtime-red`                  | Failed | 7 failed, 1 passed real-entry cases; absent loader module separately failed collection                                                                                                            |
| `browser-preexisting-build-red`    | Failed | One Chromium journey saw zero notices in built shell; cleanup stalled and watchdog stopped CLI. Built bytes hashed, source-to-build provenance not established                                    |
| `core-final-author-check`          | Passed | 171 selected core/executor assertions, no skips, including hanging adapters, durable intent and mutation uncertainty                                                                              |
| `web-final-formatted-author-check` | Passed | 30 selected loader and real-entry assertions after harness corrections and final formatting                                                                                                       |
| `api-final-author-check`           | Passed | 19 selected config, real HTTP and startup assertions                                                                                                                                              |

New test files pass repository ESLint and Prettier. Web/API owning TypeScript
checks pass; the new browser spec also passes a strict standalone TypeScript
check. The final browser methodology has been handed to the UI implementer for
matrix execution; its initial failing run is preserved. Author-selected checks
are not complete-target coverage, distinct verifier approval, or Product acceptance.
No live IAM, DNS, IAP, image-layer confidentiality, signature-provider correctness,
cross-project denial or merged-main auto-staging was established by these runs.

All newly authored release/runtime/staging test files and this design are
protected review inputs. The implementer may propose corrections through the
parent, but may not weaken assertions, add skips, narrow selection/denominators,
replace real entry behavior with mocks, or update their own approval evidence.
Any accepted test change requires independent test-author review, new hashes,
and renewed red/green evidence. Existing protected tests and acceptance documents
were not edited. No commits, pushes, merges or live cloud operations are authorized
as part of this test-author task.

Handoff conclusion: More journey evidence required.
