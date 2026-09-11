# Independent Cloud Build Identity Regression

Author scope: delivery's `tests/release-infra.tftest.hcl`, one narrowly added
case in `tooling/tests/release-infra.contract.test.mjs`, and this ledger.
Starting tracked tree was clean at
`9c5f00548486527b271b562f1e22be73d21fa904`. Parent implements; Kant verifies.
No production code, credentials, live state, IAM bindings, staging area or
commits were changed by this author. All identities below are synthetic.

## Corrected Contract

The Cloud Build service agent uses
`service-PROJECT_NUMBER@gcp-sa-cloudbuild.iam.gserviceaccount.com`; it is distinct
from the legacy build account `PROJECT_NUMBER@cloudbuild.gserviceaccount.com`.
See Google's official
[service-agent documentation](https://docs.cloud.google.com/build/docs/securing-builds/configure-access-for-cloud-build-service-account)
and [default build-account documentation](https://docs.cloud.google.com/build/docs/cloud-build-service-account).

The previous Google Beta mock incorrectly supplied the actual service agent as
the generated service-identity response. It now supplies the reviewer-confirmed
legacy response, preserving both email and member formats. This author did not
make a live API call to reproduce that provider response.

The privileged `roles/cloudbuild.serviceAgent` binding must use the exact actual
agent, derived from the owning project's number obtained through a
`google_project` data lookup scoped to `var.project_id`. The generated legacy
identity remains an activation dependency, never the privileged IAM member.
The role and project must remain exact; the trigger and unrelated least-privilege
bindings must not be broadened or removed.

Two added mock plan runs provide independent value checks:

- The baseline requires the actual agent with synthetic project number
  `900000000001`, while explicitly rejecting the generated legacy member and
  the legacy email suffix. It also checks the corrected mock response itself.
- An alternate mocked project lookup returns `900000000099` while leaving the
  generated identity output unchanged. The exact privileged principal must
  follow the metadata number. This deliberate adversarial mismatch prevents
  hardcoding or deriving the project number from legacy identity output.

There was no existing resolved-plan assertion for this IAM binding to migrate.
All twelve previous plan runs remain intact. Only the inaccurate mock was
corrected; publisher, federation, trigger, executor, logging, incident and input
validation assertions were not weakened.

One static case is necessary because value assertions cannot inspect graph
dependencies. It requires the scoped project lookup, the Google Beta Cloud Build
identity resource after API activation, exactly one service-agent role binding,
an explicit IAM dependency on generated identity activation, and the trigger's
dependency on that IAM binding. The member expression cannot directly use the
generated identity. Existing static controls remain unchanged. The trigger
dependency check permits its existing list of other prerequisites; it does not
require the agent dependency to be last or alone.

## Actual Isolated RED

Pinned executable: `.artifacts/tools/terraform/1.16.2/terraform.exe`.
Only public `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, the readonly
provider lockfile and the frozen HCL test were copied into
`.artifacts/terraform-cloudbuild-identity-contracts/root`. Both Google 8.2.0
providers are mocked at plan time; every run is `command = plan`.

Execution uses fresh owned data/home/application-data/temp directories and an
owned CLI config. Inherited `TF_*`, Google, gcloud, Cloud SDK and GCP environment
entries were removed. The offline mirror contains only the existing public
Google and Google Beta 8.2.0 executables and their licenses. Readonly-lock
initialization verified local package checksums; it did not freshly download
provider signatures. No private variable files, backend metadata, state or
credentials were read or copied.

```text
terraform.exe -chdir=ROOT init -backend=false -lockfile=readonly -input=false -no-color -plugin-dir=MIRROR
terraform.exe -chdir=ROOT test -no-color
```

Initialization exited 0. Actual mock test RED exited 1: **12 passed, 2 failed,
zero skipped**. The baseline produced both positive-agent and negative-legacy
assertion failures: the resolved role member was the synthetic legacy account.
The alternate-number case also rejected that same member. All twelve existing
runs passed. Parent was immediately notified that behavioral RED was ready.

The existing static suite was run from `tooling` with the pinned Node executable:

```text
C:/nvm4w/nodejs/node.exe ../node_modules/vitest/vitest.mjs run tests/release-infra.contract.test.mjs --reporter=json --outputFile=../.artifacts/terraform-cloudbuild-identity-contracts/static-freeze-red.json
```

Static RED exited 1: **144 passed, 1 failed, zero skipped**. The sole new case
fails because no scoped `google_project` data lookup exists. Subsequent checks
inside that case must execute after implementation; this RED alone does not
prove those later dependency checks. The initial static report is also retained;
the final report follows an author correction allowing the existing trigger
dependency list without imposing last-position ordering.

## Frozen Hashes

| Input or evidence                                                           | SHA-256                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `infra/gcp/delivery/tests/release-infra.tftest.hcl`                         | `f81161340d83df7d5c92a117701adaf0475b81e0f7f7dd805db7709f8fb83378` |
| `tooling/tests/release-infra.contract.test.mjs`                             | `1ed35a7e09a043a3b8b0949f942f79bfd854c215a66b07b9472302ec35bc57d0` |
| Isolated RED `main.tf`                                                      | `5b2a76f99c62e54c46e1893dca8c457d5d69511bd14f799b65702fe31017a213` |
| Isolated provider lockfile                                                  | `4d323781f644bcaeca7624a216758452f99be5af5c7aa86035e177a947606ab3` |
| `.artifacts/terraform-cloudbuild-identity-contracts/red.log`                | `6383de27805d0e89e51ff5aeef9e30d1d24cdb65b24299311cdb5d1f1d4c3094` |
| `.artifacts/terraform-cloudbuild-identity-contracts/static-freeze-red.json` | `ec9f4457dcf9c7263b9cf9d42ea43244e8af38dba1aa68d3371a6d1bc6d5ea74` |

Terraform formatting, scoped ESLint/Prettier, scoped Secretlint and scoped diff
checks pass. Tests are frozen. GREEN must run unchanged tests against a separate
updated public-source snapshot and retain distinct logs, preserving RED.

## Actual Isolated GREEN

After parent implementation, both frozen suites ran from a new snapshot at
`.artifacts/terraform-cloudbuild-identity-contracts/green/repo`. The snapshot
copied the 229 tracked public-source paths from the current working tree, not
HEAD blobs, so it includes the uncommitted production fix and frozen tests.
The copy explicitly rejected private/generated path classes and did not include
ignored files, `.git`, `.terraform`, variable files or state. A `node_modules`
junction reused installed test dependencies only; source and tests were read
from the snapshot. The new GREEN directory was required not to exist first.

Terraform used fresh `green/data`, `green/home`, `green/appdata` and `green/tmp`
directories, an owned copied CLI config, the same environment sanitization and
the existing offline provider mirror. All Google data reads and resources were
mocked. Initialization remained backend-disabled and readonly-lock. No live
backend, credential or cloud operation was involved.

Commands below use BASE for the owned artifact directory and SNAPSHOT for its
`green/repo` directory. Terraform is the pinned 1.16.2 executable above; Node is
`C:/nvm4w/nodejs/node.exe`. Vitest's installed CLI is
`C:/code/stara/stara/node_modules/vitest/vitest.mjs`.

```text
terraform.exe -chdir=SNAPSHOT/infra/gcp/delivery init -backend=false -lockfile=readonly -input=false -no-color -plugin-dir=BASE/mirror
terraform.exe -chdir=SNAPSHOT/infra/gcp/delivery test -no-color
```

From `SNAPSHOT/tooling`:

```text
node.exe C:/code/stara/stara/node_modules/vitest/vitest.mjs run tests/release-infra.contract.test.mjs --reporter=json --outputFile=BASE/green/static-green.json
```

All commands exited 0. Terraform: **14 passed, zero failed, zero skipped**.
Static suite: **145 passed, zero failed, zero skipped**. The metadata-derived
agent passes both synthetic project-number cases; the legacy response remains
excluded. The static case now also executes its previously unreached activation
dependency assertions. All existing controls pass unchanged.

The following source paths are relative to the tested delivery module in the
snapshot; evidence paths are relative to BASE:

| Input or evidence         | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `main.tf`                 | `a920b612ae36fa60d7989c5cdcf33e1617ec4414f9e326eab19c1f20e42b74a8` |
| `variables.tf`            | `14ab1dd6f6a11ec755daa93a4efecba584351bf682e8e686d4af2d8d8b635752` |
| `outputs.tf`              | `ba108e5057ab729507bed7324736df45f30d92659fde06ff6739bab094667943` |
| `versions.tf`             | `25c5187d844d66347815b154c783f8da43dbfdfa34bf443b7cb1369d4e0000e1` |
| `.terraform.lock.hcl`     | `4d323781f644bcaeca7624a216758452f99be5af5c7aa86035e177a947606ab3` |
| Frozen HCL test           | `f81161340d83df7d5c92a117701adaf0475b81e0f7f7dd805db7709f8fb83378` |
| Frozen static test        | `1ed35a7e09a043a3b8b0949f942f79bfd854c215a66b07b9472302ec35bc57d0` |
| `green/init.log`          | `0ce5a3d68613285d170f17d0617b124a16d0dc5028dcbd9e15dfc06e85e3dbb2` |
| `green/mock-green.log`    | `8250ae0f492781dad8c9712588722aa499a69cb1fb707e79a1f585d3079f2be1` |
| `green/static-green.json` | `4a5ab9405775fc2140079c94d3521f892a0e03faaac05f01d081d03359e39d9f` |

After GREEN, the current production `main.tf` matched the snapshot hash and both
workspace tests matched their frozen hashes. The RED source snapshot, mock log
and frozen static RED report were rehashed and match the earlier values above.
`terraform fmt -check -recursive` passed on the snapshot delivery module.
Document formatting, scoped Secretlint and scoped diff checks pass. Only this
ledger was edited for the GREEN handoff; no source/test edits or git staging.

## Limits

Mocks demonstrate evaluated Terraform values, not live IAM correctness or service
activation. Static dependency checks are source contracts, not a full graph or
authorization proof. No private operational evidence belongs in this ledger.
Parent's live remediation and Kant's live review are outside this author task.

Conclusion: **Ready for human review** for this independent regression handoff.
Actual RED and GREEN are retained against unchanged frozen tests. Live IAM
repair, drift closure and release advancement remain outside these results.
