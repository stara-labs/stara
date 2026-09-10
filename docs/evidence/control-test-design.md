# Independent Control Test Design

## Ownership

The consequential test author owns only `tooling/tests/**` and this document.
Production implementation and final verification are separate roles. No production
edits, private Product System source reads, GitHub writes, or failing-test commits
were performed. Fixtures contain synthetic data and use owned temporary directories.

Copy `tooling/tests/*.mjs`, `tooling/tests/.gitignore`, the protected manifest, and
`tooling/tests/negative-controls/**`. Never copy `tooling/tests/evidence/**`.
Negative controls are deliberately unsafe synthetic test doubles, not production
implementations or a substitute for mutation testing. The public manifest contains
relative source hashes and concise evidence digests; raw reports remain ignored.

## Locked Interfaces

- `classifyChanges({files, knownPackages, baselineAvailable})` returns
  `{mode:'all'|'affected'|'docs', targets:[names], reason:string}`. Inventory records
  are `{name, relativePath}`. Targets are unique direct owners, expanded by native
  pnpm in orchestration. The complete Git proposal includes both rename paths and
  all commits since merge-base. Missing baseline, unknown/deleted ownership, root
  controls, manifests, protected tests, tooling, and the Product System consumer
  manifest broaden selection. Invalid inventories throw; unsafe paths broaden or
  throw. Only root Markdown and `docs/` are documentation-only.
- `assertCoverage(reports)` accepts nonempty distinct named records shaped as
  `{target,total:{lines:{pct},branches:{pct}}}`. Every target independently needs
  finite numeric percentages from zero through 100, at least 90 lines and 85
  branches. Exact floors and 100 pass. Missing/malformed totals, duplicate targets,
  or one failing target throw even beside a perfect repository aggregate.
- `assertRequiredResults(results)` accepts explicit `{name,required,status}`
  records with unique nonempty names and at least one required check. Only literal
  `pass` succeeds for every required check. Empty, absent, ambiguous, failed,
  skipped, or unknown required statuses throw. Explicit optional failures are
  permitted. Its successful return value is intentionally not prescribed.
- `validateLayout(trackedFiles)` and `validateDependencies(manifests)` return
  violation arrays. Manifests include `relativePath`, with `.` for root. Global
  files stay at root; application files have explicit owners. Web may use shared
  UI, never backend; shared UI cannot use web/backend. Every internal reference
  uses `workspace:` across all four dependency fields. Root has no runtime
  dependencies. Private Product System source and environment secrets are invalid.
- `hashBytes(buffer)` hashes exact bytes with SHA-256.
  `verifyTokenArtifact(cssBuffer, provenance, consumer)` requires equal 40-hex
  `sourceRevision`/`revision` and exact `cssSha256`. Synthetic DTCG projection tests
  require existing spacing, radius, and border values, including
  `--stara-space-1`, `--stara-radius-control`, and `--stara-border-hairline`.
  Primitive colors/fonts and invented scale values are not publicly projected.
- `materializeIndex(repo,destination)` preserves exact staged tracked bytes without
  changing the index, worktree, or stash. The approved implementation freezes the
  index/tree and reads Git blobs rather than applying checkout filters. Only a new
  or empty owned temporary destination is allowed. Linked paths, conflicts,
  dependency/build caches, symlinks, and gitlinks are rejected. Windows-ambiguous
  components, reserved devices, trailing dots/spaces, and case-only directory
  prefixes fail before any destination write. This tests ambiguity and merging;
  a traversal escape was not reproduced and is not claimed.
- `createRuntime` injects subprocess, environment, output, fetch, sleep, actor,
  run ID, Node, and pnpm paths. Child PATH keys are case-normalized on Windows;
  exact Node is preserved. Windows pnpm-discovery keys retain case-insensitive
  behavior after environment copying. Conflicting aliases fail before execution;
  identical aliases coalesce without changing the caller. Invalid explicit
  overrides still fail rather than falling back to another executable.
  Process errors are bounded and actionable. Compose
  endpoints are pinned locally, project scope is deterministic, and failures do
  not switch ports or trigger destructive cleanup. Startup errors preserve a
  sanitized bounded underlying diagnosis.
- `materializeCommit(repo,destination,commitOid)` returns `{commit,tree,files}`
  for an immutable full commit OID. Moving refs, missing/noncommit objects,
  annotated tags, Git replacement objects, and inherited Git redirection cannot
  substitute a different candidate. The same pre-write path checks apply.
