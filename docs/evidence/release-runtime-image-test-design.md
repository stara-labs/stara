# Independent Runtime Image Regression Design

Ownership: independent author owns only this document and
`tooling/tests/release-runtime-image.contract.test.mjs`. Parent implements the
Dockerfiles/runtime pins after red. Mencius separately owns existing infra-image
test pin constants. No existing tests, UI/API source, Dockerfiles, scanner policy
or private files are edited here. Branch `feat/secure-releases`, base
`319c9bf8fb7c4bbc852497e5742f801f9015aec1`.

## Approved Change

Parent reports actual Trivy HIGH/CRITICAL red counts API 66 and web 69, attributed
to unused Debian runtime packages and bundled API npm. This author did not run
those scans or independently inspect their reports. The approved response is
smaller same-version runtime bases, not CVE suppression or package-database deletion.

- API/control final stage: `node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a`.
- Web/gateway: `nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce`.
- Preserve every builder/dependency/GH stage's existing Node 24.16.0 Bookworm pin.
- Preserve runtime non-root users, control entrypoint and checksum-verified GH 2.100.0 binary/license.

The eight original static cases enforce those pins and gateway agreement, require a small
explicit runtime cleanup, and disallow package-inventory paths/CVE suppressions in
the recipes. They deliberately do not implement a general Dockerfile/shell parser.
Line continuations follow the existing repository test convention; Compose uses
the existing YAML parser. Only repository files are read, with no imports of the
release executor, subprocesses, network calls, builds or scanner execution.

Parent implementation interface for each Node final stage, before `USER node`:

```dockerfile
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
```

Order and line continuation are flexible; the Yarn tree may instead name its
exact version. These are the only six deletion targets, in a single plain RUN.
Do not remove `/lib/apk`, dpkg/rpm inventory, application dependencies, Node, or
other tools. Do not install alternate packages or add new shell indirection to
evade inspection. Any necessary runtime operation outside this narrow approved
change needs explicit review, not a test weakening. The separately approved exact
OpenSSL repair below is now the sole additional RUN exception. No dependency was
added to the test tooling.

## Real Image Follow-Up

Static green proves configuration only, not runtime compatibility, absence of
packages, CVE clearance, provenance or application behavior. Parent must rebuild
fresh final images and retain image IDs, Dockerfile hashes, scan reports and
scanner database metadata in ignored artifacts. Reuse the existing actual-image
journey so health, runtime config, gateway and all browser contexts still execute.
The Bookworm-to-Alpine dependency copy and official GH executable must be tested
on the actual Linux amd64 image; source inspection cannot prove libc compatibility.

Recommended existing application commands (not executed by this author), using
one new owned run ID and the pinned local Node/pnpm toolchain:

```powershell
$env:STARA_RELEASE_RUN_ID = 'lean-runtime-unique-run'
node tooling/release/cli.mjs images
node tooling/release/cli.mjs safety
```

Use a genuinely unused run ID, retain both exit statuses, and never reuse an old
result pointer. This builds API/web, starts its owned gateway/browser journey and
performs the existing pinned Trivy scans. A failed image scan remains a failure.
Do not weaken the existing HIGH/CRITICAL or secret-result validator, filter out
unfixed vulnerabilities, delete scanner evidence, or count an exit-zero raw report
command as a policy pass.

Additional control-image build recommendation, on the Linux Docker engine:

```text
docker build --platform linux/amd64 --file tooling/release/Dockerfile --iidfile .artifacts/CONTROL_RUN/control.iid --tag stara-control:CONTROL_RUN .
docker run --rm --network none --entrypoint node CONTROL_IMAGE_ID --version
docker run --rm --network none --entrypoint gh CONTROL_IMAGE_ID --version
docker image save --output .artifacts/CONTROL_RUN/control.tar CONTROL_IMAGE_ID
```

Create a new owned ignored `CONTROL_RUN` directory first; substitute only its
recorded immutable image ID for `CONTROL_IMAGE_ID`. Do not invoke the default
execute entrypoint. Inspect both Node runtime images with an explicit `sh`
entrypoint and network disabled: `id -u` is nonzero, `node --version` is v24.16.0,
`test -s /lib/apk/db/installed` succeeds, and each npm/Yarn tree and launcher is
absent (check both `test ! -e` and `test ! -L` for dangling symlinks). NGINX must
still start unprivileged, and the gateway must use the same reviewed base.

Scan the saved control tar using the same pinned scanner as the application
pipeline, with an owned read-only evidence mount, no Docker socket, and no CVE
ignore settings:

```text
docker run --rm --mount type=bind,source=ABSOLUTE_CONTROL_RUN,target=/evidence,readonly aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969 image --input /evidence/control.tar --scanners vuln,secret --format json --exit-code 0
```

Capture stdout as private/ignored JSON and require zero HIGH/CRITICAL findings
and zero secrets through the existing report-validation rules. Do not publish
raw operational metadata. The scanner may need network for its database; this
recommendation does not authorize cloud deployment or registry publication.

## Red Evidence

RED READY. Parent may implement the narrowly scoped runtime Dockerfile changes
against these independent tests; Mencius may adjust only his existing pin
constants. No other actor's files were edited by this author.

