# Independent Infrastructure Test Design

Role: independent infrastructure test author, distinct from implementer and final
verifier. Base: `319c9bf8fb7c4bbc852497e5742f801f9015aec1` on
`feat/secure-releases`. Authority: `docs/requirements/releases.md` and
`docs/release-architecture.md`, approved Secure Stara Releases plan.

## Parent Interface and Ownership

Interface revision 5: incorporates the parent's separated image/dispatch workflows,
separate release Dockerfiles, independent WIF publisher conditions, fixed Node
entrypoint and private Cloud Logging refinements before implementation.
It also includes the approved native Cloud Monitoring corrective-incident channel.

The parent supplied these filenames before implementation:

- `infra/gcp/bootstrap/{versions,main,variables,outputs}.tf`
- `infra/gcp/delivery/{versions,main,variables,outputs}.tf`
- `infra/gcp/target/{versions,main,variables,outputs}.tf`
- `infra/gcp/README.md`
- `.github/workflows/release.yml`, `.github/workflows/dispatch.yml` and existing
  `.github/workflows/checks.yml`
- New `UI/web/release.Dockerfile`, `backend/api/release.Dockerfile`, and adjacent
  `release.Dockerfile.dockerignore` files, with `runtime` release targets.
- `UI/web/nginx.conf`; web base is the approved digest-pinned unprivileged nginx
  image. API uses the existing pinned Node base and production-only installed
  `dist`, `node_modules`, package metadata and Apache license.
- Existing development Dockerfiles and `compose.yaml` remain byte-equivalent
  after newline normalization to the approved base. Their existing bulk COPY
  instructions are outside the release dependency graph.

Originally only `tooling/tests/release-infra.contract.test.mjs`, this design,
optional Terraform tests, and ignored `.artifacts/release-infra-test-author/`
belonged to this author. The parent subsequently assigned mock-plan tests at
`infra/gcp/{bootstrap,delivery,target}/tests/release-infra.tftest.hcl`, the new
`tooling/tests/release-files.contract.test.mjs`, and explicitly authorized the
four-job aggregate migration in `tooling/tests/workflow.contract.test.mjs`.
Core/runtime tests belong to Ampere. Production source,
package metadata, policy, coverage configuration and workflows belong to the
parent. No commits, pushes, merges, cloud operations or other existing test edits.

Static tests discover resource labels from types. The later plan tests reference
James's actual root interfaces and resource addresses, using synthetic project IDs
and computed resource names. They never require real private inputs or outputs.
Use ordinary HCL resource blocks. Security constants (WIF condition, private
storage controls, Cloud Run access controls and scale) must be explicit in their
own blocks. Complex expressions require independently reviewed plan assertions,
not weakening the source test to accept an unverified expression.

Target accepts only `staging` and `isolation`; its load balancer may be enabled
only for staging. Region defaults to and is constrained to `us-central1`.
Terraform is pinned to `1.16.2`, Google provider to `8.2.0`. The parent's verified
Google service-identity limitation permits exactly pinned `google-beta` `8.2.0`
solely for `google_project_service_identity`; no other resource uses that provider.

The checks workflow adds a release-image job, and the aggregate must depend on it.
The job must execute both `pnpm release:images` and `pnpm release:safety`, without
an event-specific skip. They must resolve to real root package scripts. Job IDs
are discovered from these commands. The protected workflow suite's old three-job
aggregate was migrated with explicit parent permission to include `release-images`
and `RELEASE_IMAGES`. It retains the old truth-table cases and adds failed,
cancelled, skipped, empty, unknown and absent-variable denials for all four jobs.

