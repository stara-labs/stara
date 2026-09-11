# Release Architecture

Status: Implementation contract; live infrastructure not yet provisioned
Requirements: [Restricted staging releases](requirements/releases.md)
Owner: Responsible Engineering owner

## Trust Boundaries

Public GitHub validation remains read-only and secret-free for PRs and forks.
Only an approved mainline workflow receives short-lived WIF credentials to the
artifact publisher and staging-topic publisher identities. Numeric GitHub
organization/repository identities and exact workflow/ref conditions constrain
trust. Publishing authority does not include deployment, private configuration,
state reads, Secret Manager access, or service-account impersonation beyond the
named publisher identity.

The private executor is a fixed, reviewed, digest-pinned control image in an
inline Cloud Build configuration. It does not execute source, scripts, URLs,
service accounts, or destinations supplied by Pub/Sub messages. It uses a
target-specific identity and private logs. Changing controls or target
configuration requires reviewed infrastructure maintenance, not an application
release signal. Pub/Sub delivery is at least once; the durable state protocol
must tolerate duplicates and crashes.

## Candidate Interface

All structured inputs are strict JSON with unknown and duplicate keys rejected.
Source identities use lowercase full Git SHAs and image identities use SHA-256
digests, never mutable tags. Messages are bounded to 4 KiB and have exactly:

```json
{
  "schemaVersion": 1,
  "sourceSha": "1111111111111111111111111111111111111111",
  "manifestSha256": "2222222222222222222222222222222222222222222222222222222222222222",
  "configurationSha256": "3333333333333333333333333333333333333333333333333333333333333333"
}
```

The executor resolves this reference only within its configured immutable
candidate storage. A manifest binds source, repository identity, web/API image
digests, attestation bundle digests, and exact scaffold, CodeQL and image-verification run
identities. Manifest bytes are hashed before parsing. Size limits and fixed
storage paths apply to every downloaded object.

Manifest statements alone are not evidence. The executor independently reads
GitHub run/job identities, verifies completed successful approved workflows for
the exact source, checks the current main candidate, and verifies signed artifact
provenance against the fixed repository/workflow trust roots and the manifest's
exact image run and attempt. A successful historical attempt cannot conceal a
later pending or failed rerun. CodeQL selection also requires the newest matching
workflow run by its native workflow ordinal, not the largest run ID or the first
successful result. Incomplete or ambiguous inventories, including more than 100
matching runs, are denied. It rechecks
eligibility before changing traffic. Artifact repositories and service names
come from private target configuration, never a dispatch payload.

Artifact publication is target-neutral and does not require a configuration
hash. The dispatcher adds the approved target configuration identity only when
requesting deployment. This lets reviewed mainline artifacts exist before target
bootstrap and allows dedicated targets to consume identical images. Missing
configuration still prevents dispatch and private execution.

## State and Failure

An atomically created target lock serializes attempts. A durable receipt binds
the request to manifest/configuration identities and the original execution
deadline. Terminal duplicates return the recorded state. Concurrent different
requests cannot mutate a locked target; superseded candidates cannot overwrite
newer deployments. A crash does not release ownership automatically. A duplicate
of an active request before its original deadline returns `running` without
writing state or interrupting its owner; this is not deployment success. At or
after that deadline it requires reconciliation, preserving ownership and intent.

The target record contains only the lock and its active receipt. Terminal
receipts are immutable, separate objects archived before conditional lock
release. Active state outranks a provisional archive, and historical requests
cannot change a successor's lock. Finalization freezes archive bytes across
known generation conflicts; mismatched archives or material state changes halt
for reconciliation. History is neither loaded into the active record nor truncated.

Record intent durably before each side effect and record its observed outcome
afterward. A deployment mutation whose outcome is unknown retains the lock and
halts for operator reconciliation; it cannot become an ordinary retry. An
ambiguous final lock-release response may already have committed: inspect the
actual target and archive objects rather than assuming the lock is retained.
Reconciliation
must inspect Cloud Run operations and actual revisions/traffic before authorizing
any further mutation. Operators never clear locks solely because a clock expired.

