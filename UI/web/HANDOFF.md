# Scaffold UI Handoff

## Candidate

Authored in `work/scaffold-ui`, limited to `UI/web`, `UI/shared`, and `tests/e2e`.
No root, API, generated token, provenance, lockfile, or remote changes are included.
The integrator copies this authored set into the four-package monorepo. There is
no `tests/e2e/package.json`; Playwright remains a root-owned dependency and runs
from the repository root. No commit or Product acceptance is asserted here.

External Product System authority: `60f949e21d0fbe82dbdda5801715dbe1172e7b1b`.
The Stara UI skill, constitution, rationale, application frame, element specs,
accessibility, handoff, and shell fixture were read. Both authoritative HTML
references were rendered with Playwright and visually inspected before fidelity
decisions. Neither their source nor private fonts are included in this set.

The latest worker build consumed main's generated CSS through an ignored local
verification config. CSS SHA-256:
`097d8492749c7e491305125264b14ec2f8ebc78eff98de244cfdc8fdc781523a`.
Ordinary integrated builds use the relative generated stylesheet import.

## Implemented Boundary

The initial left rail exposes only Stara identity, Search and collapse or expand
icon controls, and Home. Destinations without a usable first surface are
intentionally absent.
Home and customer-independent Work, Conversation, App activity, and Knowledge
contexts are implemented. The initial working set is Home plus one Work item,
one Conversation, and one App activity; additional durable contexts remain
closed and discoverable through Search. Pointer and keyboard reordering, overflow,
canonical reopen, in-session draft/selection/scroll restoration, contextual
inspection, independent opening, local inspector views, resizing, focus return,
themes, and responsive layouts are exercised. Closing a context is not deletion.
New conversations contain an empty local draft, not seeded participant messages.

All people are role-labeled (`You`, `Responsible lead`, `Human contributor`), and
addresses are neutral synthetic values. Fixture guards enforce role-only person
fields, expected synthetic addresses, no two-part personal names in the fixture
and composed text, `verified: false`, and visible simulation/authority boundaries.
The text guard is a bounded fixture regression check, not general name detection.
All operational records are synthetic. Selection and draft changes do not mutate
source records, send messages, grant authority, execute agents, or verify an
external outcome. No infrastructure health feature appears in the product UI.
The health endpoint is used only by integration tests through the same origin.

Public Inter comes from pinned `@fontsource-variable/inter@5.3.0`. Its WOFF2 is
mapped to the `Inter` family and the build emits `licenses/Inter-OFL.txt` from the
package's LICENSE. OFL-1.1 applies to that third-party font, not the application.

## Verification

Observed on 2026-09-09 with installed React 19.2.8, Vite 8.2.2, TypeScript 6.0.3,
Vitest 5.0.0, RTL 16.3.3, user-event 14.6.7, Playwright 1.63.0, axe 4.13.0,
and lucide-react 1.43.0. Registry availability of user-event 14.6.1 was checked;
the integrator's installed prototype-compatible 14.6.7 was used.

- Web application: 20 tests passed; 95.67% lines (221/231), 95.21% branches (219/230).
- Shared: 3 tests passed; 100% lines (19/19), 87.5% branches (7/8).
- Both package TypeScript checks passed. Unsupported RTL `exact` options were
  removed; Playwright's supported options are retained.
- Browser suite: 36 passed across Chromium, Firefox, and WebKit. This includes
  same-origin compiled API health, actual nonzero scroll restoration, pointer and
  keyboard tab reorder, canonical close/reopen, overflow, keyboard focus, axe,
  dark/light themes at 1440/1100/900/700/390px, forced colors, reduced motion,
  doubled text, resolved generated tokens, loaded Inter, and font license delivery.
- Coverage includes all authored executable source, including the entrypoint and
  export modules. Only type declarations are excluded. CSS is not executable V8
  coverage. Gates remain 90% lines and 85% branches.

Worker browser evidence uses its built preview at `127.0.0.1:4175` with a compiled
main API process at `127.0.0.1:4176`, via the explicit external-server override.
This is not evidence of default-port or Compose startup. Integrated default tests
start compiled API 4174 and built preview 4173 with server reuse disabled.
Compose tests use `STARA_EXTERNAL_SERVERS=1` and
`STARA_E2E_BASE_URL=http://127.0.0.1:5173`; the integrator verifies that candidate.

Dockerfile changes pin the integrator-provided Node digest, use owned copies and
a writable dependency tree, and run development/build stages as `node`. No
production-server stage or deployment claim is made. The final hardened image
must be rebuilt by the integrator with the complete root build context.

## Evidence Retention Correction

The earlier fixed `test-results` and `playwright-report` directories were reused
between commands. Main reports six initial non-escalated Firefox launch failures
(`browserContext.newPage` / `_page`), followed by an isolated permitted launch and
a six-pass permitted Firefox rerun with two workers. These are reported
environment-permission failures, not demonstrated application failures. The
earlier partial console output remains, but its raw traces were overwritten by
the rerun. Those traces cannot be reconstructed and are not claimed as retained.

The corrected config creates one exclusive invocation directory at
`tests/e2e/.artifacts/<runId>/`, with `results/`, `report/`, and `run.json`. IDs are
UUID-based by default; optional `STARA_E2E_RUN_ID` values are bounded, validated,
and rejected if the directory exists. Reservation happens during parent config
loading, before output cleanup, even if a reporter is overridden. Workers inherit
the same ID without reserving another directory. The configured lifecycle reporter
records start/completion status; forced termination can leave an incomplete
lifecycle record. No automatic retries were added.

