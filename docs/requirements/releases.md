# Restricted Staging Releases

Status: Approved requirements; implementation and acceptance evidence pending
Decision owner: Stara Product Owner and responsible Engineering owner
Approval: Secure Stara Releases plan, 2026-09-10
External authority: Product System `60f949e21d0fbe82dbdda5801715dbe1172e7b1b`

## Outcome and Scope

Verified mainline application artifacts reach restricted internal staging without
an operator initiating every deployment. Deployment capability does not imply
authentication, persistence, customer readiness, or Product System conformance.
Issue #1 remains open until separately accepted.

This milestone uses synthetic data only, Stara-managed GCP projects in
`us-central1`, and `https://staging.app.stara.co`. Production's reserved origin is
`https://app.stara.co`; production resources, DNS, deployment permissions, and
dispatch bindings are absent. The region is not a customer residency promise.

## Accepted Decision Register

| ID      | Decision                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REL-D01 | Restricted internal staging and synthetic data only; no public preview or customer activation.                                                                                                          |
| REL-D02 | Dedicated deployments initially use separate Stara-managed projects, identities, configuration, and state. Customer-owned projects are deferred.                                                        |
| REL-D03 | Verified exact mainline candidates automatically advance to the configured staging target only. No automatic fleet-wide promotion.                                                                      |
| REL-D04 | Production is disabled. Future activation requires a separately reviewed change and exact candidate/target approval by the other authorized human, never self-approval.                                 |
| REL-D05 | Staging rolls forward through bounded deployment attempts and reviewed repair PRs, not automatic rollback or inline code repair.                                                                        |
| REL-D06 | Failures before traffic change preserve running traffic; failures after traffic change mark staging degraded, notify operators, and await a freshly verified forward fix.                               |
| REL-D07 | A persistent, non-dismissible staging notice states the synthetic-only and non-durable nature of the application.                                                                                       |
| REL-D08 | Public evidence contains only allowlisted versions, commit identifiers, architecture, and synthetic results. Operational configuration, identities, state, secrets, and real traces remain private.     |
| REL-D09 | Residency guarantees, customer networking, support access, RTO/RPO, maintenance windows, customer-owned projects, and customer activation remain deferred. Apache-2.0 licensing is already established. |

Independent verification, confidentiality, immutable artifact identity, and human
authority are durable principles. Region, budget, exact tools, time limits, retry
limits, and gate placement are Controlled Defaults for this authorized evaluation.
The combined budget target is USD 100/month with alerts at 50%, 80%, and 100%;
alerts are not a hard spending cap.

## Behavioral Scenarios

### REL-01: Restricted Access

Given an internal staging environment behind the approved access boundary,
when a person without an explicit staging grant requests the UI or any API route,
then access is denied before application content is served.
Direct service URLs must not bypass that boundary. Application-level identities
and customer authentication are not implemented by this restriction.

### REL-02: Automatic Staging

Given an exact merged main revision with all applicable passing checks,
verified immutable web/API images, trusted provenance, and approved configuration,
when its validated candidate request reaches the private executor,
then only the configured staging target is promoted without another manual trigger.

### REL-03: Incomplete or Invalid Evidence

Given failed, missing, canceled, stale, or mismatched prerequisite evidence,
when promotion is requested,
then promotion is denied and existing traffic remains unchanged.
Selected-run coverage cannot substitute for complete required target coverage.

### REL-04: Production Disabled

Given this milestone's disabled production path,
when any actor requests production, even with a valid artifact and approval,
then the request is rejected without provisioning or modifying production.

### REL-05: Independent Production Authorization

Given an isolated simulation of future enabled production,
when an authenticated authorized requester approves their own promotion,
then approval is rejected.
Only the other authorized human may approve the exact candidate and target;
changed inputs, expired or revoked approval, or identity substitution invalidate it.
The authorized GitHub identities are `JohnLozano-Stara` and `sundip`.
This simulation grants no live deployment authority.

### REL-06: Dedicated Target Isolation

Given two independently configured Stara-managed targets,
when target A is promoted using its executor identity,
then B's traffic and configuration remain unchanged and A cannot access B's
configuration, credentials, or deployment permissions.
Verify denied real permissions using an owned temporary project, not mocks alone.

### REL-07: Failure Before Traffic Change

Given an existing serving artifact,
when artifact verification, candidate eligibility, revision creation, or readiness
fails before traffic changes,
then existing traffic remains unchanged and operators receive an explicit failure.

### REL-08: Forward Recovery

Given traffic has changed during a staging attempt,
when subsequent verification fails,
then staging is marked degraded and operators receive a corrective work item.
No automatic rollback, inline source correction, or silent repeat switch occurs.
A reviewed repair PR and a freshly verified main candidate are the next path.
Web and API traffic changes are not claimed to be atomic.

### REL-09: Honest Staging Notice

Given staging application content is available,
when a person navigates contexts, opens inspection, switches theme, or reloads,
then this notice remains accessible, visible, and non-dismissible:

> Internal staging. Synthetic data only. Drafts are temporary and may be lost on reload or when this page closes.

The notice must not obscure controls at 1100/900/700px widths, 200% text zoom,
reduced motion, or forced colors. It is absent from the local development shell.
Missing or invalid runtime configuration must not silently reveal a shell that
omits the staging notice.

### REL-10: Confidentiality

Given release evidence and operational output,
when data is prepared for public publication,
then only the explicit public field allowlist and synthetic results are included.
Canary, secret, malformed-data, or unrecognized-field failures block publication
without echoing sensitive values. Check frontend bundles, image metadata/layers,
and public artifacts independently of source-scan exclusions.

### REL-11: Bounded, Idempotent Execution

Given duplicate requests, concurrent candidates, exhausted limits, or an unknown
deployment outcome,
when the executor processes or resumes delivery,
then it reuses durable identity/state, prevents duplicate terminal effects, rejects
stale candidates, and stops for reconciliation when the outcome is uncertain.
Retries cannot reset deadlines or create unbounded repair loops.

## Engineering Invariants

- `/api/health` remains HTTP 200 with exactly `{"status":"ok"}` while serving.
- A typed `/api/runtime-config` response allowlists only `schemaVersion: 1` and
  `environment: "development" | "staging"`; unknown configuration fails startup.
  It never serializes process environment, target configuration, or secrets.
- Shared application image bytes are promoted by digest without rebuilding.
- Public GitHub identity can publish artifacts and a staging candidate signal,
  but cannot deploy, read operational state/secrets, or choose executor commands.
- Total execution is bounded to 30 minutes; rollout to 15 minutes and probes to
  five minutes, each constrained by the total deadline. Safe transient reads may
  retry at most twice. Mutations with unknown outcomes never retry blindly.
- A target lock is not automatically stolen on expiry. Crashes and ambiguous
  mutations retain a reconciliation barrier; only recorded operator reconciliation
  can clear it after authoritative service/operation state is known.
- One receipt identity binds candidate, image manifest, and target configuration.
  Repeating terminal requests returns their state without restarting execution.
- All controls require independently authored tests, implementation review, and
  a distinct verifier. Complete affected-target coverage stays at 90% lines and
  85% branches, including release tooling.

## Acceptance Boundary

Record exact source, test, actor/run, configuration and artifact identities with
Passed, Failed, Not applicable, or Not executed results. Simulations establish
control behavior, not live IAM, DNS, IAP, or deployment acceptance. Before claiming
completion, verify merged-main auto-staging, denied access, target isolation, and
the visual/interaction matrix. Responsible Engineering and Product acceptance
remain separate from passing automation.