- Manual `push` pins HEAD and the baseline once. `push --hook` consumes bounded
  actual pre-push stdin; its four-field records select outgoing local OIDs, not
  HEAD. All records are validated before candidate work. Branches and lightweight
  tags pointing to commits are supported; deletion and noncommit updates fail
  closed explicitly. UTF-8 chunk boundaries, CRLF, final unterminated records,
  duplicate destinations, stream errors, and timeouts have explicit contracts.

## Integration Coverage

Real Git fixtures exercise partial staging, staged addition/deletion/rename,
unstaged executable changes, source-only PATH binaries, and outside sentinels.
Staged validation uses frozen installation inputs and retains child selection,
results, command diagnostics, and durations after temporary cleanup. Missing or
invalid child evidence cannot pass.

Outgoing-push fixtures use real Git and actual Node unit failures to prove dirty
staged or unstaged repairs cannot hide a failing outgoing object. Candidate
selection, dependency inputs, unit execution, and builds use the commit snapshot.
Selection/results/build evidence retain `{commit,tree,base}` and ref mappings.
Multiple candidates retain distinct IDs, manifests, and readable command logs in
their `snapshot/` archives. Persistent additions, deletions, manifest edits, and
source edits (including nested `dist`/`coverage` source directories) invalidate
success. This is not a sandbox guarantee against modify-and-restore attacks.

Independent offline pnpm fixtures use only workspace dependencies and frozen
lockfiles. Actual pnpm installation must create module metadata; the subsequent
format command must succeed without replacing it or changing the owned store.
Observed parent and child commands retain the same trusted isolation settings,
with dependency verification in error mode, not disabled. A separate actual
`pnpm start` test uses the copied root configuration and checks that dependency
drift cannot rewrite the lockfile or enter bootstrap before its frozen install.
The pinned pnpm compatibility case explicitly retains an empty `pnpmfile` value
alongside hook suppression. Actual nested scripts must restore error-mode
verification; default, configured, and global throwing hooks never execute.
Deliberate dependency drift still fails with unchanged lock and module metadata.
The root `.npmrc` frozen setting proved ineffective in pnpm 11. The root owner
moved only that setting to workspace `frozenLockfile: true`; the actual bootstrap
regression then passed. No global configuration or pnpm source was modified.
Native-selection boundary tests use a pnpm double; these dedicated install/run
regressions use the real pinned executable. Neither proves the installed Git
hook's shell-to-pnpm wiring, which remains independent integration verification.

Commit, push, and PR workloads have explicit applicability. Builds target web/API;
integration targets web/API/tooling. Documentation PRs still run mandatory tooling
controls and coverage. Full PR selections additionally require a bounded root
`test:mutation` command and a nonempty completed mutation report; narrower proposals
skip that expensive command. Successful command exits cannot replace coverage,
artifact, or gate evidence. Build manifests identify source, dependencies, runtime,
configuration, Product System revision, and every output file's hash.

The actual CI YAML is parsed independently. Tests cover read-only permissions, no
secrets or privileged PR triggers, immutable action pins, no path filtering,
full-history checkout, Linux candidate/Compose jobs, Windows omission only on PRs,
and non-PR targeted mutation. The real aggregate shell is executed with successful,
failed, canceled, missing, unknown, and unexpectedly skipped statuses. All required
jobs must pass; diagnostics upload even on failure.

An integration regression exercises ESLint's actual `isPathIgnored` API against
the copied and hashed root configuration. Root and nested browser-report
`.artifacts` assets must be ignored, while application source, tooling source,
protected tests, and browser tests remain lintable. Its initial run passed five
cases and failed only the nested retained-report case before the root owner
changed the global ignore pattern. This does not exclude authored tests or source.
The fixed configuration passed all six cases. A hash comparison confirmed that
the only configuration difference from the captured red input was
`.artifacts/**` becoming `**/.artifacts/**`; retained report contents were untouched.

## Behavioral Red Evidence

Before production implementation, 210 tests executed against deliberately unsafe
test doubles: 188 failed and 22 passed, with none skipped. Later regressions were
locked and meaningfully red before their corresponding fixes: artifact/evidence,
PATH casing, native pnpm root inventory, staged cache/source isolation, primitive
projection, Windows path ambiguity, durable staged evidence, selective mutation,
startup diagnostics, and nested ESLint artifacts. Their log and source-set SHA-256 digests are recorded in
`tooling/tests/protected-tests.manifest.json`.