```text
node ../node_modules/vitest/vitest.mjs run tests/release-runtime-image.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-runtime-image-test-author/red/results.json
```

Result: 8 collected, 2 passed, 6 failed, zero skipped, exit 1. Observed source
contract failures are the three existing Debian runtime bases, two missing
Node-runtime cleanup commands and old Compose gateway pin. Package-inventory/
suppression and official GH preservation cases pass. This is real file-contract
red, not a missing-module failure or a new vulnerability scan. The pipeline's
gateway constant was already Alpine when inspected; Compose was not yet aligned.

Frozen test SHA-256:
`473332083c6502087a36e19d371968921e6ce98a614e7a88d7b39ba9c71300b5`.
Ignored report SHA-256:
`368e28c090021a26f49ccd6c72495b9144e0dd291bdf05770cce515fdb622522`.

Source hashes matched before and after the red run:

- API Dockerfile: `49946913768d55cf85c54de85e173529d37e617eb57a7a504f37677ab259b8ea`.
- Web Dockerfile: `15c8cf1c944e3c3ac40b375e0b114aeb18bd6f12d6be58f67d28448408158095`.
- Control Dockerfile: `67e286a7f26a60de45419e3306b0ad38e37ea308152fe358d73c200817ab36cb`.
- Release Compose: `563bcba45f8afbb0d6fa091e422bf47c2ed4abb0bd24d34eea5611e9292ac5fc`.
- Pipeline: `82369c7ef15ab904e4297c87f0ed6da9891080311b9e5df32c0747cbaa80d618`.

Scoped ESLint, Secretlint, formatting and diff checks pass. Missing files and
malformed stage declarations fail, not skip. This selected suite does not
establish complete tooling coverage, real image startup or CVE clearance. No
Docker resources were created. Real-image recommendations above are unexecuted
follow-up, not an acceptance claim.

Handoff conclusion: More journey evidence required.

## Exact OpenSSL Repair Red

RED READY for the parent-approved targeted package repair, after independent
inspection of the actual run `local-release-20260911-d` scan files. API contains
exactly two HIGH findings for CVE-2026-14456: `libcrypto3` and `libssl3`, installed
`3.5.7-r0`, fixed version reported as `3.5.8-r0`, Alpine 3.24.1. Web has zero
HIGH/CRITICAL findings. API, web, metadata and public-files reports all contain
zero secrets. This inspects existing results; it is not a new scanner execution
or independent confirmation that repository packages are currently available.
Parent owns official package-availability verification before implementation.

Inspected report SHA-256, all under
`.artifacts/release-pipeline/local-release-20260911-d/`:

- `api-image-scan.json`: `c68f897e09aea8da581473acd697aba24ac79fcc4afe63cce1e71702badd7b80`.
- `web-image-scan.json`: `93fef7b38182e28cf2111d59a7a0c316eb2507724e9aa2cbc749934ac9d38a31`.
- `metadata-scan.json`: `9e50c882313d434e6426816ede408db27de0cc6797e7baa5ed6f440fcf023799`.
- `public-files-scan.json`: `685caa368cdfcf1ec35affcdff839a8ed1bd03f332358667b5a194993a3ef165`.

The saved API tar's `index.json` references the built/inspected OCI index
`sha256:270ec2caef5c4bd470bea8f2e74b39986954a3270a72148df0d1dd91da7198f7`;
its `manifest.json` config reference matches Trivy's ImageID
`sha256:a9d46fd9c6474d2320b750eaf31bd00433b98aeb707d0428ab44ef7101c93a7a`.
These are different identity types, not evidence of a differing image by direct
string comparison. Only those tar metadata entries were read; no extraction,
container startup or full independent archive/cryptographic verification occurred.

Required implementation: a separate exact instruction in API and control final
Alpine runtime stages, before `USER node`, with no corresponding builder/web
change:

```dockerfile
RUN apk add --no-cache libcrypto3=3.5.8-r0 libssl3=3.5.8-r0
```

Two new cases require that exact command once per final runtime and no apk
commands in any builder. All eight previous cases remain. Their single-cleanup
guard now excludes only the exact approved repair line, not arbitrary RUNs,
installs or upgrades. Package removal targets, inventory/suppression guards,
base/version pins, users, gateway agreement and official GH checks are unchanged.
No upgrade-all, unpinned package, additional package, shell chaining, ignored CVE
or deleted inventory is admitted by this repair contract.

The unchanged eight-case suite first passed against the Alpine implementation:
`.artifacts/release-runtime-image-test-author/alpine-before-repair/results.json`,
SHA-256 `aca60729f0eee7cae9d4e28f43aa46d3db77b9dc6c89041089f7b0c9bc141b2b`.
After the minimal author update:

```text
node ../node_modules/vitest/vitest.mjs run tests/release-runtime-image.contract.test.mjs --reporter=json --outputFile=../.artifacts/release-runtime-image-test-author/openssl-repair-red/results.json
```

10 collected, 8 passed, 2 failed, zero skipped, exit 1. Both new cases fail because
the exact repair instruction is absent. This preserves all eight previous green
guards and captures red before parent Dockerfile changes.