Create ready revisions without switching traffic, preserving existing allocation.
Capture and verify current traffic before the first switch. Web and API switches
are separate operations; the application contract must tolerate their mixed
revision window. Before-switch failures leave traffic untouched. After-switch
failures remain degraded, with a sanitized corrective work item and private
diagnostics. The system does not automatically restore older traffic or edit code.

The 30-minute total starts on first durable admission. Waiting/backoff and resumed
work consume that original deadline. Rollout and post-switch probe clocks begin
when their stages are durably entered and never reset. Each deadline is capped
by the total. Only classified transient, side-effect-free reads can retry twice;
all attempts and failures remain recorded. Pub/Sub/Cloud Build redelivery cannot
restart a terminal receipt.

## Infrastructure Ownership

Terraform lives under `infra/gcp/`; release controls live under `tooling/release/`.
Application Dockerfiles remain under `UI/web/` and `backend/api/`. Separate Stara
delivery and staging projects use separate state, identities, and configuration;
a temporary third project proves denied cross-target access. No production
project, DNS record, service identity, or publisher binding is provisioned.

The HTTPS application load balancer sends `/api/*` to API and other paths to web.
IAP protects both backend services, which invoke restricted Cloud Run services.
Ingress and invocation permissions prevent direct `run.app` bypass. Only an
explicit allowlist may use staging; customer authentication remains deferred.
The existing DNS provider and zone remain authoritative.

Terraform stores resources, secret references, and IAM only, never secret payloads.
State, plans, real environment configuration and diagnostics remain private and
excluded from Git, container contexts, and public artifact uploads. Public CI
does not receive live browser authentication material. Application public runtime
configuration contains no operational identifiers or credentials.

Public provenance subjects are `stara/web` and `stara/api` plus their digests.
The private registry location is supplied separately for OCI verification; it
is not written into the public attestation. Verified certificate identities
bind the GitHub repository, owner, mainline workflow, source and hosted run.
User-controlled provenance predicates cannot establish those identities.

The public `Release images` push workflow waits for complete exact-SHA scaffold
and CodeQL checks before its scoped publisher job. The separate workflow-run
dispatcher waits for the entire image workflow to finish; publishing an early
request cannot race an incomplete image-verification job. Both paths fail closed
when deployment wiring is absent. Forks and PRs use only read-only verification.

Corrective work items are private Cloud Monitoring incidents, not public GitHub
issues. The executor only submits an allowlisted terminal event to private logs;
that acknowledgement does not prove incident creation or email delivery. A
separate Cloud Build error policy covers crashes before terminal notification.
Monitoring notification rate limits and inactivity closure do not clear durable
failed/degraded/reconciliation state. Operators must verify actual recovery.

## Versioning and Activation

Semantic-release provides established commit analysis and release notes. Packages
remain private, npm publication is disabled, and no release commit modifies the
verified source. Staging uses SHA/digest identities and requires no production tag.
Documentation-only outcomes are explicit no-release results, not failed releases.

Future production activation is a separately reviewed change with exact candidate
and target authorization by different authenticated requester/approver identities.
Simulations may exercise that rule but cannot activate a live target. Immutable
production tags are created only after complete verification and independent
human approval. Licensing does not grant deployment authority.

## Outstanding Activation Inputs

Engineering approved the Stara organization and billing scope, recorded privately.
The owner confirmed two Google staging users; identities are entered into
private provisioning inputs, not application runtime configuration. Exact
project identifiers, DNS authorization, and
private configuration are established through authenticated bootstrap, not
public records. Missing inputs fail closed. The budget target is an alerting
policy, not a guaranteed cost ceiling or an automatic service shutdown rule.
