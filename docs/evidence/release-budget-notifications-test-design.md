# Independent Budget Notification Regression

Author scope: `infra/gcp/bootstrap/tests/release-infra.tftest.hcl` and this
customer-independent ledger only. Starting tracked tree was clean at
`6b6f831c2b49f888db48b59873eb18020742215b`. No production code, lockfiles, static
JavaScript tests, credentials, live state or cloud resources were changed.
Parent implements; Kant verifies. No staging or commits by this author.

## Contract

Google documents custom email channels as optional and additive to default IAM
recipients, with a maximum of five. Disabling default IAM recipients requires
explicit true. See the official
[NotificationsRule reference](https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets#NotificationsRule).

The approved canonical plan contract omits `all_updates_rule` when the default
custom-channel list is empty. With custom channels, exactly one block must retain
the exact input list and `disable_default_iam_recipients = false`. Parent's
proposed dynamic block is conditional on a positive channel count. No ignore or
drift-policy exception is authorized.

The existing unconditional `[0]` assumption is independently migrated to the
default zero-block assertion. Its monthly USD 100, exact enabled-project filter,
50/80/100 percent thresholds and three-rule count assertions remain intact.
Three added mock plan runs check two custom channels, acceptance of exactly five,
and validation rejection of six. Existing malformed-channel, ownership,
isolation and other input-validation cases remain unchanged. Custom-channel
assertions retain owner notifications explicitly; absent blocks cannot pass
those assertions through an indexing error or fallback default.

## Isolated Execution

Only public `main.tf`, `variables.tf`, `outputs.tf`, `versions.tf`, the provider
lockfile and the authored test were copied into
`.artifacts/terraform-budget-contracts/root`. No automatic variable files,
backend initialization metadata, private inputs or state were copied. Both
Google provider configurations are mocked; every run uses `command = plan`.

Commands use `.artifacts/tools/terraform/1.16.2/terraform.exe`, an isolated
`TF_DATA_DIR` at `.artifacts/terraform-budget-contracts/data`, an owned CLI config,
and empty owned home/application-data/temp directories. Inherited `TF_*`, Google,
gcloud, Cloud SDK and GCP environment entries were removed before execution.
No user CLI configuration or live backend was used.

Registry access was blocked during initial initialization. An offline mirror then
copied only the existing public Google 8.2.0 provider executable and its license.
The first incomplete executable-only copy failed checksum verification; including
the package license let readonly-lock initialization succeed. No lockfile or
checksum validation was bypassed. The installed package was locally hash-checked,
not freshly authenticated through a registry signature download.

Commands, with ROOT and MIRROR resolving only inside the owned artifact directory:

```text
terraform.exe -chdir=ROOT init -backend=false -lockfile=readonly -input=false -no-color -plugin-dir=MIRROR
terraform.exe -chdir=ROOT test -no-color
```

An initial incorrectly parsed filter selected no tests and is excluded from
evidence. The retained unfiltered run executes the sole copied test file.

## RED and Freeze

Actual mock RED: **12 passed, 1 failed, zero skipped**, exit 1. The only failure
is `combined_budget_is_not_an_activation_or_shutdown_control`: expected zero
`all_updates_rule` blocks, actual one. The custom-channel and both count-boundary
cases pass alongside existing controls. This is a planned-resource assertion
failure, not a source-regex failure. Parent was notified before implementation.

| Input or evidence                                           | SHA-256                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Frozen `infra/gcp/bootstrap/tests/release-infra.tftest.hcl` | `5dea6e242df1c69867e2b86749df8823d5e16d6a4423860ac3502c21a9234fde` |
| RED snapshot `main.tf`                                      | `ea3d654f5ca2ab4120fd1402c0f75e9b300d20840f86941232da6197969fe71c` |
| RED snapshot `.terraform.lock.hcl`                          | `f21de9af5aa3b96ff87b833e0e938c56829fd8ce51c6533ded4b6f9298e1e88e` |
| `.artifacts/terraform-budget-contracts/red-full.log`        | `5069839c242773908e7ea7b7000ceb74d760991bef2270592759289f3d496cb7` |

Terraform formatting, scoped Secretlint, document formatting and scoped diff
checks pass. The frozen test needs no static JavaScript contract migration.
Generated logs and isolated module/provider copies remain ignored artifacts.

## GREEN

After parent implementation, the unchanged frozen tests ran against a separate
allowlisted public-source copy at
`.artifacts/terraform-budget-contracts/green/root`. This run used fresh
`green/data`, `green/home`, `green/appdata` and `green/tmp` directories, the same
owned CLI config, the same environment sanitization and the existing offline
provider mirror. It did not reuse RED backend initialization or state. The
directory was required not to exist before creation; RED files were preserved.

Pinned Terraform 1.16.2 initialization used `-backend=false -lockfile=readonly`
and exited 0. `test -no-color` exited 0: **13 passed, zero failed, zero skipped**.
The formerly failing default case now passes, as do exact custom channels,
default IAM recipient preservation, the five/six-channel boundary and all
existing budget and bootstrap assertions. No test changes were made for GREEN.

The following source paths are relative to the isolated `green/root` snapshot;
these are hashes of the files actually tested, not an earlier mutable-tree read.

| Input or evidence                                       | SHA-256                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| `main.tf`                                               | `f4a4ef398a0254b57a1018200326571690cd1e8c182816630fde6ac659a3e34c` |
| `variables.tf`                                          | `dc3b960cec7f9ed5e05a900a8d669967a903e425f9a29d12ae126a2a7d4317d1` |
| `outputs.tf`                                            | `623d324bd8f51fa040561c7ec10df423833c1bceb5bcc86380e6697aa224ec6e` |
| `versions.tf`                                           | `84194d0295633170be71cf1886f9be7a824ca5bf4350711bde9242f490deab75` |
| `.terraform.lock.hcl`                                   | `f21de9af5aa3b96ff87b833e0e938c56829fd8ce51c6533ded4b6f9298e1e88e` |
| `tests/release-infra.tftest.hcl`                        | `5dea6e242df1c69867e2b86749df8823d5e16d6a4423860ac3502c21a9234fde` |
| `.artifacts/terraform-budget-contracts/green/init.log`  | `fea60de4ea8dee172bfd929a158888ab5ae0fd9b0c767f0c773d45c2a7124d23` |
| `.artifacts/terraform-budget-contracts/green/green.log` | `9b8e272d53845eea310517b0ba6d456d4623d074e3ca98240e9a353aa7e8f2b9` |

The frozen workspace test hash, RED `main.tf` snapshot hash and RED log hash were
rechecked after GREEN and match their earlier ledger values. After parent
reported final Terraform formatting, the current `main.tf` and GREEN snapshot
hashes were compared again and both matched `f4a4ef398a0254b57a1018200326571690cd1e8c182816630fde6ac659a3e34c`;
`terraform fmt -check infra/gcp/bootstrap/main.tf` exited 0. Only this ledger
was edited for the green handoff. Document formatting, scoped Secretlint and
scoped diff checks pass. No production files, live backend, credentials, cloud
resources, staging area or commits were changed by the author.

## Limits

Mock plans do not execute Google reads, prove notification delivery or demonstrate
live drift closure. No private operational evidence or live identifiers belong
in this ledger. Authorized live verification remains outside this author task.

Conclusion: **Ready for human review** for this independent mock-regression
handoff. Actual RED and GREEN are retained against the same frozen tests. Live
drift closure and release advancement are not claimed by these mock results.
