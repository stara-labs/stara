# Restricted Stara Infrastructure

These are reusable Terraform root modules for the approved synthetic-only
staging release evaluation. Production is disabled and no production project,
DNS record, service, identity, or dispatch binding is provisioned. The sole
allowed hostname is `staging.app.stara.co`. Regional workloads and buckets use
`us-central1`; global HTTPS, certificate, IAM, billing, and Logging control
resources retain their required global scope.

Terraform is exactly **1.16.2**. Both Google providers are exactly **8.2.0**.
`google-beta` is used only to generate managed service identities; the stable
provider's tagged implementation does not expose that resource. All other
resources use `google`.

## Ownership and State

| Root        | Creates                                                                                                                                                                                                        | State                                                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap` | Owner-specified delivery and staging projects, optional temporary isolation project, explicit APIs, a protected Terraform state bucket per project, combined budget                                            | Initially local at ignored `.artifacts/private/bootstrap/terraform.tfstate`; mandatory independent private backup before target planning |
| `delivery`  | Immutable application and control repositories, immutable artifact publication, separate GitHub identities and trust providers, private executor, staging topic/trigger, private logs and corrective incidents | Explicit GCS backend configuration using the delivery project's own Terraform bucket                                                     |
| `target`    | One staging or isolation target, distinct web/API runtime accounts, services, private configuration and receipt-state buckets; HTTPS/IAP only when enabled for staging                                         | Explicit GCS backend configuration using that target project's own Terraform bucket                                                      |

Terraform state, plans, backend files, operational inputs, raw outputs, logs and
diagnostics are private. Store them under ignored `.artifacts/private/` or in
owner-controlled storage outside the checkout, with access restricted to the
operator. Git ignore rules alone are not access controls. Never upload these
files as public Actions artifacts or put them in image build contexts.

Terraform state buckets and executor receipt buckets are different resources.
The executor has no access to any Terraform state bucket. It reads its own
configuration bucket and has object administration only in its own receipt
bucket. Each target has a distinct project and independently initialized backend;
Terraform workspaces are not the isolation boundary. There are no remote-state
data sources giving target A access to target B.

Bucket uniform access, enforced public-access prevention, versioning,
`force_destroy = false` and `prevent_destroy = true` are explicit. No service
account keys, secret payloads, OAuth client secrets, or Secret Manager grants
are created. Future secret use requires a separately reviewed configuration.

## Private Inputs

There are no real owner, billing, project, user-email, or image-digest defaults.
Supply these through private `*.tfvars` files; do not create a populated example
file in the repository.

| Root             | Required private inputs                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bootstrap        | `organization_id`, `billing_account_id`, `project_ids = { delivery, staging, isolation? }`                                                                                                                                   |
| Delivery         | `project_id`, `staging_project_id`, `executor_image`, `operator_email`                                                                                                                                                       |
| Staging target   | `project_id`, `delivery_project_id`, `environment = "staging"`, `initial_images = { web, api }`, `artifact_bucket`, `staging_executor_service_account`, `iap_users`, `bootstrap_state_backup_path`, `bootstrap_state_sha256` |
| Isolation target | Its own `project_id`, shared `delivery_project_id` and `artifact_bucket`, `environment = "isolation"`, `enable_load_balancer = false`, `initial_images`, and backup path/hash; omit the staging executor                     |

The optional `region` input is constrained to `us-central1`. Project identities
must be distinct and non-production. Initial images must be full SHA-256
references to the matching delivery `app/web` and `app/api` paths. The control
image must be `us-central1-docker.pkg.dev/<delivery-project>/control/executor@sha256:<digest>`.
Its bytes must independently contain the reviewed executor, Node entry point,
and `gh` 2.100.0-stara.1; an application publisher cannot write the control repository.
This is the reviewed source build described in
[release operations](../../docs/release-operations.md#provenance-verifier), not
the unpatched upstream release binary.

The owner needs permission to create projects under the selected organization,
attach the selected billing account, enable APIs, and manage the declared
resources and IAM. ADC is supplied privately by the owner. The Terraform
provider enables no broad publisher or runtime project role. Before activation,
review inherited organization/folder/project permissions independently: these
modules cannot prove that an inherited grant does not broaden an identity.

## Initialization and Review

The following commands initialize and validate only. Run from the repository
root. `$private` and `$tf` are local operator paths, not cloud identities:

```powershell
$tf = (Resolve-Path .artifacts/tools/terraform/1.16.2/terraform.exe).Path
$private = Join-Path (Get-Location) '.artifacts/private'
New-Item -ItemType Directory -Force -Path "$private/bootstrap" | Out-Null
& $tf -chdir=infra/gcp/bootstrap init
& $tf -chdir=infra/gcp/bootstrap validate
```

After the bootstrap plan receives independent review and the authorized owner
provisions it, back up the initial local state **before any target plan/apply**:

1. Pause bootstrap modifications and hash the actual local state with SHA-256.
2. Copy it to a separate, access-restricted private backup outside the active
   state path. Keep an independent copy in approved private backup storage.
3. Hash the backup and compare it to the source. Record both hashes, timestamp
   and backup location privately. Repeat after every bootstrap state change.
4. Supply the absolute backup path and lowercase source SHA-256 to the target
   variables. Target variable validation reads the backup and fails if it is
   missing, differs from the recorded hash, or is the active state path.
5. Verify recovery permissions and retain the backup independently of the
   projects being provisioned. Do not rely solely on a bucket created by that
   same bootstrap state.

Use the sensitive `bootstrap.backend_configuration` output to create separate
private GCS backend files. Each file contains only its own `bucket` and
`prefix`; never credentials. Delivery and target deliberately have empty
`backend "gcs" {}` declarations so init cannot silently select a live backend.
Use separate Terraform data directories when using the target root twice:

```powershell
$env:TF_DATA_DIR = "$private/terraform/delivery"
& $tf -chdir=infra/gcp/delivery init -reconfigure "-backend-config=$private/delivery.backend.hcl"
& $tf -chdir=infra/gcp/delivery validate
$env:TF_DATA_DIR = "$private/terraform/staging"
& $tf -chdir=infra/gcp/target init -reconfigure "-backend-config=$private/staging.backend.hcl"
& $tf -chdir=infra/gcp/target validate
$env:TF_DATA_DIR = "$private/terraform/isolation"
& $tf -chdir=infra/gcp/target init -reconfigure "-backend-config=$private/isolation.backend.hcl"
& $tf -chdir=infra/gcp/target validate
Remove-Item Env:TF_DATA_DIR
```

Keep every plan under private storage and use the matching private variables.
Check the resolved backend bucket/prefix before planning. Never pass a
previously used target's backend directory to a different project.

For provider/schema validation without accessing a state backend:

```powershell
foreach ($module in @('bootstrap', 'delivery', 'target')) {
  & $tf "-chdir=infra/gcp/$module" fmt -check
  & $tf "-chdir=infra/gcp/$module" init -backend=false -input=false -lockfile=readonly
  & $tf "-chdir=infra/gcp/$module" validate
}
```

Initialization may download pinned providers but must preserve the committed
lock files; it does not deploy resources. When intentionally updating providers,
the owning maintainer generates signed package checksums for both supported
platforms through the origin registry and reviews the diff:

```powershell
foreach ($module in @('bootstrap', 'delivery', 'target')) {
  & $tf "-chdir=infra/gcp/$module" providers lock -platform=linux_amd64 -platform=windows_amd64
  if ($LASTEXITCODE -ne 0) { throw "Provider locking failed for $module" }
}
```

Verify fresh read-only initialization and validation on Linux and Windows before
accepting the generated locks. Do not let CI rewrite checksums or remove package
verification to repair a platform mismatch. See HashiCorp's
[platform locking guidance](https://developer.hashicorp.com/terraform/cli/commands/providers/lock).
Independent test-author mocked plans must evaluate both target variants,
optional bootstrap isolation, combined budget membership, invalid inputs, and
resolved IAM references. Mocked plans and source tests do not establish live
IAM, IAP, DNS, image content or incident-delivery acceptance.

## Restricted Traffic and Identity

Both Cloud Run v2 services require invoker IAM, use internal/load-balancer
ingress, and disable their default URI. Only the project's generated IAP service
agent has the service invoker role. Web and API have separate runtime accounts
with no granted secret or project access. Each service uses one CPU, 512 MiB
(the second-generation minimum),
request-based CPU allocation, min zero/max two instances, and port 8080. Service
and revision scaling are both capped.

Cloud Run's Terraform schema cannot set the Linux user. The initial and promoted
image bytes must pass the independent non-root runtime/image tests; a digest by
itself is not proof of that property. Terraform ignores subsequent image,
revision-name and traffic changes owned by the release executor, while continuing
to manage service restrictions, identities and resource limits.

The HTTPS load balancer uses two serverless NEGs, IAP on both backends, a
Certificate Manager DNS authorization and managed certificate, and TLS 1.2 or
newer. `/api` and `/api/*` reach API; other paths reach web. No public invoker
grant, HTTP frontend, direct domain mapping, or DNS-zone modification is made.
The sensitive `target.dns_records` output exports the staging A and authorization
CNAME records for the existing authoritative DNS provider. Isolation emits no
DNS records and cannot enable a load balancer.

`iap_users` must explicitly list individual `user:email` members. Google-managed
IAP clients restrict browser users to the owning organization. Supporting
external users would require a separately reviewed identity configuration.
The executor also receives IAP access on both backends for probes. Its only
signing permission is `iam.serviceAccounts.signJwt`, bound to its own account.
The reviewed CLI uses IAM Credentials to sign a ten-minute JWT for
`stagingOrigin + "/*"`; no key material is generated or stored by Terraform.

## Fixed Execution and Configuration

Image publication is trusted only for numeric owner `293455507`, repository
`1363262992`, main, `release.yml`, and a push event. Dispatch uses a separate
provider and pool and requires main, `dispatch.yml`, and `workflow_run`.
Both providers check the exact full workflow reference. Each publisher binding
selects its own mapped identity, never a whole pool. The image identity has
writer access only to `app` and object-creator access only to the artifact bucket.
The dispatcher can publish only to the staging topic.

The inline trigger runs the required digest-pinned control image, with
`entrypoint = "node"`, `dir = "/app"`, and arguments
`["tooling/release/cli.mjs", "execute"]`. There is no source checkout or shell.
The total build timeout is 1800 seconds; queue TTL is 300 seconds. The reviewed
executor independently retains its original durable deadline across deliveries.

The Pub/Sub message data is JSON `{ "payload": "<base64>" }`. The decoded payload
is the strict four-field dispatch JSON from the release architecture.
`_PAYLOAD = "$(body.message.data.payload)"` reaches only the
`STARA_DISPATCH_PAYLOAD` environment variable. Cloud Build dynamic substitution
is mandatory for triggers; no substituted value is evaluated as shell code,
an executable, an image, a destination, or configuration. The Node CLI must
strictly validate the canonical base64 and decoded bytes before side effects.

`STARA_CONFIGURATION_URI` is fixed to the target project's private
`gs://<target-project>-release-config/targets/staging.json`.
Target Terraform writes `jsonencode` of exactly:

```text
schemaVersion, targetId, environment, policy, projectId, region,
services: {web, api}, runtimeServiceAccounts: {web, api},
imageRepositories: {web, api}, executorServiceAccount, loggingProjectId,
artifactBucket, stateBucket, stagingOrigin
```

The policy pins repository/workflow/job identities and all four required coverage
targets. Services, image repositories and storage never come from messages.
`configurationSha256` is absent from the object: `configuration_sha256` hashes
the exact bytes Terraform writes, and the CLI independently hashes bytes read.
Only that hash, along with explicitly exported publisher wiring, belongs in
masked GitHub repository secrets. The `private_target` output and configuration body stay private.
Artifacts use `manifests/<sha256>.json` and `attestations/<sha256>.jsonl`;
the bounded active record uses `targets/<targetId>.json` and immutable terminal
receipts use `receipts/<receiptId>.json` in the separate receipt bucket. Archive
creation precedes conditional lock release; an active record outranks a
provisional archive until that release completes.

Isolation creates its own executor, runtime identities, config, services, receipt
state and Terraform backend. Staging's executor receives no isolation grant.
The isolation config has `environment = "isolation"`, so the staging-only CLI
rejects it for promotion. The temporary project exists to prove real denied
cross-target permissions while shared immutable application artifacts remain
readable. Keep it in the combined budget through the drill and cost review.

## Private Corrective Incidents

`operator_email` creates a private Monitoring email notification channel.
An enabled log-match policy watches the delivery project's `stara-release` log
for `release_terminal` with failed, degraded or reconciliation-required status.
The CLI writes only its reviewed structured terminal schema and uses an
insert ID bound to receipt/status. It must not report notification success when
the Logging write fails. Logs alone do not constitute successful email delivery;
verify channel delivery independently before enabling dispatch.

A second policy watches Cloud Build system failure/timeout log entries and
Cloud Build audit errors, including crashes before the CLI can notify. Verify
image-pull failure, process failure and timeout drills against actual Cloud Build
logs before acceptance; matching source filters are not evidence of delivery.
Both policies rate-limit notifications to 300 seconds and auto-close after seven
days without data. Cloud Logging retains operational logs for 30 days and neither
publisher can read them.

The Monitoring incident is the private corrective operator work item; this
milestone creates no GitHub issue or GitHub credential. The operator investigates
the receipt, current revisions, traffic and Cloud Run operations privately,
retains uncertain locks, and links a reviewed repair PR in the incident.
Only a freshly verified forward candidate and verified recovery justify operator
closure. Automatic inactivity closure is administrative, never evidence of
recovery, permission to release a lock, or permission to retry an unknown mutation.
No automatic rollback, inline source repair or blind mutation retry is provided.

## Activation and Cost

Provision bootstrap first, verify its independent private backup, then provision
delivery with `enable_dispatch = false`. Publish the owner-reviewed control image
to `control` separately and verify its digest/contents. Provision the target
with independently verified initial images, publish only the exported staging DNS
records, and verify IAP users, direct-URL denial, API routing, private incident
delivery, configuration identity and real cross-target denials.

Only after independent implementation review and explicit owner authorization,
set the matching GitHub publisher secrets and configuration hash and enable
dispatch. The GitHub values identify publishing resources; they carry no
deployment/config/state access. Exercise merged-main automatic staging and
record exact private source/test/config/image/actor identities. Terraform
validation, mocked plans and a successful build are not live acceptance.

The combined **USD 100/month** budget includes delivery, staging and enabled
temporary isolation, with alerts at **50%, 80%, 100%**. It is not a spending cap.
There is no automatic shutdown. Load balancing, build time, retained artifacts,
logs and storage can incur charges even while Run scales to zero. Protected
state/config buckets require an explicit reviewed preservation/teardown
procedure; do not remove protection just to make a cleanup command succeed.

With no custom `budget_notification_channels`, bootstrap omits the optional
notification block to match Google's representation of default settings.
Default billing IAM notifications remain enabled. Supplied email channels are
additive and explicitly preserve those default recipients. See Google's
[notification rules](https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets#NotificationsRule).

## Primary References

- [Google 8.2.0 Cloud Run v2 schema](https://github.com/hashicorp/terraform-provider-google/blob/v8.2.0/website/docs/r/cloud_run_v2_service.html.markdown)
- [Google 8.2.0 backend/IAP schema](https://github.com/hashicorp/terraform-provider-google/blob/v8.2.0/website/docs/r/compute_backend_service.html.markdown)
- [Google 8.2.0 Cloud Build trigger schema](https://github.com/hashicorp/terraform-provider-google/blob/v8.2.0/website/docs/r/cloudbuild_trigger.html.markdown)
- [Google 8.2.0 service identity limitation](https://github.com/hashicorp/terraform-provider-google/blob/v8.2.0/website/docs/r/project_service_identity.html.markdown)
- [Pub/Sub payload bindings](https://docs.cloud.google.com/build/docs/automate-builds-pubsub-events)
- [IAP programmatic service-account JWT authentication](https://docs.cloud.google.com/iap/docs/authentication-howto)
- [Cloud Run cross-project image permissions](https://docs.cloud.google.com/artifact-registry/docs/integrate-cloud-run)
- [Workload Identity Federation principal scopes](https://docs.cloud.google.com/iam/docs/workload-identity-federation)
