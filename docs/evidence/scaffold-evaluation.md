# Initial Scaffold Evaluation

Date: 2026-09-10 UTC
Conclusion: More journey evidence required
Scope: Initial issue #1 milestone, not application conformance or deployment

Historical record: licensing was pending during the observations below. The
subsequent [Apache-2.0 decision](../architecture.md#license-decision) supersedes
that licensing status without changing the recorded execution evidence.

## Identity and Roles

The candidate is on `feat/monorepo-scaffold`, based on the independently reviewed
metadata-only main seed `bbacc3d12ab123a4c778c0a16b65eb79e31b8ed0`.
The external Product System pin is `60f949e21d0fbe82dbdda5801715dbe1172e7b1b`.
Local observations below precede the application commit; they are not evidence
for the seed alone. Final commit and PR gates retain their exact tree/revision,
selection, command diagnostics, actor/run, coverage, and artifact identities.
Hosted results must be read on the actual PR candidate, not inferred here.

Darwin authored protected control tests, Harvey implemented controls, and Hypatia
is the independent verifier. Hubble implemented the API; Kepler implemented UI.
The coordinating agent integrated their scoped work. Distinct worktrees and
audited ownership were used; this does not claim OS-enforced isolation between
agent processes. Human Engineering and Product acceptance remain separate.

The [independent control record](control-test-design.md) and
[protected manifest](../../tooling/tests/protected-tests.manifest.json) identify
behavioral red evidence, source/test hashes, corrections, and limitations.
The initial manifest SHA-256 was
`5d86760742145cc516e589806e667526b2c4c2f9c8f7184bd199d05b3ce342d8`.
Its declared hashes were compared with the integrated bytes at that observation;
the protected manifest records subsequent independently authored corrections.

## Observed Local Results

Environment: Windows, Node 24.16.0, pnpm 11.19.0, pinned lockfile and toolchain.
The initial lockfile SHA-256 is
`4acbffb794114c0338c9a5bf71cf2000a8810d9cc61cbebcd0451231aff709a0`.

- Passed: `pnpm bootstrap`, including frozen installation and safe hook install.
- Passed: actual Conventional Commit message hook invocation.
- Passed: `pnpm validate`, including token integrity, formatting, lint, typecheck,
  secret scan, all-target coverage, web/API builds, 21 functional/evidence browser
  checks, and 18 accessibility checks. All three browser engines ran. The built
  API/preview ports were 4174/4173; existing servers were not reused.
- Passed: `pnpm security:dependencies`; no known vulnerabilities were reported.
- Passed: targeted `pnpm test:mutation`, 150 mutants, 143 killed, 7 survived,
  no other statuses. The command runner invokes the policy suite for each mutant;
  Stryker represents that command as one test, not one underlying assertion.
  Survivor dispositions require independent review, not a score waiver.
- Passed: actual Docker image builds and repeated `pnpm start` readiness. An
  existing unrelated service occupies default API port 3000, so local verification
  explicitly used `STARA_API_PORT=3001`; web remained 5173. The unrelated service
  remained running. No data reset, prune, or unrelated-service shutdown occurred.

Complete eligible target coverage, including unexecuted authored files:

| Target    | Tests |            Lines |         Branches |
| --------- | ----: | ---------------: | ---------------: |
| API       |    74 |     64/64 (100%) |     36/36 (100%) |
| Shared UI |     3 |     19/19 (100%) |     7/8 (87.50%) |
| Web       |    24 | 221/231 (95.67%) | 219/230 (95.21%) |
| Tooling   |   461 | 682/713 (95.65%) | 552/614 (89.90%) |

The full local build manifest at this observation had run ID
`e4c54602-c2b7-44ac-ac80-9b35c2bb3bec` and artifact identity
`e2502076ba11fe319f4cfaad17ce4929eb7e20457f0598bbd9f0e2841fad4e4c`.
Its source/configuration hashes distinguish this dirty-tree evaluation from a
committed candidate. The targeted mutation report SHA-256 was
`c17bc40cf37c4018f3a310f7d7daa48b95cb09b0bff9cadf4e0bb82bd796f0fc`.
Later source/configuration changes require renewed applicable evidence.

## Failures and Limits

- Initial browser startup under terminal restrictions failed in Firefox. An
  authorized run passed. Original traces were overwritten before per-run artifact
  isolation was introduced; they are not claimed retained. New browser runs use
  exclusive run directories and reject reuse before output cleanup.
- Docker functional run `run-32b7d43c-6213-4f32-8054-37331b9da3ba` had 18 passed
  and 3 failed. Dev-mode font-license delivery returned HTML in Chromium/WebKit;
  Firefox exposed quoted font-family serialization. These initial traces and
  screenshots are retained. Corrective implementation and renewed Docker evidence
  are required; built-output success does not erase these failures.
- Formatting and typecheck failures were corrected before the passing full run.
  Invalid zero-test Stryker/Vitest-plugin reports are rejected, not counted as
  mutation evidence. The official command-runner campaign replaced that harness.
- API red-stage test-source hashes were not captured. UI has explicit red cases
  but not every component was introduced test-first. No complete TDD provenance
  claim is made for those surfaces.
- Widths 1440/1100/900/700/390, themes, keyboard/focus, long context labels, forced
  colors, and reduced motion were exercised. Doubled text is an automated
  approximation, not manual native zoom or screen-reader acceptance.
- UI authority conflicts and visual deviations remain in the
  [UI handoff](../../UI/web/HANDOFF.md). Generated token integrity is not upstream
  verification or Product acceptance. The consumer remains `validated: false`.

## Delivery Boundary

Independent follow-up verified the current token projection by actual isolated
regeneration: run `9952acde-09be-4194-a706-fab7ac7fdc9a`, CSS SHA-256
`097d8492749c7e491305125264b14ec2f8ebc78eff98de244cfdc8fdc781523a`, provenance
SHA-256 `502d23678bac8a31e2080dec020ced54fce978833e7b5d0217824a705209b36a`.
Both matched byte-for-byte. Windows path rejection passed bounded real-index
probes; the CI aggregate passed 65 independent status/event cases. The verifier
accepted the seven mutation-survivor dispositions after 2,629 differential cases.
These are scoped independent conclusions, not full application acceptance.

The dev license route and exact quoted/unquoted Inter-family normalization were
corrected and independently reviewed. Docker runs
`run-3d91dc78-1756-4e28-88c1-e28ca704ac68` (21 functional checks, 16.9 seconds) and
`run-c37787b4-d6bc-4f80-886f-fccb56b223a3` (18 accessibility checks, 54.6 seconds)
passed; the initial failed run remains retained. Web subsequently passed 27 tests
with unchanged source coverage. Retained trace assets exposed a nested-artifact
lint-ignore defect; six independent regression cases now pass without excluding
authored source or deleting diagnostics.

The secondary-listener shutdown finding was corrected and independently probed.
The integrated API passed 82 tests on Windows and in the Node 24.16.0 Linux
container, with 80/80 lines and 41/42 branches. Linux tests delivered native OS
signals; both actual localhost listeners exercised accepted-response drain,
abandonment, idle cleanup, and deadline failure. Timeout exits were approximately
5.1 seconds. The first Linux attempt failed before tests because the non-root
user could not create repository-root reports. The documented package-local
report-directory override passed without changing selection, floors, or users.
Container source hashes matched reviewed `main.ts`
`5a5b6c66d450814978f6086d93fd35e9df0c874807f27b22d265d3087f9b29d6` and `server.ts`
`3a18e51b0676d362628245f8cb869a7fc9d21cb46909941ad4834b97bd5c5651`.

A later independent push finding showed checks could execute dirty working files
instead of outgoing committed bytes. The corrected implementation materializes
every distinct supported outgoing commit, isolates installation and execution,
and retains commit/tree-bound results and actual build artifacts. Unsupported
push records fail closed; source identity is checked before and after execution.
The original failing regressions remain in the protected test record. Actual
installed-hook and candidate-gate results remain separate from contract passes.

The first real isolated commit gate, run
`d2a6d981-1626-4022-8773-a516a5e52701`, failed after installation when pnpm tried
to reinstall dependencies before formatting. Real offline commit/push regression
tests reproduced it. The correction propagates a consistent owned store and
isolated configuration through nested commands, keeps dependency verification in
error mode, and suppresses candidate/default/global pnpm hooks. An empty pnpmfile
setting works around the pinned pnpm 11.19.0 verifier's undefined hook inventory;
no package-manager source was patched and verification was not disabled. Real
clean runs passed while deliberate dependency drift failed with unchanged lock
and module metadata.

A separate bootstrap regression proved `.npmrc` did not enforce the proposed
frozen setting. `frozenLockfile: true` in workspace YAML now rejects dependency
drift before automatic repair or the bootstrap entry point. The ignored setting
was removed. These failures remain recorded rather than relabeled as passes.

The ordinary integrated tooling command subsequently had 528 passed and 2 failed
tests out of 530 (128.95 seconds). Unlike the direct author harness, its nested
Windows environment exposed `NPM_EXECPATH` in uppercase. Copying the environment
into a plain object lost Windows' case-insensitive lookup, leaving the discovered
CLI path undefined. The clean commit/push probes failed; dependency-drift probes
still passed before reaching that boundary. That result is not passing coverage
evidence and requires a corrected ordinary-command run.

The Windows-only environment repair was independently reviewed and integrated as
`process.mjs` SHA-256
`f9340a1b324b6341b2fb2eb1405635d5c7bcc4f34bf295d17a80bfd651ed9f7d`.
The subsequent ordinary `pnpm validate` passed all static checks, complete-target
coverage, builds, 21 functional browser checks, and 18 accessibility checks.
The final local target results were:

| Target    | Tests |            Lines |         Branches |
| --------- | ----: | ---------------: | ---------------: |
| API       |    82 |     80/80 (100%) |   41/42 (97.61%) |
| Shared UI |     3 |     19/19 (100%) |     7/8 (87.50%) |
| Web       |    27 | 221/231 (95.67%) | 219/230 (95.21%) |
| Tooling   |   539 | 823/866 (95.03%) | 688/772 (89.11%) |

No tests were skipped in this Windows run. The tooling command took 140.63 seconds.
Functional run `run-1f3602f4-9418-4cf7-b004-546d87d437b3` passed in 10.2 seconds;
accessibility run `run-1a8e5087-cf9f-4666-babc-976cc30419c7` passed in 27.4 seconds.
Both used compiled API and built preview with three browser engines. Build run
`21ed320f-9858-4f99-b869-c5ad80774941` recorded artifact identity
`eb4aceeb0339cb5ee04a22e3e02a0d059dcc731915d426ac2e638cef0761af5b` and manifest
SHA-256 `3552ac36003c4ef08664c49bc67ffaf15707d554d3887315e70878bfe89ca928`.
This is a pre-commit, dirty-tree observation; subsequent evidence-document edits
and committed-candidate gates have separate identities. It does not establish
hosted CI, current-candidate approval, or Product acceptance.

Remote main protection was installed and read back: strict required aggregate,
independent/code-owner approval, stale-review dismissal, last-push approval,
resolved conversations, enforced administrators, no force push or deletion.
Workflow YAML is independently exercised by contract tests, but hosted CI and
human review are separate evidence and remain required on the actual PR.

## Hosted Follow-Up

[Draft PR #2](https://github.com/stara-labs/stara/pull/2) initially delivered
`2a7533d8620a0c4809938a98b6d8d95fd772846f`. Actual installed commit and push hooks
passed. The independent verifier checked the outgoing record, all 146 source
hashes, 13 retained build files, and 15 required passing push results. Push run
`ec441f33-936f-4840-94e5-13f16d287cba` retained build manifest SHA-256
`cc0e83acfc48f2a648f6aa6d5b95e11755147e060811de53fd20940df3ab3948`.
This was evidence inspection, not a GitHub approval or human acceptance.

[Hosted run 34443817585](https://github.com/stara-labs/stara/actions/runs/34443817585)
passed the complete Linux container journey in 3m43s, including repeated startup,
21 functional checks, 18 accessibility checks, diagnostics, and scoped shutdown.
Candidate verification failed with 34 failed, 498 passed, and seven Windows-only
tests not applicable on Linux. The required aggregate correctly failed. No hosted
coverage or complete-candidate pass is claimed for that run.

Native Linux reproduction confirmed that the test fixture's directory-only
`node_modules/` ignore rule did not ignore its dependency symlink. Git committed
that link as mode `120000`; the production snapshot guard correctly rejected it
before the intended test behavior. The independent test author corrected both
fixture ignore rules and added a committed-tree/repeated-staging regression.
Production controls, assertions, floors, and applicability rules were not relaxed.
The original native regression failed before this correction. A subsequent full
native Linux run passed 533 tests, with the same seven Windows-only cases not
applicable, closing the 34 original failures plus the new fixture regression.
The corrected ordinary Windows tooling command passed all 540 tests in 132.13
seconds, with unchanged 823/866 lines (95.03%) and 688/772 branches (89.11%).
Hosted verification must be renewed on the corrected commit.

Do not merge based on this local ledger. Obtain independent final verification,
responsible Engineering acceptance, and Stara Product Owner acceptance. Record
accepted defaults centrally only afterward. Keep issue #1 open until the complete
golden-path acceptance contract is satisfied. Release publication, licensing,
deployment, authentication, persistence, and agent execution are not implemented.
