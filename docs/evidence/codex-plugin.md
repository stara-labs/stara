# Local Codex plugin verification

Date: 2026-09-13. Candidate branch: `feat/codex-plugin`, based on merged main
`2455f8a9ec9a92422624284c08a689587f9cdefd` (PR #8). This records local
Engineering evidence; human acceptance and hosted checks remain separate.

## Scope

The plugin packages the existing local MCP health and runtime tools, a focused
diagnostic skill, and a setup command that creates a configured local copy.
It uses portable `plugin.json` and `mcp.json`, with compatibility metadata in
`.codex-plugin/plugin.json`. No application API, staging control, authorization,
production setting, package dependency, or business tool was changed.

The distinct test author added the two plugin suites and extended complete
tooling coverage to `plugins/*/scripts/**/*.mjs`. Existing denominators and
the 90% line / 85% branch floors remain intact; no exclusions were added.

## Initial implementation checks

- Passed: 59 focused plugin/setup tests on Windows, Node `24.16.0` and pnpm
  `11.19.0`. A separate verifier also ran all 59 successfully.
- Passed: complete tooling coverage, 2,243 tests across 35 files. Lines were
  96.30% (2,711/2,815), branches 93.10% (1,797/1,930), with unchanged floors.
  Before/after implementation and test hashes matched. The retained coverage
  summary SHA-256 is
  `f16f327dec80f4d7574c72f83b5cfe24e49d1a4938b8b4cd10db10327b083b69`.
- Passed: actual Codex CLI `0.153.4` local catalog installation into an isolated
  Codex home. The native loader connected the cached plugin's MCP server,
  discovered exactly two tools, and returned correct health and development
  runtime responses from this checkout's freshly compiled Fastify API on an
  owned ephemeral loopback port. Both tools returned sanitized errors after
  that API closed. No model turn or user-global Codex configuration was used.
- Passed: native cache manifest, launcher, MCP configuration, and skill bytes
  matched the configured copy. Native results are retained under ignored
  `.artifacts/plugin-review/actual-1789268765976/results.json`, SHA-256
  `42a9ff2b38a04cbc250ae5080557a5be7826118f25465835ad54e0c6a1ab439f`.
- Passed: current plugin-creator validator, skill-creator validator, and
  targeted ESLint. Validator-only PyYAML `6.0.2` was installed into ignored
  local tooling storage after the bundled Python lacked it; project and
  global dependency manifests were unchanged.
- Passed: repository secret scanning. Formatting first flagged the generated
  catalog's indentation; only that file needed normalization.

Tests cover explicit trusted checkout selection, pin and package validation,
missing builds, encoded paths, sanitized startup failures, EOF, cache relocation,
tool discovery/calls, unavailable API, configuration validation before writes,
fresh-output creation, concurrent setup, and preservation of existing output.
Synthetic test data does not establish business-data or hosted deployment behavior.

## Preserved failures and compatibility findings

Initial red runs reached absent launcher and setup modules. Those runs prove
missing scaffolding, not execution of every individual failing scenario; test
and base identities were captured. A preliminary sandbox invocation failed to
find Vitest; the correct workspace invocation reached test collection.

The first launcher run passed 25 cases and failed two: the incomplete manifest
and a Vitest dynamic-import limitation for encoded `#` in a file URL. Native
Node successfully loaded the same special-character checkout. The suite keeps
that native regression and uses a plain fixture for the in-worker default path.
A subsequent test-table argument-binding error was corrected by its author;
the original failing run and passing recovery are both retained.

Native Codex verification found that compatibility `.mcp.json` did not expand
the legacy plugin-root placeholder. The portable format supports `${PLUGIN_ROOT}`
but rejects `env_vars` and does not interpolate arbitrary environment variables.
The final setup command supplies explicit `env` strings in a separate configured
copy. Native catalog installation also rejected output paths containing `#`;
the setup guide records that CLI limitation. These failures were not concealed
by treating a manually substituted SDK launch as native Codex evidence.

## Containment correction

The first normal commit hook rejected the initial implementation: pinned CodeQL
reported ten new path-injection findings in launcher reads and setup writes.
Gate `e4392aaf-b8b4-4a16-a46d-37f2437f41a8` failed; no commit was created.
The unchanged security baseline and retained SARIF record that failure.

The independent test author recorded four executed failing regressions for
checkout metadata and compiled-output junction escapes, an output outside the
helper's `.artifacts`, and an output-parent junction escape. The implementation
now canonicalizes required checkout files and confines setup output to the
helper checkout's canonical `.artifacts` with an existing parent. After the
correction, all 66 focused cases passed. These include legitimate checkout
junctions, missing-parent refusal, and an escaped `.artifacts` junction.
Fresh verification of the corrected source passed:

- The distinct test author ran complete tooling coverage: 2,250/2,250 tests
  across 35 files, with lines 96.28% (2,725/2,830) and branches 92.98%
  (1,802/1,938). Before/after source hashes matched. Coverage summary SHA-256:
  `be9a55c7ff46fb887e2c31265335aae88f4ee167cad63b06b53b6f814d725c19`.
- The independent verifier reran all 66 focused cases and native Codex
  integration, including cached bytes, both real local API responses, and both
  failures after API shutdown. Fresh native results SHA-256:
  `c8f8f53a92e66ddfdf33a82b6537fed24de82217725f15ffe592a2dc1a0ecaf9`.
- Both roles reviewed the containment correction. The launcher SHA-256 was
  `36cf15e0571aedd2d57c45ba4515dca3919ae4383af6b1e68a108c6c0e7aa456`;
  setup helper SHA-256 was
  `741c87e4caf4667e893c692d6321990f1cf07db5cb43d7833e38cc921112a1b4`.
- A fresh configured copy passed the plugin validator, and the skill passed
  its validator.

Required repository gates remain separate from these checks and must be
recorded against the resulting candidate.

## Fixed checkout binding

The next unchanged commit gate, `6fc773ab-efa6-4cfb-9973-3b1f55b99793`,
rejected two remaining findings at filesystem lookups preceding containment.
No commit was created and the failure remains preserved. The independent test
author then recorded three executed behavioral failures: environment retargeting
despite a packaged binding, an unconfigured source accepting a checkout, and a
setup helper accepting another checkout.

The configured plugin now reads a fixed package-local `checkout.json` and rejects
an environment root that does not match it before resolving that root on disk.
Setup derives its own checkout from its module location, rejects a different
repository argument, and emits that canonical root into both binding and MCP
configuration. Users select another trusted checkout by running its own helper.
Setup also checks lexical output containment before canonicalizing its parent;
canonical child and output protections remain. This introduces an independent
checkout authority rather than a prefix derived from unchecked input. There is
no runtime binding override, security suppression, or baseline change.

The earlier containment results describe the preceding candidate. Fresh binding
focused tests passed 79/79 cases, including native malformed/missing binding
checks and a mismatch assertion that performs zero realpath calls. Copied-helper
tests invoke their own valid checkout so metadata and output guards are reached.
Coverage, final native integration, and repository gates are recorded separately.

## Review boundary

Initial independent source, test, scope, and coverage-configuration review was
superseded by the commit gate failure and containment correction above.
Native integration and unit coverage are distinct:
subprocess execution supplements worker coverage rather than silently increasing
its denominator. Required repository gates and subsequent hosted results must be
recorded against their exact candidate. No plugin was published to a public
directory or installed into the user's normal Codex profile.
