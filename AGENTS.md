# Stara Agent Instructions

## Scope and Authority

This is the Stara application monorepo, not the Product System repository.
Implement the approved scaffold under issue #1. Keep private Product System
documents and token inputs outside this repository and ordinary builds.
Only approved generated token CSS and provenance may be checked in.

The initial external Product System authority is immutable revision
`60f949e21d0fbe82dbdda5801715dbe1172e7b1b`. Maintainers consult that external
authority; public contributors use this repository's implementation contracts.
Do not claim Product System conformance before acceptance is recorded.

## Ownership

The Stara Senior Product Engineer agent owns proposal and implementation.
The responsible human Engineering owner accepts Engineering outcomes; the Stara
Product Owner accepts Product, visual, interaction, and authority boundaries.
Use independent review. Gate/control changes require a distinct test author,
implementer, and verifier; an implementer cannot approve their own advancement
or unilaterally weaken protected tests or acceptance criteria.

## Working Rules

- Read the owning project's instructions and contracts before changing it.
- Keep root files repository-wide; nest UI and backend implementation properly.
- Keep shared UI independent of feature composition and backend implementation.
- Use behavioral scenarios and red-green-refactor for observable behavior.
- Preserve unrelated changes; never reset, stash, or overwrite them for convenience.
- Use synthetic, customer-independent fixtures and label simulated behavior.
- Never commit secrets, private source snapshots, generated reports, or caches.
- Record exact revisions, selected scope, results, and verification limitations.
- No authentication, persistence, agent execution, deployment, release publishing,
  or license grant is part of the initial scaffold.

## Verification and Handoff

Read `docs/setup.md`, `docs/verification.md`, and the relevant scenarios in
`docs/requirements/scaffold.md`. Use the owning package commands and root gates;
do not weaken tests, exclude uncovered source, bypass hooks, or substitute an
unrelated running server. Every test report identifies its actual source and
scope. Changes to protected tests require the independent test author's review.

For UI, compare both external rendered references at the recorded pin. Verify
themes, keyboard/focus, 1100/900/700 widths, long labels, 200% text zoom, reduced
motion, and forced colors. Stop on unresolved authority conflicts. Ordinary
public builds must not require access to the external private checkout.

Use one honest handoff conclusion: `Ready for human review`,
`More journey evidence required`, `Revision required`, or
`Blocked by Product decision`. Name failures and missing evidence even when
other checks pass. Engineering and Product acceptance are not agent self-review.

## Delivery Boundary

The first main commit is repository metadata only. Executable scaffolding must arrive
through a separate branch, passing hosted checks, and independent review.
Do not claim that a named command, workflow, or review exists before it does.