- Test SHA-256: `1b60fd2e64850cc1df35b617aab8cc45875c041695f6f52324e99072a3be27c6`.
- Report SHA-256: `b21a8fea20c726a70e19a26c872217631148260f060c7ce68707db819e885c11`.
- API Dockerfile at red: `8f8877229fbe1c54b3cb8cdb4372cf6b2447016be6458490d6cf777e32be1c7a`.
- Control Dockerfile at red: `d8b404614693143d23ec057cbcbd8f4943b9ca75759bab4918999bde8df06ed9`.

Mencius handoff: no new base-pin or COPY-source allowance is needed; only API and
control runtime gain the exact separately reviewed RUN above. Do not broaden
existing infra guards for generic apk operations. Parent relay is required because
multi-agent send_input is unavailable in this author session.

Scoped ESLint, Secretlint, formatting and diff checks pass. Only this document and
the independent runtime-image test changed. Next real-image verification must
confirm both installed versions through preserved apk inventory, rerun all image
and secret scans plus the existing application journey, and exercise control
Node/GH startup. No new package availability, CVE clearance or release acceptance
is claimed by this static red.

Handoff conclusion: More journey evidence required.

## OpenSSL Green and Activation Block

The author independently reran the same frozen runtime-image suite after the
parent applied the exact repair: 10/10 passed, zero failed/skipped, exit 0.
No source or tests changed in this ledger update. Parent separately reports the
combined runtime/infra 154/154 pass; this author did not repeat that broader run.

- Test SHA-256 remains `1b60fd2e64850cc1df35b617aab8cc45875c041695f6f52324e99072a3be27c6`.
- API Dockerfile SHA-256: `04d9470dee058a113849f23e8b6290958d07a070f8b253f2aace2bb3cd797c9e`.
- Control Dockerfile SHA-256: `a762ed9642e063ade944d7358d7f5ef2aeb3ce150396bee0defa0fe373d21939`.
- Report `.artifacts/release-runtime-image-test-author/openssl-repair-green/results.json` SHA-256: `a1961efaed627a28d00ffe412a27aa2a4c7030505a4ed71899138d7f2bc1dc21`.

Source/test hashes matched before and after execution. Scoped formatting,
Secretlint and diff checks passed. All original and OpenSSL red evidence remains
retained. Complete validation is parent-owned and was still underway at handoff.

The author inspected the actual `local-release-20260911-e` application reports
and matched their SHA-256 values to `verified.json`. Browser statistics are 69
expected, zero unexpected, skipped or flaky. API/web image scans each contain zero
HIGH/CRITICAL vulnerabilities; all four reports contain zero secrets. Parent
reports CLI images/safety passed. The receipt records mode working-tree and base
source `319c9bf8fb7c4bbc852497e5742f801f9015aec1`; this is not merged-main,
publishable CI or live staging acceptance. Raw reports remain ignored artifacts.

Hashes under `.artifacts/release-pipeline/local-release-20260911-e/`:

- `api-image-scan.json`: `bb607210962a5e3e63777614fa23196a11c2f795ba5f0ce8d31ea7132c8bbaf6`.
- `web-image-scan.json`: `f8b69be3a73bb191213fb54f12d2e65ee6fe0f12b49a946e4a6a056acdbaccf1`.
- `metadata-scan.json`: `f6dfcbcc3023dca497af970d11c95fd8b9f9ff3f43f4e0fc73990c215a94b1fe`.
- `public-files-scan.json`: `03f76034fa26cb4254261bc92f6169747b904dffeda1c5723332d4a383a7d18c`.
- `browser.json`: `8ed658c1ed0531a1f4cf8f7cd81919af69b68ed1012489bad221da56caab5ee5`.
- `verified.json`: `cbf3b8c88a0a8430dd721c05654173c16e4965f1808923951c6bd23326db396e`.
- `result.json`: `7d1909dcfbca32f808ade685c9999ce3702c98492d3abf0670331224e2c3938e`.

Parent reports the control's non-root offline Node/GH startup, licensing and
configuration denial checks pass. The author independently inspected its actual
scan `.artifacts/release-control-reviewed-scan.json`, SHA-256
`9fffef49f490021739d93bc696d509a06b821644e2f237a81122bb61f48fea74`.
It has zero OS HIGH/CRITICAL findings and zero secrets, but `usr/local/bin/gh`
contains two HIGH findings: CVE-2026-56864 and CVE-2026-56865 in
`golang.org/x/mod` v0.39.0, reported fixed in 0.40.0. The official GH 2.100.0
binary therefore prevents a clean control-image security gate.

Activation remains blocked. Parent reports no newer official GH release; that
availability statement was not independently researched here. There is no CVE
waiver, ignore-file change, inventory deletion, threshold reduction or implicit
approval to replace/rebuild the pinned binary. A separately reviewed remediation
and fresh actual control-image scan are required. Application scan green and
offline control startup do not waive this block. No new containers, live calls,
source changes or test expansion were performed for this ledger append.

Handoff conclusion: Revision required (control-image security blocks activation).