`release.yml` is named `Release images` and triggers only on push to main. A
read-only prerequisite job checks successful complete `Scaffold checks` and
`CodeQL` for the exact source SHA. Its image publisher depends on this job and
builds/tests/scans/attests/publishes the same SHA. It never publishes Pub/Sub.
`dispatch.yml` triggers only after the entire `Release images` workflow completes
successfully, with push origin, main head branch and exact numeric source
repository/owner conditions. It has only staging-topic publisher credentials.
Neither workflow accepts arbitrary dispatch/inputs, build scripts or cloud deploy
commands. The reviewed external helper binding is `pnpm release:await-checks`,
whose root script must resolve to `node tooling/release/cli.mjs await-checks`.
The prerequisite passes exact `github.sha`, cannot skip the call or ignore its
failure, and the publisher depends on successful prerequisites. This replaces
the incidental requirement to spell workflow names inside the shell command.
`release-pipeline.contract.test.mjs` independently exercises `awaitMainChecks`
against exact workflow/SHA/repository/attempt/job identities and denial cases.
The static binding does not prove that a CLI implementation exists or delegates
correctly; transport/CLI behavioral execution remains a separate gate. A step
name or comment mentioning Scaffold/CodeQL is never a substitute for that call.

Two WIF providers bind numeric owner `293455507`, repository `1363262992` and
`refs/heads/main`. The image provider additionally binds
`stara-labs/stara/.github/workflows/release.yml@refs/heads/main` plus event `push`;
the dispatch provider binds `stara-labs/stara/.github/workflows/dispatch.yml@refs/heads/main`
plus event `workflow_run`. Publisher accounts and impersonation principals differ.
Separate pools may use repository-scoped principal sets; shared pools need
distinct mapped workflow/publisher attributes. Two providers with the same
repository-wide principal in one pool do not isolate publishers.

Cloud Build uses its fixed reviewed image with private `CLOUD_LOGGING_ONLY` logs
and explicitly managed 30-day log retention. A fixed `node` entrypoint with a
literal script path and argument array is allowed. The approved relative entry is
`tooling/release/cli.mjs`, `execute` with `dir = "/app"`; an absolute fixed script
path is equivalent. Candidate substitutions may
provide data arguments or environment data, never an executable, shell command,
script, identity or destination. GCS is for separate private configuration,
artifacts and durable state; a fourth GCS log bucket is not required. Artifact
storage belongs to delivery. Configuration and receipt-state buckets belong to
target; delivery references them without duplicating their resources. Standard
`required_providers { google = { ... } }` syntax is explicitly supported and
tested by the source extractor, including the equals sign.

