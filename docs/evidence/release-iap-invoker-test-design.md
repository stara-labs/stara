# Independent IAP Invoker Regression

Author scope: `tooling/tests/release-infra.contract.test.mjs`,
`infra/gcp/target/tests/release-infra.tftest.hcl`, and this ledger. Starting branch
`fix/iap-service-agent-permissions` was tracked-clean at
`b0a24b3353e8e0959958a31285009e2b5c413aa2`. Parent implements; Kant independently
verifies. This author made no production, cloud, IAM, state, credential, staging
area or commit changes. All mocked identities are synthetic.

## Contract and Migration

Google's [IAP load-balancer setup](https://docs.cloud.google.com/iap/docs/enabling-cloud-run)
documents generating the IAP service identity and granting it `roles/run.invoker`
on each Cloud Run service. The separate
[Cloud Run IAP guide](https://docs.cloud.google.com/run/docs/securing/identity-aware-proxy-cloud-run)
also describes service-scoped invoker access. This correction retains the reviewed
load-balancer architecture; it does not enable a second IAP layer or broaden users.
The owner-reported unsupported project-role rejection motivates the regression;
no private API error, resource identifier or operational trace is included here.

Two new static cases require:

- The target's complete project IAM resource inventory contains only the existing
  Run service-agent and executor operation-reader members. No project-level IAP
  agent, Run invoker, IAP accessor, or broad TokenCreator grant is admitted. Existing
  anonymous-principal, runtime-authority and user-scope protections remain.
- The Google Beta IAP identity is generated in `var.project_id` for
  `iap.googleapis.com` after API activation. The single invoker declaration covers
  `local.components`, binds the generated identity's member to each matching Cloud
  Run service in the target project/region, and uses exactly `roles/run.invoker`.
  No source reference to the removed project IAM grant may remain. The member
  reference supplies Terraform's identity dependency; an optional explicit
  dependency may name that same identity, not the unsupported project role.

One existing HCL assertion enumerated `google_project_iam_member.iap_agent` among
permitted project grants. Removing that reference is an intentional author-reviewed
contract correction: otherwise the assertion requires retention of the invalid
resource. The new exhaustive static project-resource inventory replaces this stale
presence assumption with absence enforcement. Checks for the other project grants
and runtime-account/owner/editor/TokenCreator exclusion are preserved.

Resolved-plan assertions now verify exact `web`/`api` keys, project, region,
matching service and generated IAP principal. Staging uses synthetic number
`900000000002`; isolation uses `900000000003` and explicitly rejects the staging
agent. A new alternate-identity plan supplies `900000000099` and requires both
grants to follow it, rejecting hardcoding. The isolation override now supplies
consistent email and member values. No existing plan run was removed. Backend IAP,
explicit user/probe-executor access, private ingress, disabled default URL, HTTPS
routing, isolation-without-LB and invalid-input scenarios remain intact.

## Actual RED and Control Plans

Static tests ran against unchanged production in the shared working tree. From
`C:/code/stara/stara/tooling`:

```text
C:/nvm4w/nodejs/node.exe ../node_modules/vitest/vitest.mjs run tests/release-infra.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-iap-invoker-test-author/static-red.json
```

Exit **1**: **147 tests, 145 passed, 2 failed, zero skipped/pending**. Failures:

1. `never grants project-wide IAP runtime authority or widens target project roles`:
   actual inventory includes the extra `google_project_iam_member.iap_agent`.
2. `binds only the generated IAP agent to matching services without an invalid project-role dependency`:
   source still references `google_project_iam_member.iap_agent` in invoker
   dependencies. Identity and per-service field checks preceding this assertion
   already pass. Assertions after either failing point require GREEN execution.

The unchanged target source was preserved in
`.artifacts/release-iap-invoker-test-author/red/root`. Only `main.tf`,
`variables.tf`, `outputs.tf`, `versions.tf`, `.terraform.lock.hcl` and the frozen
HCL test were copied. No variable files, `.terraform` backend metadata, state or
private input was copied. The provider mirror reused only existing public Google
and Google Beta 8.2.0 packages from the prior isolated test setup.

The following exact commands use `ROOT` for
`C:/code/stara/stara/.artifacts/release-iap-invoker-test-author/red/root` and
`MIRROR` for
`C:/code/stara/stara/.artifacts/terraform-cloudbuild-identity-contracts/mirror`:

```text
C:/code/stara/stara/.artifacts/tools/terraform/1.16.2/terraform.exe -chdir=ROOT init -backend=false -lockfile=readonly -input=false -no-color -plugin-dir=MIRROR
C:/code/stara/stara/.artifacts/tools/terraform/1.16.2/terraform.exe -chdir=ROOT test -no-color
```

Execution removed inherited `TF_*`, `GOOGLE*`, `GCLOUD*`, `CLOUDSDK*` and `GCP*`
environment entries. It set fresh owned data/home/application-data/temp paths,
an owned CLI config disabling checkpoints, `TF_INPUT=0`, `TF_IN_AUTOMATION=1`,
and `CHECKPOINT_DISABLE=1`. Both providers are mocked during plan; every run is
`command = plan`. Backend initialization is disabled. Local package integrity
uses the readonly lockfile; initialization reports local providers unauthenticated
because it does not download fresh signing evidence.

Initialization exited **0**. Mock tests exited **0**: **24 passed, zero failed,
zero skipped**, including staging, isolation and the alternate identity. This is
**not Terraform behavioral RED**: mocked providers cannot reproduce Google's
unsupported-role API rejection. The actual RED is the two source-contract
failures; passing mock plans establish preserved resolved-value controls only.

## Frozen Identities

Paths in the first table are repository-relative. Both test hashes were captured
after scoped formatting and match the preserved HCL snapshot. Production
`main.tf` still matched the RED snapshot at freeze notification.

| Input                                             | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `tooling/tests/release-infra.contract.test.mjs`   | `bc808163600d435e6501beabf2c4c745ec6f08045ad0a9830ebfdef9346401ca` |
| `infra/gcp/target/tests/release-infra.tftest.hcl` | `2d21c8a661f4606f7134f4c07e28b2c075831f52765b6de1a9f21b96653edf8e` |
| RED `main.tf`                                     | `2adbdd296de5ea03c6b1a9379daf20bea81233bd017361e1236d124993515e64` |
| RED `variables.tf`                                | `88ee3c53f105b5ee71632b5565aaec823e685b4071e4a07e5d43aa3bac63390f` |
| RED `outputs.tf`                                  | `908e4ba33f5a59cbfae4cee7665d5adf8d375783bdd33cdac316f527e2ebaae4` |
| RED `versions.tf`                                 | `25c5187d844d66347815b154c783f8da43dbfdfa34bf443b7cb1369d4e0000e1` |
| RED `.terraform.lock.hcl`                         | `4d323781f644bcaeca7624a216758452f99be5af5c7aa86035e177a947606ab3` |

Evidence paths below are relative to
`.artifacts/release-iap-invoker-test-author/` and remain locally ignored:

| Evidence                  | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `static-red.json`         | `a206cc846dcefc4a38cd09ad0040532ce74e070c9979db0d81d52408d85ace72` |
| `red/init.log`            | `0ce5a3d68613285d170f17d0617b124a16d0dc5028dcbd9e15dfc06e85e3dbb2` |
| `red/mock-red-source.log` | `35ff2b4628f9ddc32ad4383f4a63f50a61b63e12fc1c5306115aa5272732dea5` |

## Handoff Limits

Scoped ESLint (`--max-warnings 0`), Prettier check, Terraform test-file
`fmt -check`, Secretlint on both owned tests and this ledger, and scoped
`git diff --check` exited 0. No hook or scanner rule was bypassed. These checks
do not replace parent whole-tooling coverage or independent verification.

Tests are frozen; parent was notified immediately after RED/source hashes were
captured. GREEN must use unchanged tests and preserve these RED logs/source,
with a fresh isolated target snapshot. No broad coverage, hosted checks, live
IAP authentication, IAM repair, drift closure or deployment acceptance is claimed
by this focused author run. Dispatch remains outside this author's authority.

Conclusion: **Ready for human review** and production implementation against the
frozen independent regression. Parent's fix and Kant's live/API review are separate.

## Actual Isolated GREEN

After parent removed the unsupported project IAM member and its stale explicit
dependency, this author ran the unchanged frozen HCL against a fresh snapshot at
`.artifacts/release-iap-invoker-test-author/green/root`. The snapshot was required
not to exist before creation. Its allowlist is the same five public Terraform
source/lock files plus the frozen HCL test used for RED, copied from the current
formatted working tree. RED source and logs were not overwritten.

The harness used fresh `green/data`, `green/home`, `green/appdata`, `green/tmp`
and `green/terraform.rc`, the same existing provider mirror, and the same
credential/environment sanitization described above. Both Google 8.2.0 providers
remained mocked; every run remained plan-only. No live backend, credentials,
private inventory or cloud API was involved. Commands from the repository root:

```powershell
$tf = 'C:/code/stara/stara/.artifacts/tools/terraform/1.16.2/terraform.exe'
$root = 'C:/code/stara/stara/.artifacts/release-iap-invoker-test-author/green/root'
$mirror = 'C:/code/stara/stara/.artifacts/terraform-cloudbuild-identity-contracts/mirror'
& $tf "-chdir=$root" init -backend=false -lockfile=readonly -input=false -no-color "-plugin-dir=$mirror"
& $tf "-chdir=$root" test -no-color
& $tf "-chdir=$root" fmt -check -recursive
```

Initialization and mock tests exited **0**: **24 passed, zero failed, zero
skipped**, including both target configurations and the alternate generated-agent
identity. Snapshot formatting also exited **0**. An initial unquoted PowerShell
`-chdir` formatting invocation exited 1 on argument syntax before checking files;
the quoted invocation above passed without changing any source or test.

Parent separately supplied `static-green-parent.json`. This author read and hashed
that report: **147 passed, zero failed, zero skipped/pending**, `success=true`,
including both previously failing IAP cases. This is inspected parent static
execution evidence, not a new static-suite execution by this author. Parent's
whole-tooling coverage and normal gates remain separate work.

Source paths below are relative to the GREEN target snapshot; evidence paths are
relative to `.artifacts/release-iap-invoker-test-author/`:

| Input or evidence            | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| GREEN `main.tf`              | `7803b4f81b07acb8e128cf3ff077d540cd7299868d0735796f28ceb271e3586c` |
| GREEN frozen HCL test        | `2d21c8a661f4606f7134f4c07e28b2c075831f52765b6de1a9f21b96653edf8e` |
| Workspace frozen static test | `bc808163600d435e6501beabf2c4c745ec6f08045ad0a9830ebfdef9346401ca` |
| `green/init.log`             | `0ce5a3d68613285d170f17d0617b124a16d0dc5028dcbd9e15dfc06e85e3dbb2` |
| `green/mock-green.log`       | `35ff2b4628f9ddc32ad4383f4a63f50a61b63e12fc1c5306115aa5272732dea5` |
| `static-green-parent.json`   | `c258afb5cca90f6e84614d3daa98d9e082a042e7a5451cc17f901ebc3e3812fc` |

GREEN `variables.tf`, `outputs.tf`, `versions.tf` and `.terraform.lock.hcl` hashes
match their RED values in Frozen Identities. Both workspace test hashes remain
frozen; the formatted workspace `main.tf` matches the GREEN snapshot. The RED
snapshot and its recorded static/mock/init report hashes remain unchanged.
The RED-source and GREEN mock logs have identical hashes because all 24 plan
results and their textual output are identical; they were independently generated
in separate roots against the distinct recorded production-source hashes.

Only this ledger was edited for the GREEN handoff. Document formatting, scoped
Secretlint and whitespace checks pass. No protected tests, production source,
staged files or permissions were changed by this author.

Conclusion: **Ready for human review** with focused frozen-test GREEN recorded.
These are source-contract and mocked-plan results, not evidence of successful
live IAM repair, IAP login, effective isolation, a no-op live plan or release
acceptance. Kant's independent review and the parent's live operations remain
outside this handoff; dispatch is not enabled by these results.
