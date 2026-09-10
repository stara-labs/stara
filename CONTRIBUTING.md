# Contributing to Stara

Start with [requirements](docs/requirements/scaffold.md),
[architecture](docs/architecture.md), and [verification](docs/verification.md).
This application consumes shared Stara standards; it is not a second standards
repository. Keep source and project-specific configuration in the owning package.

## Workflow

1. Link the work item and stable behavioral scenarios. Product owns behavior;
   Engineering refines implementation without silently deciding open questions.
2. Add a regression/scenario test and record its expected failure before changing
   behavior. Implement, pass tests, and refactor while preserving the contract.
3. Run affected local gates. Commit gates inspect isolated staged bytes, not
   unstaged fixes. Push hooks check isolated outgoing commit trees, not the live
   checkout; manual `pnpm check:push` checks HEAD. Keep conventional commit
   messages and actual issue references. See [supported push operations](docs/setup.md)
   before sending tags or multiple ref updates.
4. Open a PR with scope, risk, release impact/no-release rationale, exact candidate
   evidence, selection explanation, complete affected-target coverage, and known
   limitations. Use `Refs #1` for this initial scaffold, not a closing reference.
5. Resolve independent review, rerun invalidated checks, and validate the current
   merge candidate. Protected reviews and CI authorize advancement; local green
   results alone do not.

Use Conventional Commits such as `feat(shell): restore an open context` with a
real issue reference in the body. The initial work item is GitHub issue #1;
no Linear identifier has been supplied, so do not invent one. Introducing the
organization's eventual issue-traceability integration is separate work.

## Consequential Controls

Changes to gates, test selection, coverage policy, bootstrap safety, token
verification, or delivery permissions require distinct test-author, implementer,
and verifier actors. Test authors own protected test expectations. Implementers
submit corrections for independent review instead of silently weakening tests.
Verifiers examine requirements, implementation, negative cases, and evidence
independently and may reject the change. Escalate unresolved Product or authority
questions to the responsible human.

Keep credentials out of tests and untrusted CI. Dependency/action/token changes
need review of provenance, install scripts, compatibility, security, and migration
consequences. Public visibility is not a license grant. Do not introduce a release
publisher, deployment secret, or external effect in the scaffold.

## Acceptance

The responsible Engineering owner accepts engineering outcomes. The Stara
Product Owner accepts Product, visual, interaction, and authority behavior.
Independent agent review cannot replace these human decisions. Update central
adoption records only after accepted immutable-candidate evidence exists; keep
the consumer record unvalidated and issue #1 open in the meantime.
