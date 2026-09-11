# Security

Report suspected vulnerabilities using
[GitHub private vulnerability reporting](https://github.com/stara-labs/stara/security/advisories/new).
Do not post credentials, customer records, live traces, Terraform state, or
exploit material in public issues or pull requests. Share only the minimum
necessary privately. Supported deployment scope is restricted internal staging;
this repository does not promise production or customer security support yet.

Secret scanning, push protection, staged Secretlint, dependency analysis and
release-output scans are complementary safeguards, not proof that a repository
or artifact contains no secrets. Source exclusions do not exempt frontend
bundles, image layers, image metadata or published release evidence.

If a credential may have leaked, revoke or rotate it at its issuer first and
halt affected publication/dispatch. Removing a Git commit does not revoke a
credential. Preserve minimal investigation evidence privately, identify every
affected artifact and permission, and notify the responsible Engineering owner.
Do not rewrite shared history without explicit authorization. Review access,
renew trust configuration, repair through a reviewed change, and require fresh
verification before resuming delivery. Unknown deployment outcomes additionally
require reconciliation with actual service traffic and durable receipts.

GitHub uses short-lived, workflow-bound federation, not committed cloud keys.
Only the private executor may deploy to its configured staging target. Secret
Manager is the boundary for future secret values; Terraform may manage
references and permissions but must never contain secret payloads. Application
runtime identities have no secret grants in this milestone.
