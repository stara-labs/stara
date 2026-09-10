# Verification and Delivery

Status: Candidate Implementation; Execution Evidence Recorded Separately
Scope: Scaffold Gates, Supported Environments, and Acceptance
Decision owner: Responsible Engineering Owner
Last reviewed: 2026-09-10

## Required Evidence

Use [scaffold scenarios](requirements/scaffold.md) as the acceptance contract.
Behavior changes begin with a recorded failing regression/scenario, followed by
implementation and refactoring. Do not commit failing code to prove the red
stage. Record the source revision or source manifest, tests, command, actor/run,
environment, selection explanation, result, and artifact digest. Red evidence
without captured test/source identities has an explicit provenance limitation.

Use Passed, Failed, Not applicable, and Not executed literally. A successful
install is not a test result; a local test is not hosted CI; CI is not Product
acceptance; acceptance is not production deployment. A changed candidate, tool,
fixture, configuration, dependency, or token pin invalidates affected evidence.

## Layers and Coverage

Every package runs unit/contract tests and complete-target V8 coverage. Web
integration tests exercise component composition; API integration tests use
real HTTP and compiled process startup/shutdown. Tooling integration tests use
real temporary Git repositories and bounded subprocesses. Shared UI component
contracts live in its unit suite; cross-project integration is owned by web and
`tests/e2e`, not an empty shared-UI integration script.

Each affected eligible target must reach at least 90% lines and 85% branches.
The denominator includes unexecuted authored production files, not just changed
or selected-test files. A passing aggregate cannot conceal a deficient target.
Generated token CSS, dependencies, tests, and build output are not authored
production JavaScript/TypeScript. There is no legacy coverage exemption here.
Reports identify their target and denominator; selected coverage is never called
whole-repository coverage. Full nightly runs cover all targets.

Tooling JavaScript receives ESLint/parser checks and behavioral tests. TypeScript
type checking applies to UI and API packages. Builds produce web static output
and compiled API output; browser verification exercises those built outputs as
well as the separate container-development journey.

## Gate Placement

| Gate    | Evidence                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commit  | Exact isolated index: formatting, lint/static checks, secrets, directly affected unit/contract tests                                                                          |
| Push    | Each isolated outgoing commit: complete proposal, affected targets and native pnpm dependents, unit/contract tests and build                                                  |
| PR      | Current merge candidate: static/security checks, complete affected-target coverage, relevant integration, functional E2E, accessibility, mandatory control and startup checks |
| Nightly | All unit/contract, integration, coverage, functional E2E, accessibility, builds, and container startup across the declared matrix                                             |
| Release | Not implemented in this scaffold; requires complete applicable evidence for an explicitly authorized mainline candidate                                                       |

Root/toolchain changes, missing history, deleted targets, unknown paths, or
incomplete impact mappings broaden scope. Modified tests are selected. Shared
dependencies select transitive consumers using pnpm. Selection explanations and
protected rules are independently reviewable. Local hooks are feedback, not a
replacement for server-enforced gates. Unstaged fixes cannot make an invalid
index pass, and gates never silently stage or stash work.

Push selection pins each outgoing commit, its tree, and its merge base against
the captured `origin/main` reference. Missing baseline history broadens testing;
an unavailable outgoing commit fails closed. Multi-ref pushes validate every
distinct supported outgoing commit, not merely HEAD. Candidate manifests,
dependency installation, checks, and builds use the isolated tree. Evidence
retains those identities and the actual hashed build bytes. Before/after source
identity checks catch persistent snapshot drift; they are not an OS sandbox or
proof against a process that changes and restores files between checks. The
supported ref types and refusal behavior are documented in [setup](setup.md).

## Supported Matrix and Operations

Use the exact pinned Node and pnpm on Linux and Windows. PR candidate and
container/browser checks run on Linux. The Windows package job runs on PRs as
well as every other supported workflow event; its coverage and build must pass
before the required aggregate succeeds. A skipped Windows job is missing
evidence, including on PRs. Full package verification runs on Linux and Windows
nightly and on mainline candidates; Linux runs Chromium, Firefox, and WebKit
functional/accessibility verification. Windows containers are not part of this
Linux-container scaffold.

Full nightly verification is scheduled at **08:17 UTC**, daily. GitHub Actions
retains diagnostics for 30 days. The failure and missed-run owner is
`@JohnLozano-Stara`, who must subscribe to workflow notifications and check the
expected nightly by 10:30 UTC. A missing or canceled run is missing evidence,
not success. Scheduled Actions alone cannot detect a platform-wide scheduler
outage; external alerting remains an operational follow-up before deployment.

On failure, preserve initial failures and all retry attempts; assign a scenario,
target, owner, and corrective work. Triage scope before allowing unrelated work.
Affected promotion remains blocked until passing corrective evidence exists;
unrelated work needs independent evidence that it is unaffected. A flaky test
is not deleted or silently skipped to obtain a pass. Browser retries default to
zero so failures remain immediately visible.

Measure command and job duration, queue delay, fallback rate, and flaky failures.
The normal PR target is ten minutes. Cold image/browser installation and full
container jobs have a proposed 25-minute ceiling; package jobs have 20-minute
hard timeouts. These are budgets to measure, not achieved performance claims.
Optimize caches/selection without reducing required evidence.

## Additional Risk Testing

| Paradigm          | Scaffold applicability                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract          | Required: HTTP health/configuration, UI behavior, package boundaries, control interfaces                                                     |
| Property/stateful | Required targeted state-sequence invariants for tabs and impact/failure controls; broader generative testing follows added domain complexity |
| Mutation          | Required targeted evaluation of consequential selection, coverage, and advancement controls before those controls are accepted               |
| Accessibility     | Required: axe plus keyboard/focus, themes, width, text zoom, reduced motion, and forced-color checks                                         |
| Security          | Required: secret scan, dependency audit, dependency boundaries, sanitized logs, least-privilege workflow/review controls                     |
| Performance       | Required bounded startup/gate feedback measurements; product load/SLO thresholds remain future requirements                                  |
| Resilience        | Required: unavailable Docker, port conflicts, invalid config, failed readiness, repeated startup, bounded shutdown, unknown impact           |
| AI evaluations    | Not applicable: no model execution, prompts, or AI decision pipeline is implemented                                                          |

Do not mark an applicable evaluation passed merely because it is listed here.
Execution records must name actual probes and limitations. Future authentication,
tenancy, persistence, or agent execution requires new risk-based requirements.

## Review and Recovery

Protect `main` with the `Required scaffold checks` aggregate, current-candidate
status checks, resolved conversations, an independent approving review, stale
approval dismissal, and no force pushes. Verify installed remote settings; YAML
and CODEOWNERS alone do not prove enforcement. Fork validation has read-only
permissions, no secrets, and no privileged publication path.

Consequential controls have distinct test-author, implementer, and verifier
actors. The implementer cannot approve their own change or weaken protected
tests unilaterally. Rejected implementations return with concrete findings;
legitimate test corrections require independent test-author review and renewed
red/green evidence. Escalate ambiguous Product behavior to the Product Owner.

Repair failures through a new reviewed change and fresh candidate evidence.
Use `pnpm environment:down` to stop only this checkout's development services;
it must not prune Docker or remove volumes. No production rollback or release
publisher is provided. Before merge, the responsible human accepts Engineering
and the Stara Product Owner accepts Product/visual outcomes. Agent review does
not supply either human acceptance.
