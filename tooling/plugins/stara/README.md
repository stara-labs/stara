# Stara Codex plugin

This local plugin connects Codex to the two read-only tools merged in Stara
PR #8. It is a development integration for a trusted Stara checkout and a local
HTTP API. It does not connect to hosted staging or provide business workflows.

| Tool                       | Result                                                           |
| -------------------------- | ---------------------------------------------------------------- |
| `stara_get_health`         | `{ "status": "ok" }` when the HTTP handler answers               |
| `stara_get_runtime_config` | Public schema version and `development` or `staging` environment |

The `check-local-stara` skill explains these results and connection failures.
Both tools accept empty or omitted arguments. Synthetic UI fixtures are not
exposed as business records. There is no persistence, write API, authentication,
agent execution, or remote MCP endpoint in this plugin.

## Prepare a local installation

Use the repository's pinned Node and pnpm, follow `docs/setup.md` in your Stara
checkout, and build the existing MCP entrypoint:

```sh
pnpm --filter @stara/api build
```

Run the setup command from the repository root. Supply absolute paths to the
checkout that owns the helper and a **new** output directory inside that checkout's
`.artifacts/` directory. The output's parent must already exist; setup creates
`.artifacts/` itself when needed. Example for Windows:

```powershell
node tooling/scripts/configure-stara-plugin.mjs C:/code/stara/stara C:/code/stara/stara/.artifacts/stara-plugin
```

Example for Linux or macOS (substitute your actual checkout location):

```sh
node tooling/scripts/configure-stara-plugin.mjs /work/stara /work/stara/.artifacts/stara-plugin
```

Setup verifies the package identities, Node pin, and compiled entrypoint, then
copies only this plugin and its local catalog. It binds `checkout.json` to the
helper's canonical checkout and writes that same `STARA_REPO_ROOT` plus the
validated `STARA_API_URL` into the generated plugin's `mcp.json`. It does not
build, start the API, install a plugin, or change an existing output directory.
Generated configuration stays under ignored `.artifacts/`; do not commit machine-specific
paths. Setup resolves filesystem links and rejects output outside that directory.
Choose an output path without `#`: Codex `0.153.4` interprets that character as
a Git reference when registering a marketplace. Spaces are supported. The Node
launcher separately supports bound checkout paths containing spaces and `#`.

The optional third argument chooses another loopback API origin, for example
`http://127.0.0.1:3010` when Stara uses `STARA_API_PORT=3010`. The merged MCP
validator accepts HTTP origins with `127.0.0.1` or `[::1]` and an optional port.
Hostnames, remote services, credentials, extra paths, queries, and fragments
are rejected. Requests reject redirects and have a five-second deadline.

Only use a checkout whose code you trust. Selecting it authorizes Node to run
its compiled MCP code; checking package names and a version pin is not a code
signature or sandbox. Required metadata and compiled MCP files must resolve
inside that checkout, including when filesystem links are used.

## Add the generated catalog to Codex

Use a Codex version supporting portable plugins (native verification used CLI
`0.153.4`). Node must be on the environment path used by Codex. Register the
**generated output directory**, not this unconfigured source template:

```powershell
codex plugin marketplace add C:/code/stara/stara/.artifacts/stara-plugin
codex plugin add stara@personal
```

On other systems, use the absolute output directory from setup. The generated
catalog is named `personal`; check `codex plugin marketplace list` first if you
already registered a different catalog with that name. Do not replace an
unrelated catalog to install this plugin.

Start a new Codex task after installation, then ask: “Check my local Stara API
and report its environment.” Verify that both Stara tools are discovered and
return the expected results. The HTTP API must be started separately using
Stara's normal setup workflow. MCP discovery can succeed while HTTP calls fail.

## Configuration and updates

Codex copies plugins into its cache. `${PLUGIN_ROOT}` resolves the launcher
inside that copy. The fixed package-local `checkout.json` identifies its external
built checkout; `STARA_REPO_ROOT` must match that binding. Changing an environment
variable cannot retarget the plugin. The plugin does not guess a checkout from
the current task directory.
The portable format uses explicit `env` values; shell environment overrides
and legacy plugin-root placeholders are not its configuration mechanism.

The source template intentionally leaves both checkout binding and
`STARA_REPO_ROOT` empty and fails with setup guidance until a configured copy
is generated. Its portable
`plugin.json` and `mcp.json` provide the MCP connection. The supplementary
`.codex-plugin/plugin.json` supplies compatibility metadata and skills; older
clients that ignore the portable manifest do not get a working MCP connection.

To change checkout, run the helper from the new trusted checkout; the helper
rejects a repository argument pointing to another checkout. Use its canonical
path rather than an alternate junction or symlink alias. To change API port,
rerun the owning helper. Always generate a new output directory. After checking
that `personal` refers to this generated Stara-only catalog, replace that local
installation using the new output path:

```powershell
codex plugin remove stara@personal
codex plugin marketplace remove personal
codex plugin marketplace add C:/code/stara/stara/.artifacts/stara-plugin-next
codex plugin add stara@personal
```

Use a new Codex task afterward. These commands remove the selected local plugin
cache and catalog registration; do not run them against an unrelated catalog.
Treat plugin updates and rebuilding the selected MCP checkout separately: the plugin
loads that checkout's current compiled output, not a bundled application image.
Never point the setup command at the source plugin directory or edit Codex's
cached copy as an update mechanism.

Startup failures are sanitized on stderr; stdout contains only MCP messages.
An unavailable API returns `isError: true`. A health success is handler
availability only, and a local `staging` label does not verify a hosted release.

See the repository's `backend/api/MCP.md` for the underlying MCP contract and
`docs/evidence/codex-plugin.md` for executed verification and limitations.
The packaging format follows the official
[OpenAI plugin guide](https://developers.openai.com/plugins/build/plugins).