Later actual red cases cover outgoing-object isolation, hook candidate handling,
nested source drift, split UTF-8 input, isolated pnpm automatic reinstallation,
and bootstrap's pre-install lock rewrite. Focused runs explicitly identify their
selected and unselected counts; unselected tests are not reported as executed.
The initial root-scratch layout mistake, pnpm metadata-format assertion, and
candidate log-directory assertion were author corrections, not production defects
or accepted red evidence.

The first 530-test direct author run was green, but the ordinary integrated pnpm
command subsequently failed two clean nested-script cases. This blocked handoff.
Actual child diagnostics proved that Windows exposed `NPM_EXECPATH`: native
`process.env` found it case-insensitively, while the copied plain object did not.
The path was a valid JavaScript CLI, not a managed executable. Focused discovery
and ordinary-invocation regressions retain this red independently of the earlier
standalone success; neither explicit-path injection nor suffix relaxation is an
acceptable substitute for correcting discovery.

Missing Vitest was a harness blocker, not red evidence. Missing production modules
produced setup-only failures, not executed behavioral proof. Neither is counted in
the behavioral red ledger. Raw logs and machine-specific paths are not public.

## Mutation Evaluation

The root command remains `stryker run tooling/tests/stryker.config.mjs`.
`run-stryker.mjs` is only the author's isolated evidence harness. StrykerJS 10 uses
its official command runner to invoke Vitest 5 for each mutant. The installed
Vitest runner plugin joined nested test names with spaces while Vitest 5 matched
`>` separators, resulting in zero executed mutant tests. Those misleading
reports are rejected as evidence; no dependency source was patched.

Mutation is limited by parsed function ranges to `classifyChanges`,
`assertCoverage`, and `assertRequiredResults` in `policy.mjs`. Only five approved
public files enter Stryker's sandbox; private packages/source are not copied.
Reports use `.artifacts/mutation`, with temporary sandboxes under
`.artifacts/stryker`. There is no invented mutation-score floor.

The first valid run killed 117 of 150 mutants, leaving 33 survivors. Survivor
inspection prompted additional inventory, Markdown ownership, protected-test,
tooling-owner, perfect-coverage, and actionable-error cases. The final completed
campaign killed 143 mutants and left 7 survivors, with no timeouts, errors,
uncovered mutants, or pending outcomes. This is targeted mutation evaluation, not
a whole-repository Stryker campaign or independent acceptance.

| Surviving IDs | Disposition                                                                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 19            | Removing optional access on a null package still throws; invalid inventory cannot pass.                                                       |
| 58            | Removing the root test-directory regex alternative still broadens root test paths through unknown ownership in the accepted package layout.   |
| 60            | Removing the test-file suffix anchor may broaden extra paths to full selection; it cannot omit required checks.                               |
| 103, 104      | Removing optional access on missing coverage totals still throws; missing evidence cannot pass.                                               |
| 112           | The remaining `Number.isFinite` guard already rejects every nonnumeric value; removing the separate type guard admits none.                   |
| 155           | A different successful return value is outside the locked contract; callers use exceptions, not this return value, to determine gate failure. |

No required behavior-bypassing survivor remains under the locked contracts.
The verifier must independently review these dispositions; they are not a score
waiver. The four empty-diagnostic survivors were killed by assertions preserving
inventory diagnostics, failing target/metric identity, and required-check names.
The later push/isolation work did not change the policy source, policy tests, or
mutation configurations. Their exact hashes are checked against the completed
campaign before its results are carried into the final protected manifest; this
does not claim a new mutation run over the added orchestration code.

## Verification Status

The replacement author run passed all 539 tests with zero failures or skips,
using lifecycle CLI discovery without a test CLI override. Full-library/script
V8 coverage is 95.03% lines (823/866) and 89.11% branches (688/772). The coordinator
also reported the actual ordinary root validation's tooling run green at 539/539,
zero skips, with identical coverage and no test CLI override. That reported
integrated run took 140.63 seconds; it is distinct from author execution evidence.
The protected manifest identifies the current author inputs and retained logs.
Author execution is Windows with Node 24.16.0, Vitest 5, and pnpm 11.19.0; actual
package-manager regressions use no external dependencies. Formatting and ESLint
checks passed for the authored set.
Linux execution and final acceptance remain the separate verifier's responsibility.
The authoritative V8 configuration includes every production library and script,
has no file exclusions, and enforces tooling's 90-line/85-branch floors.

Official references: [Stryker configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)
and [runner documentation](https://stryker-mutator.io/docs/stryker-js/vitest-runner/).
