# Release Operations

Status: Implementation candidate; live activation evidence is still required.
Authority: [REL scenarios](requirements/releases.md),
[architecture](release-architecture.md), and [infrastructure](../infra/gcp/README.md).

The [candidate evaluation](evidence/release-evaluation.md) retains earlier executor
security failures; the [remediation record](evidence/release-dependency-remediation.md)
identifies the independently verified replacement artifact and remaining gates.
Do not bootstrap or activate before those gates and owner acceptance are complete.

## Local Verification

`pnpm release:images` builds the two release Dockerfiles, starts only an isolated
loopback Compose project, checks the actual staging runtime response, runs all
browser projects against those images, and scans the exact image archives,
metadata and extracted public files. `pnpm release:safety` rechecks the retained
verification receipt and evidence before advancement. Both commands fail on
missing or invalid evidence. Local working-tree receipts cannot be published.
Development `pnpm start` and its Compose files remain separate and unchanged.

For a local image run, supply one unique `STARA_RELEASE_RUN_ID` and retain that
same value for `release:safety`. Each new image run needs a new identifier; there
is no mutable "latest successful run" pointer. Hosted workflows provide their
own run and attempt identities automatically.

Raw scans, extracted files and local receipts belong under ignored
`.artifacts/release-pipeline/`, never public uploads. Only explicitly allowlisted
synthetic summaries, complete coverage metrics and immutable candidate identities
may be uploaded. Retain failed results; rerunning creates new evidence and never
erases the first failure. No command cleans unrelated containers or volumes.

## Attestation Dependencies

