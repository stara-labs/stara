# Scaffold Requirements

Status: Approved implementation scope; acceptance evidence pending
Product owner: Stara Product Owner
Engineering owner: Responsible Engineering owner

## Product Shell

These scenarios apply accepted shell behavior to synthetic, customer-independent
application fixtures. The fixtures do not authorize external effects.

- **SHELL-01:** Given a fresh session, when the shell opens, then Home is active,
  the three-region frame and center header follow the accepted design, and the
  right inspection panel is closed. The initial left rail contains only Stara
  identity, Search and collapse or expand icon controls, and Home. Product
  destinations enter the rail only when their first usable surface exists.
- **SHELL-02:** Given several open contexts, when a context is reopened, then its
  existing tab is focused, not duplicated. Closing a tab never completes or stops
  its underlying fixture object; Home remains non-closable. Only durable,
  resumable working contexts become center tabs. Navigation destinations,
  inspection, permission prompts, transient dialogs, and creation steps do not.
- **SHELL-02A:** Given the initial fixture, when the shell opens, then its complete
  working set is Home plus one Work item, one Conversation, and one App activity.
  Additional synthetic contexts remain closed and discoverable through Search.
- **SHELL-03:** Given a working set, when tabs are reordered by pointer or
  keyboard or overflow at a narrow width, then identity and operational signals
  survive and contexts remain accessible.
- **SHELL-04:** Given a context's draft, selection and scroll position, when the
  user switches away and returns during the session, then meaningful local state
  is restored. No cross-device or server persistence is implied.
- **SHELL-05:** Given an attention item, when the user selects, inspects or opens
  it, then those actions remain distinct; inspection supports the active center
  and restores keyboard focus when closed.
- **SHELL-06:** Given light/dark themes, 1100/900/700px widths, long labels,
  200 percent text zoom, reduced motion and forced colors, when the shell is used,
  then its controls, content, focus and state distinctions remain usable.

## Engineering Invariants

- **BOOT-01:** A clean authorized checkout starts the local UI and API with one
  command after declared prerequisites. Only successful readiness yields URLs.
- **BOOT-02:** Repeated startup converges without deleting data, changing remote
  systems or stopping unrelated services. Missing Docker, invalid configuration,
  occupied ports and failed readiness produce bounded, explicit failures.
- **API-01:** A serving backend responds to `GET /api/health` with HTTP 200 and
  exactly `{"status":"ok"}`. This proves service availability only.
- **API-02:** Invalid startup configuration fails before listening. Logs and
  error responses do not expose credentials; shutdown drains within a bound.
- **BUILD-01:** Ordinary install, tests and production builds need no private
  Product System access. Generated CSS is tied to a declared revision and digest;
  authorized token updates are independently reproduced against the external source.
- **GATE-01:** Commit checks see staged files only. Unstaged fixes or untracked
  dependencies cannot turn a failing staged change into passing evidence.
- **GATE-02:** Push and PR selection covers the complete proposal and dependent
  packages. Unknown impact, missing history, changed controls or missing targets
  broadens verification; required checks cannot pass through missing results.
- **GATE-03:** Each affected eligible target meets 90 percent line and 85 percent
  branch coverage, including unexecuted source; passing totals never hide a
  below-floor target.

## Boundaries

No accounts, persistent agents, database, business API, deployment, license grant
or release publishing is included. Engineering and Product acceptance remain
separate from implementation and test success. The implementing agent cannot
self-approve protected tests, selection controls, or Product behavior.