The private executor may receive a custom role containing only
`iam.serviceAccounts.signJwt`, bound to its own service account only. It also
receives explicit IAP backend access for probes. Project-wide Token Creator,
publisher signing/impersonation, service-account keys and private-key payloads
remain forbidden. The adapter's fixed operator-owned `executorServiceAccount`
uses IAM Credentials `signJwt`; mock tests cannot prove the real grant or IAP
acceptance. This allowance follows the approved
[IAP programmatic authentication flow](https://docs.cloud.google.com/iap/docs/authentication-howto).

Corrective operator work items are private native Cloud Monitoring incidents.
Delivery owns an enabled log-based alert policy linked to an owner email
notification channel, with notification rate limiting. The condition covers
`release_terminal` events for failed, degraded and reconciliation-required
outcomes. Owner email is private operator input. The configuration's fixed
`loggingProjectId` resolves to the delivery project, not the target project or
anything in a dispatch. No new GitHub credential or GitHub issue creation is
part of notification, and no secret-payload Terraform resource is introduced.

The notify adapter must write a structured allowlisted `release_terminal` event
with status, receipt identity, source identity and a deterministic `insertId`.
Unknown fields, raw diagnostic strings and secrets must not enter that event.
An acknowledged write proves log submission only. It must not be reported as a
verified incident, delivered email or created GitHub issue. A failed or ambiguous
write cannot become a successful notification. The durable receipt/side-effect
rules still apply; `insertId` alone does not establish exactly-once alert delivery.
Incident recovery explicitly directs the operator to a reviewed forward-fix PR,
with no automatic rollback or source edits. Adapter-level input validation,
write outcomes and payload assertions belong to the independent adapter tests;
these infrastructure tests do not pretend to execute that implementation.

The runnable source test requires both the matched-log policy and its channel
reference; a logging-only implementation therefore stays red. Later plan tests
must evaluate the connection and delivery project identity, including computed
expressions. These requirements follow the approved
[Cloud Logging alert policy flow](https://docs.cloud.google.com/logging/docs/alerting/log-based-alerts).

Release COPY allowlists include `LICENSE.md`, `tooling/config/tsconfig.base.json`,
workspace manifests/lockfile, `.npmrc`, application/shared source/public assets,
application tsconfigs, Vite config and `UI/web/nginx.conf`. Docker-specific ignore
files start deny-all and explicitly reopen approved inputs. Dependency installation
must preserve Apache and third-party licensing in the minimal runtime. Source
checks do not establish installed dependency contents or image-layer safety.

API production dependencies come from a separate stage with the unchanged root
manifest/lock/workspace/.npmrc and only the API package manifest. Its install uses
`--prod --frozen-lockfile --ignore-scripts`; no legacy deploy command is required
or accepted as the reproducibility proof. Final runtime copies only root and API
production node_modules (preserving pnpm links), compiled API dist, API package
metadata and LICENSE.md. Full build dependencies use the frozen lock separately.

## Evidence Levels

The runnable Vitest suite checks real policy function behavior using synthetic
path inventories, parses workflow YAML, checks literal source constraints within
individual HCL blocks, and follows Docker stage ancestry/COPY dependencies.
Missing implementation is an explicit failing assertion inside a collected test.
It is not reported as an import failure, skip, or successful negative control.

The HCL scanner balances blocks and ignores comments/quoted braces. It is not an
HCL evaluator or Terraform/provider validator. Source assertions do not prove
effective IAM, resource counts after expressions, expression validation, service
reachability, resolved image contents, dispatch integrity or runtime behavior.
YAML assertions likewise do not execute GitHub's expression engine. Docker source
checks do not build images or inspect layers. These limitations remain even if
every static assertion passes.

Policy tests execute the real `validateLayout` and `classifyChanges` functions.
They permit only `infra/gcp/` infrastructure ownership, deny sensitive operational
files across otherwise allowed roots, allow only the specifically reviewed
`infra/gcp/terraform.tfvars.example` exception, and broaden every infrastructure
change to all known packages. An arbitrary `.example` suffix is not authorization.

## Terraform Plan Cases

No speculative tests were frozen before root interfaces existed. The later
independently authored suites now run directly under each root's `tests/` folder:
bootstrap has 10 runs, delivery 12, and target 22. Every run uses `command = plan`.
Every provider is mocked, including bootstrap's `google.budget` alias and delivery/
target `google-beta`. Overrides supply computed IDs, names, emails, project numbers
and synthetic DNS/address outputs only; they do not replace configuration, roles,
permissions, IAM members, budget amounts, scaling settings or validation rules.
Distinct computed values preserve directional assertions instead of collapsing
unrelated identities into a single mock value.

Target backup validation uses the test file's own synthetic bytes and SHA-256 as
an existing absolute-path input. Negative cases reject absent, relative, mismatched
and malformed values. This exercises file/hash validation, not the existence or
correctness of an actual backed-up bootstrap state. Invalid primary inputs are
expected to fail at their own validation; the test does not require downstream
validations to run after Terraform has already stopped that dependency graph.

| Case                        | Required plan assertion                                                                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap without isolation | Exactly delivery and staging projects; separate IDs, Stara ownership/billing inputs, no production resources                                                                                                                                                          |
| Bootstrap with isolation    | Exactly three distinct projects including temporary isolation; combined budget project filter contains precisely the enabled projects                                                                                                                                 |
| Budget                      | USD 100 amount; thresholds exactly 0.5, 0.8, 1.0; plan documents alerts are not a spending cap                                                                                                                                                                        |
| Invalid bootstrap inputs    | Missing/empty ownership, duplicate project IDs, production ID/environment and invalid budget/region cannot yield an applicable plan                                                                                                                                   |
| Delivery privacy            | Artifact Registry private; configuration, artifacts and state have distinct private GCS buckets with uniform access and enforced public-access prevention; private Cloud Logging retains 30 days; versioning where durable state/immutable input recovery requires it |
| Publisher IAM               | Separate artifact/topic accounts; repository writer and immutable object creator at their resource scopes; topic publisher only on the fixed topic; no deployment, config/state/log reads, broad SA impersonation, owner/editor or Cloud Deploy authority             |
| WIF negatives               | Two providers with exact numeric org/repo/ref/workflow/event conditions; changed claims deny; computed principals isolate image and dispatch accounts, including shared-pool negative cases                                                                           |
| Fixed execution             | Pub/Sub selects a reviewed inline Cloud Build configuration, digest-pinned control image, fixed target identity and private logs; candidate data cannot supply script, image, build config, identity or destination                                                   |
| Staging target              | Distinct web/API accounts, two digest-pinned Cloud Run services, region us-central1, min 0/max 2, no anonymous invoker, restricted ingress, default URL disabled, LB/IAP invocation identity only                                                                     |
| LB and API paths            | HTTPS frontend and certificate, serverless NEGs for both services, IAP enabled on both backends, `/api/*` routes to API and default routes to web, explicit IAP access allowlist                                                                                      |
| Isolation target            | Separate project/identities/config/state; LB absent when disabled; enabling LB for isolation fails a validation/precondition                                                                                                                                          |
| Invalid target inputs       | Production or unknown environment, mutable/malformed images, foreign region, empty access grant when LB enabled, reused web/API identity and production hostname fail plan                                                                                            |
| Production absence          | No production project, domain mapping, DNS record, service identity, target or dispatch binding in any plan; reserved origin in explanatory documentation does not provision anything                                                                                 |

Terraform `fmt -check` and `validate` must run separately against the pinned
binary/provider. Passing mocked plans can establish evaluation, wiring and input
validation; they cannot establish Google's authorization decisions. Mock-only
negative IAM assertions must never be called REL-01/REL-06 acceptance.

The WIF tests assert evaluated condition strings and resolved distinct principals,
not CEL evaluation or token exchange. Source inventory constraints complement the
known-resource plan assertions; the plan tests do not introspect arbitrary future
resource types or inherited IAM. Target policy currently lists the original four
Scaffold jobs; adding the fifth `Release image verification` entry is a pending
parent/James configuration review, not an author-owned production edit.

## Live Acceptance Cases

Additional plan case for revision 5: assert that the enabled log policy's resolved
`notification_channels` includes the owner email channel's actual planned name,
both belong to delivery, the terminal failure filter is effective, and the fixed
configuration `loggingProjectId` resolves to the delivery project. Reject missing,
disabled, unrelated or target-project channels/configuration. Validate that the
executor may write only the intended private logs; no publisher gains log access
or new impersonation. Mocks establish these values and links, not email delivery.

Use only the approved Stara-owned staging and owned temporary isolation projects.
Keep raw identities, tokens, provider output, state, plans, URLs and traces private.
Record exact source/test/config/image hashes, actor, UTC time and outcome.

| Requirement        | Required independent live evidence                                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| REL-01             | Ungranted and unauthenticated clients denied at both UI and all API routes before app content; authorized allowlisted client works; repeat against direct Cloud Run URLs and alternate LB host/path forms                                                                      |
| REL-02/03          | Real merged-main successful required checks publish immutable images/candidate and stage automatically; fork/PR, failed/cancelled/stale/wrong-repository runs cannot mint publisher credentials or promote                                                                     |
| REL-04             | Cloud inventory and IAM confirm no production resources/DNS/deployment binding; live production request denied without mutation                                                                                                                                                |
| REL-06             | Executor A can perform only intended A operations; actual attempts to read B config/state/secrets, impersonate B identities or deploy/switch B fail with authorization denial; repeat reverse direction and record B traffic/config unchanged                                  |
| Publisher boundary | Artifact publisher can write intended artifacts but cannot overwrite immutable candidate objects, publish arbitrary execution, run builds, deploy, read config/state/secrets/logs or impersonate executor; topic publisher cannot write artifacts or choose execution controls |
| WIF boundary       | Actual token exchange denied for changed numeric org/repo, branch and workflow; public PR/fork contexts cannot obtain OIDC credentials                                                                                                                                         |
| REL-10             | Independent image builds, inspection of runtime user and filesystem/layers/history/metadata, bundle scans and public artifact canaries; private diagnostic artifacts never uploaded publicly                                                                                   |
| Fixed Cloud Build  | Malformed/adversarial messages cannot override image/script/SA/log bucket/target; real logs remain private and denied to publishers                                                                                                                                            |

Effective inherited organization/project IAM and IAP/Cloud Run behavior must be
observed. Terraform declarations and mock responses cannot establish those facts.
No live acceptance operation is authorized by this test-author assignment.

Additional live notification case: submit an owned synthetic terminal failure
through the real executor, retain its receipt/source and `insertId` privately,
and verify the corresponding log, native Monitoring incident and owner email.
Repeat for degraded/reconciliation outcomes and exercise a denied/ambiguous log
write. Confirm that logs/incident data remain private and the recovery action is
a reviewed forward-fix PR. No incident/email claim may be inferred from a successful
Logging API response or a mock. Confirm no GitHub issue or credential was used.

## Run and Evidence

Focused command from the repository root:

```sh
pnpm --dir tooling exec vitest run tests/release-infra.contract.test.mjs --reporter=verbose
```

Initial red capture and source/test SHA-256 manifest are retained under ignored
`.artifacts/release-infra-test-author/`. Missing source is recorded as missing,
never hashed as empty content. The capture records source hashes before and after
execution to expose concurrent implementation changes. A later green run requires
fresh hashes and independent verifier review; this selected run is not coverage.
The parent owns adding `release/**/*.mjs` to tooling coverage without reducing the
existing 90% lines/85% branches floors or excluding authored unexecuted source.

Initial run: Failed, 127 collected, 30 passed, 97 failed, zero skipped; no source
changes during execution. This first run precedes interface revision 2's final
logging/entrypoint/license corrections and is retained as historical evidence,
not evidence for the corrected test revision. Interface revision 2 was also
recorded red at `2026-09-11T00:29:53Z`: 127 collected, 30 passed, 97 failed, no
skips or source drift. Interface revision 3 adds the approved Google-beta exception
and production-dependency/runtime assertion. Revision 4 adds the approved
executor self-signing constraint and reconciles target-owned storage and relative
fixed Node entrypoint. Its timestamped red directory is
the handoff evidence for that revision, with a complete before/after SHA-256
manifest. Revision 5 adds the native Monitoring policy/channel requirement and
gets a separate red capture; earlier captures remain immutable historical records.
Revision 5 red is retained at `red-2026-09-11T00-34-27-439Z`: 131 collected,
99 passed, 32 failed. Its test SHA-256 is
`caaf57f249e22413a853e3b425ed7642f662adf721ee050b9c5587719794d166`.
That capture recorded concurrent drift in the API Dockerfile-specific ignore file;
it must not be described as drift-free. Earlier drift-free red captures remain
separate historical records.

The later helper-binding correction passed 131/131 at
`green-2026-09-11T00-56-12-834Z`, no skips or source drift. Its test SHA-256 is
`bec3e87f09ce32b775dc2587da2e6139bd95d11799e3c80b5132dce3ee26ea78`.
The authorized aggregate migration has a before-change red at
`workflow-red-2026-09-11T00-55-44-314Z`: 44 cases, 5 passed, 39 failed, no drift.
The first post-migration run has 63 cases, 62 passed, one failed: the unchanged
diagnostic-upload assertion also catches the new push-only coverage evidence
upload. All aggregate shell truth-table cases pass. The parent later authorized
independent assessment of that distinction. A fresh 62/63 red was retained at
`workflow-red-2026-09-11T01-05-33-896Z`, with no drift, before correcting it.

The corrected assertion exempts only the exact SHA/attempt-named `release-coverage`
upload in the verify job, requires the fixed `coverage.json` path, rejects missing
files, and requires exactly one preceding `pnpm release:coverage` after full
verification. Export and upload must use push-only successful-step conditions.
Every job still needs separate `always()` diagnostics; all other uploads retain
the original constraint. Seven negative controls reject conditional/missing
diagnostics, always-uploaded coverage, broad paths, missing exports, PR exports,
and ignored missing data. The resulting suite passed 70/70 at
`workflow-green-2026-09-11T01-09-44-297Z`, with unrelated concurrent `cli.mjs`
drift recorded. This is a source/shell contract, not hosted expression execution.
GitHub applies an implicit success condition when an `if` expression has no
status-check function; see
[GitHub status-check semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#status-check-functions).

Mock-plan capture `mock-plans-2026-09-11T00-57-29-930Z` passed all 44 runs:
bootstrap 10, delivery 12, target 22, no failures/skips/drift. It also records
separate successful `fmt -check` and `validate` commands for all three roots.
Earlier mock captures retain the incomplete computed-value fixture failures and
expected-validation correction lineage; those were test harness issues, not proof
of insecure production behavior. The 00:54:51 capture also records architecture
document drift and is not used as stable verification evidence.

Cache regression red `files-red-2026-09-11T00-56-59-161Z` collected six cases:
three failed because default `listFiles` included `.terraform` bytes, three passed
for candidate visibility/layout denial and unchanged explicit inventories. No
skips or source drift. Test SHA-256:
`90994c86b6d470ea99be8dfd22e80353d06507dcd1adc2f465f1d3b1b2114f8e`.
Only default working inventories may omit the exact `.terraform` directory;
candidate and explicit release-output/evidence inventories must still expose it.
State, plan and tfvars outside the cache remain visible and denied by layout.
These tests use existing owned temporary fixtures; no shared fixture/harness or
release-output scanner edit is authorized by the cache regression.

After the parent's default-only exclusion change, the cache suite passed 8/8 at
`files-green-2026-09-11T01-09-48-794Z`, no drift. Two new cases confirm candidate
inventory still exposes provided `gha-creds-*.json` files and the real policy
rejects them. The exact ignore pattern already existed; no missing-ignore red or
author production edit is claimed.

## Pinned CI Integration

Parent-owned production integration uses the existing required `verify` job, not
a new aggregate dependency. The independent source contract requires Terraform
1.16.2 from the official Linux AMD64 ZIP, with SHA-256
`0d17011f0c4664539b164b044903d04e296c86c13cb9f28040076c65cfb3985a`.
The checksum was independently read from HashiCorp's public
[1.16.2 checksums](https://releases.hashicorp.com/terraform/1.16.2/terraform_1.16.2_SHA256SUMS).
The download must be checked before extraction and installation to
`/usr/local/bin/terraform`. No credentials, backend configuration, live plan,
apply, destroy, upgrade or skipped check is allowed. Each of bootstrap, delivery
and target must execute, in order:

```sh
terraform -chdir=infra/gcp/ROOT fmt -check -recursive
terraform -chdir=infra/gcp/ROOT init -backend=false -input=false -lockfile=readonly
terraform -chdir=infra/gcp/ROOT validate
terraform -chdir=infra/gcp/ROOT test
```

`ROOT` denotes each fixed root, not operator input. Explicit commands or the fixed
`for root in bootstrap delivery target; do ... done` loop are supported. The small
source recognizer is intentionally not a general shell interpreter. Init's
backend/lock options follow the
[official CLI contract](https://developer.hashicorp.com/terraform/cli/commands/init).
All committed test run blocks must explicitly use plan and mock every configured
provider/alias; no default apply, unmocked provider or external test module.

The release publisher separately installs GH 2.100.0 from its official Linux
AMD64 archive, checking the parent-provided SHA-256
`e4d4bb4498e8d007abe545b6568926793ace1b6447da598294a610018cb164be`
before extraction/install to `/usr/local/bin/gh` and before `pnpm release:publish`.
Transport source may select certificate identity or signer workflow, never both;
actual argv/signature semantics remain owned by transport behavioral tests.

The publisher's pinned Google auth step must request an access token. Pinned
`docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9` then consumes only
that step's access-token output, username `oauth2accesstoken`, registry
`us-central1-docker.pkg.dev`, with post-job logout enabled. Login precedes publish
and exists nowhere in dispatch. Google credential cleanup remains enabled.
No private key payload, manual token echo or shell login is accepted.

Both image and topic workflows take delivery project/WIF/publisher identifiers
from fixed `secrets.STARA_*` bindings, and fixed artifact/repository/topic/config
inputs from secrets through environment data. This supersedes the earlier use
of GitHub vars and the incidental blanket ban on secret references inside the
dispatch auth inputs. Public PR/fork checks remain secret-free and without OIDC.
Masking those operational identifiers is not permission to introduce application
secret payloads, and does not prove all transformed/encoded log content is safe.
Application secrets remain in the separately reviewed GCP Secret Manager boundary.

Installer/three-root CI red was captured at `red-2026-09-11T01-08-26-637Z`:
140 cases, 135 passed, five missing-integration failures, no skips/drift. The
subsequent registry/secret-backed binding contract red is
`red-2026-09-11T01-09-32-840Z`: 144 cases, 136 passed, eight expected failures,
no skips/drift. Frozen test SHA-256:
`08497a43fd54df0a4cb8b657f61f6e27e6996a96f4635c6341febdeaaafb328d`.
These static checks do not execute installers, publish images, validate action
post-job cleanup or prove redaction. Actual runner/image/registry evidence remains
required. Local mocked plans were rechecked at
`mock-plans-2026-09-11T01-09-51-698Z`: 44/44 plus separate formatting/validation,
no skips/drift, using existing initialized provider caches, not live cloud access.

The publisher is target-neutral: its secret-backed inputs are only artifact bucket
and image repository. Configuration SHA remains required only at dispatch. The
parent requested removal of that incidental publisher requirement after glue
implementation; no dispatch assertion was loosened. Corrected static suite passed
144/144 at `green-2026-09-11T01-16-27-820Z`, no skips/drift; test SHA-256
`b49556a5b18d2886756b2ea6f5403c5717ad64996011e6e3afe5cba29b5d3118`.

The subsequent P1 private CodeQL correction adds one target mock run, requiring
`policy.workflows.codeql.workflowRef = "dynamic/github-code-scanning/codeql"`
and both `Analyze (javascript-typescript)` and `Analyze (actions)` job names,
without duplicate jobs. The raw reference is the parent's chosen contract, not
the superseded normalized-prefix/main-suffix proposal. New target test SHA-256:
`be5fb813e2b6f2014d684ee6988de8bf238c203469fb01c7d29110dbf8fbc36d`.
Independent red `mock-plans-2026-09-11T01-14-50-849Z` has bootstrap 10/10,
delivery 12/12, target 22 passed/1 failed at the missing CodeQL policy assertion;
no skips or drift. Formatting and validation still pass. This updates the scope
from 44 to 45 mock runs; the earlier 44-run green does not cover the new policy.

The parent subsequently authorized a controlled runtime-base correction after
reporting real HIGH/CRITICAL scan failures. Existing source assertions now require
exact Node 24.16.0 Alpine runtime digest
`21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a`
and unprivileged NGINX 1.30.4 Alpine runtime digest
`442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce`.
The prior exact Node Bookworm digest remains confined to build/dependency stages;
no broad FROM allowlist or development-image change is authorized. Hume owns new
runtime-image regression tests; this author only reconciled the existing fixture.
Independent static red `red-2026-09-11T01-26-17-590Z` has 144 cases, 142 passed,
two old-runtime-pin failures, no skips/drift. Test SHA-256:
`32d28cba8b975ea8c2b2197f8c1dd5f9d7b032f34d5dd82b2df9fe8c25569b88`.
This is a pin contract, not a vulnerability-scan pass or severity waiver.

## Hosted Linux Lockfile Remediation

The first hosted PR #4 Terraform failure was independently inspected through the
GitHub job-log API: run `34552891330`, job `103119290684`, candidate
`abe57bfa056596b5d88e4b6dac1f709548f4df47`. The existing required CI command
`init -backend=false -input=false -lockfile=readonly` installed Google 8.2.0,
reported it signed by HashiCorp, and returned initialization success with a
`Provider lock file not updated` warning. The following `validate` rejected the
cached provider package because none of its checksums matched the lockfile.
This is actual hosted Linux red, not a mocked Terraform or download-signature
failure. Filtered evidence is retained in ignored
`.artifacts/release-infra-test-author/hosted-linux-lock-red-34552891330.json`.
The parent separately reported the same actual Linux reproduction in an isolated
Alpine container with fresh provider data and no credentials.

The original locks contained their Windows package `h1` values and the signed
release `zh` checksums, but not Linux's package `h1`. Native multi-platform lock
generation is the reviewed remedy; read-only CI must not repair its own inputs.
With the pinned Terraform 1.16.2 executable, regenerate through the origin
registry without an upgrade, mirror override or unverified plugin cache:

```powershell
$terraform = '.artifacts/tools/terraform/1.16.2/terraform.exe'
foreach ($root in @('bootstrap', 'delivery', 'target')) {
  & $terraform "-chdir=infra/gcp/$root" providers lock -platform=linux_amd64 -platform=windows_amd64
  if ($LASTEXITCODE -ne 0) { throw "Provider locking failed for $root" }
}
```

Review native signing output and the resulting diff before accepting it.
HashiCorp documents explicit platform locking for this cross-platform case in
the [providers lock reference](https://developer.hashicorp.com/terraform/cli/commands/providers/lock).
The parent owns generation; the author made no lockfile or production edits.
Independent diff review found only these additions, with no removals, version,
constraint, source, resource, IAM or workflow changes:

- Google 8.2.0 in all three roots:
  `h1:Y6nbie6TYtIO7IBucSdIh01BVIloBNgsfUulhaRj2Q4=`.
- Google Beta 8.2.0 in delivery and target:
  `h1:6tEo5OEQMAjS/zib5MY85Egckwhzx0/EW7AyUjXyESU=`.

All original Windows `h1` and signed-release `zh` entries remain unchanged. Reviewed
lockfile SHA-256 values are bootstrap
`f21de9af5aa3b96ff87b833e0e938c56829fd8ce51c6533ded4b6f9298e1e88e`,
and delivery/target
`4d323781f644bcaeca7624a216758452f99be5af5c7aa86035e177a947606ab3`.
These hashes identify the reviewed files; counting `h1` entries would not prove
which platforms they cover, so no superficial count assertion was added.

The regression remains the existing real CLI sequence for each root on fresh
Linux and Windows provider data: pinned `fmt -check -recursive`,
`init -backend=false -input=false -lockfile=readonly`, `validate`, then all mocked
`test` plans. Require no lock-update warning, no checksum failure, and byte-identical
locks before/after; retain the 45-run total and the existing no-live-IAM limitation.
Parent owns those post-generation runs and the next hosted rerun. Their completion
must be recorded separately rather than inferred from this diff review.

At patch handoff, the parent reported native generation complete for all three
roots with HashiCorp-signed packages, followed by fresh Linux read-only init and
validate plus all 45 mock plans passing (bootstrap 10, delivery 12, target 23;
session `41078`, exit 0). The author rechecked the five-addition diff and file
hashes; Kant independently reported no new finding. These Linux results are
parent-executed, not an additional author run. The first hosted run finished with
Windows checks, Release image verification and Container journeys passing, while
Candidate/Required failed on the reproduced lockfile issue. Hosted Windows checks
are not substituted for a separate fresh Windows Terraform run. The author has
no objection to committing/pushing this checksum-only remediation; the next
hosted run and retained cross-platform evidence determine final runtime closure.

The author's extra local Linux attempt stopped before Terraform execution because
the selected existing container lacked `unzip`; its verified CLI archive download
does not make that attempt a Terraform red. The incomplete attempt is retained
at `linux-lock-red-2026-09-11T02-04-37-613Z`. It was not retried after the parent
confirmed sufficient hosted and local Linux evidence. No cloud credentials,
remote backend, plan/apply operation, test weakening or artifact-upload workaround
was introduced.

Live IAM and image builds: Not executed by this author. Hosted failure logs were
inspected as described above; hosted jobs were not dispatched by this author.

References checked while reconciling the source assertions:
[Google Cloud build log storage](https://docs.cloud.google.com/build/docs/securing-builds/build-log-storage),
[user-specified build accounts](https://docs.cloud.google.com/build/docs/securing-builds/configure-user-specified-service-accounts),
[WIF principal sets](https://docs.cloud.google.com/iam/docs/workload-identity-federation).

Handoff conclusion: More journey evidence required.