Four focused retention unit tests passed. Two separate actual Playwright
invocations of `UI-EVIDENCE-02` passed without browser/API startup:

- `run-971e4d66-6381-411f-80b5-87ebb6d7c13b`
- `run-1817c59c-f19d-4a5f-bc30-a211d24b46b9`

Both run directories retained distinct invocation proof files, HTML reports, and
finished/passed metadata after the second command. This proves invocation
retention, not a new full application-browser validation. CI must upload
`tests/e2e/.artifacts/**` for all lifecycle invocations. Existing pre-fix evidence
has not been relabeled or fabricated. The current full suite adds the retention
probe for each of the three projects; the earlier 36-pass application result is
kept separate from those probes.

## Red Evidence

Four explicit assertion-based red checks were observed before their fixes:

1. A reducer stub returned unchanged state when opening a context. The assertion
   expected the opened canonical identity to become active and failed.
2. A newly created conversation rendered four seeded contributions. A regression
   assertion expected zero, failed, and passed after draft-only rendering.
3. The role-only fixture-person allowlist failed against the earlier named lead,
   then passed after role labels and neutral synthetic addresses replaced them.
4. The composed-context text guard failed against the earlier named contributor,
   then passed after the source and rendered text corrections.

Additional browser-discovered failures drove fixes: invalid tab ownership and
nested interactive controls; light selected supporting-text contrast of 4.45:1;
and zero scroll extent after undefined generated-token references collapsed
layout. Harness startup and query-shape errors are not counted as red evidence.
Not every UI component was introduced test-first.

## Product Decisions and Limits

Conclusion: **Blocked by Product review** for visual acceptance, not for copying
the implemented candidate into integration. The consumer record remains
`validated: false` until that review is recorded.

- Product direction on 2026-09-10 selects the current generated Controlled
  Defaults for this foundation: 30px Home action row, 38px frame header, and 36px
  working tabs. This resolves the older 34px and 42px/38px reference conflicts
  for this candidate; it does not constitute final visual acceptance.
- Home uses the generic generated minimum tab width (104px), not the reference's
  special 84px Home width. The candidate deliberately defers a special Home width
  until Product review demonstrates that it improves the simplified working set.
- Supporting text on selected source rows and selected/hovered Home rows uses
  existing text-secondary instead of text-muted to fix measured light contrast.
  This existing-token substitution is a reported controlled-default deviation.
- The inspector starts closed per the requested shell fixture, unlike the open
  reference specimen. Reference outcome verification wording and authority
  buttons are deliberately not reproduced; the approved simulated scope retains
  an accepted scope separately from an unverified external outcome.
- Public Inter replaces private bundled font sourcing. No private font copy was
  made. The reference logo/avatars, recent list, settings/account integrations,
  and external-action controls are not implemented as live capabilities.
- Doubled-text evidence is a programmatic text-only zoom approximation, not a
  manual native browser-zoom session. Automated axe and keyboard evidence do not
  establish manual screen-reader acceptance, touch-device acceptance, or Product
  review. Independent integrated verification remains required.

## Complete Authored Path List

Paths below are relative to the worker root. Copy only these authored files;
exclude ignored `node_modules`, `.artifacts`, `coverage`, `dist`, and all generated
tokens/provenance owned by the integrator.

```text
UI/shared/.gitignore
UI/shared/README.md
UI/shared/package.json
UI/shared/src/Icon.tsx
UI/shared/src/controls.tsx
UI/shared/src/index.ts
UI/shared/src/primitives.module.css
UI/shared/src/styles.css
UI/shared/tests/controls.test.tsx
UI/shared/tests/setup.ts
UI/shared/tsconfig.json
UI/shared/vitest.config.ts
UI/web/.gitignore
UI/web/Dockerfile
UI/web/HANDOFF.md
UI/web/README.md
UI/web/index.html
UI/web/package.json
UI/web/src/App.tsx
UI/web/src/ContextContent.tsx
UI/web/src/ContextPicker.tsx
UI/web/src/Home.tsx
UI/web/src/Inspector.tsx
UI/web/src/Tabs.tsx
UI/web/src/env.d.ts
UI/web/src/fixtures.ts
UI/web/src/main.tsx
UI/web/src/shell.module.css
UI/web/src/useMedia.ts
UI/web/src/workspace.ts
UI/web/tests/integration/controls.test.tsx
UI/web/tests/integration/fixtures.test.tsx
UI/web/tests/integration/shell.test.tsx
UI/web/tests/setup.ts
UI/web/tests/unit/inspector.test.tsx
UI/web/tests/unit/e2e-artifacts.test.ts
UI/web/tests/unit/main.test.tsx
UI/web/tests/unit/tabs.test.tsx
UI/web/tests/unit/workspace.test.ts
UI/web/tsconfig.json
UI/web/vite.config.ts
UI/web/vitest.config.ts
tests/e2e/.gitignore
tests/e2e/accessibility.spec.ts
tests/e2e/artifact-reporter.ts
tests/e2e/artifact-retention.spec.ts
tests/e2e/artifact-run.ts
tests/e2e/playwright.config.ts
tests/e2e/shell.spec.ts
tests/e2e/tokens.spec.ts
```