The workspace narrowly overrides `@actions/attest@3.2.0`'s signer to
`@sigstore/sign@4.1.1`, with that signer's core pinned to `@sigstore/core@3.2.1`.
The SDK's original signer/core graph is affected by
[CVE-2026-48758](https://github.com/advisories/GHSA-jfc7-64v2-mr8c).
This intentionally crosses the SDK's declared signer-major range, not the
signer's declared core-major range. The
[independent regression contract](evidence/release-attestation-dependencies-test-design.md)
exercises the actual resolved SDK, statement/bundle serialization and real
cryptographic type binding with synthetic remote-service boundaries.

Keep the lockfile and scoped overrides together. Remove the overrides only when
the maintained SDK natively resolves a patched graph and the unchanged regression,
publisher, dependency and actual-image checks pass. Offline SDK compatibility
does not prove live Fulcio/Rekor, GitHub or cloud authorization. Never dismiss a
dependency advisory merely because the configured high-severity audit passes.

## Hosted Publishing Inputs

### Provenance Verifier

The executor and publisher use the same `gh-artifact` source-build recipe in
`tooling/release/Dockerfile`. It pins upstream GitHub CLI 2.100.0 by immutable
source revision and archive checksum, Go 1.26.8 by image digest, and the sole
module override `golang.org/x/mod@v0.40.0` by version and Go checksum records.
The module upgrade addresses the two
[upstream checksum-verification advisories](https://groups.google.com/g/golang-announce/c/n98zX3vaIXs/m/T6fYYbScBAAJ).
The binary identifies itself as **2.100.0-stara.1**; it is not an official GitHub
release binary. The transport rejects the old official version and other version
strings; that guard does not authenticate the executable's bytes.

The builder verifies modules and executes the upstream CLI and sumdb test suites
before compiling with fixed version/date, stripped paths and disabled VCS stamping.
The output retains the upstream license, source-input identity, effective module
files and actual binary module metadata. The exported artifact also contains
SHA-256 checksums; the publisher verifies them before installation and before
cloud authentication. Checksums provide output integrity, not independent proof
that upstream source is trustworthy. Code review, pinned source identity,
tests and artifact scanning remain required.

The required release-image job now also builds and scans the exact executor
archive for HIGH/CRITICAL vulnerabilities and secrets. Raw scan reports stay in
the job-owned temporary directory and are not publicly uploaded. CI retains
the failing step status; operators reproduce detailed diagnostics locally using
the recorded candidate and recipe. Bootstrap still independently verifies the
exact control digest it will provision. A passing application scan or a printed
CLI version cannot substitute for that verification.

Maintain the source/archive/compiler pins, module sums, `gh-build.json`, version
guard and independent contracts together. Replace this build with a supported
patched upstream release when available only after equivalent tests, scans and
independent review. Never remove the override or broaden the allowed CLI version
to silence an advisory.

### Private Configuration

Configure delivery identifiers as masked GitHub repository secrets, not public
variables: `STARA_DELIVERY_PROJECT`, `STARA_IMAGE_WIF_PROVIDER`,
`STARA_IMAGE_PUBLISHER`, `STARA_IMAGE_REPOSITORY`, `STARA_ARTIFACT_BUCKET`,
`STARA_DISPATCH_WIF_PROVIDER`, `STARA_DISPATCH_PUBLISHER`, `STARA_STAGING_TOPIC`,
and `STARA_CONFIGURATION_SHA256`. These contain approved resource references,
not service-account keys or application secret payloads. Missing inputs deny
publication or dispatch. Application secrets remain in Secret Manager.

Image publication uses a short-lived federated access token for only the
approved registry host. The pinned login action removes runner credentials
after the job. Dispatch receives no registry login. Generated ADC files remain
ignored and excluded from image build contexts and public artifacts. Masking
supplements, but does not replace, the allowlisted public evidence boundary.

## Bootstrap Sequence

1. Complete independent source, test, Terraform mock-plan and image review. Confirm
   owner authorization, Stara organization/billing, the explicit Google user
   allowlist and existing DNS-provider access. Keep all real inputs private.
2. Create only the approved new delivery/staging projects and temporary isolation
   project. Back up bootstrap state privately before downstream provisioning.
   Review the USD 100 combined monthly budget alerts; they are not a spending cap.
3. Provision delivery with dispatch disabled. Build, scan and independently verify
   the reviewed control image, then pin its digest. Application publishers cannot
   write this control repository or change the fixed Cloud Build configuration.
4. After authorized merge, obtain application images from the fully verified
   exact mainline publication. Bootstrap the target with those same immutable
   images. Do not use an unverified feature branch or placeholder as accepted
   staging. Complete private configuration and exported GitHub publisher wiring.
5. Add only staging and certificate-verification records to the existing zone.
   Verify HTTPS, both approved users, denied unauthorized users, API routing,
   denied direct-service access, private alert delivery and cross-project denial.
6. Enable only staging dispatch after explicit authorization. Verify an actual
   merged-main candidate reaches staging automatically and its artifact/config/
   receipt identities agree. Remove only positively identified temporary
   validation resources through a reviewed preservation/cleanup procedure.

Until these steps have evidence, report live staging as Not executed or Failed,
not ready. `app.stara.co`, production resources and production permissions remain
absent. Production requires a separate reviewed activation change and independent
requester/approver authorization; role simulations are not activation.

## Recovery

Before traffic switches, failed verification leaves serving traffic untouched.
After any switch, failures are degraded or require reconciliation; there is no
automatic rollback. A receipt with uncertain deployment effects retains its lock
even after its deadline. An unknown final state-write response may already have
released the lock; read the actual target and immutable archive before deciding
what happened. Inspect Cloud Run operations and traffic privately before
authorizing any next action; never clear a lock solely because it is old.

A private Monitoring incident tracks investigation and a reviewed corrective PR.
Logging submission is not evidence that an email arrived. Monitoring can
rate-limit notifications or automatically close an inactive incident; neither
event proves service recovery or clears the durable receipt. Only a freshly
verified forward candidate and an observed successful journey establish recovery.

Use the [security procedure](../SECURITY.md) for suspected credential exposure.
Revoke affected federation/bindings and disable dispatch before renewing trust.
Public incident discussion must omit target inventory, secret values and real
diagnostic traces. No customer durability, residency, networking, support-access,
RTO/RPO or maintenance-window commitment is introduced by this milestone.
