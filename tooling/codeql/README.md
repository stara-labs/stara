# Local CodeQL commit check

`pnpm check:commit` runs real CodeQL analysis on the isolated Git index for
source/control changes. Documentation-only commits retain the existing fast
path. An unstaged repair cannot make staged vulnerable code pass. The scanner
never uploads source, databases, or SARIF results.

The pinned analyzer is CodeQL CLI **2.27.0**, with the bundled
`codeql/javascript-queries@2.4.5` and `codeql/actions-queries@0.6.35`
security-extended suites and both `remote` and `local` threat models. These
match GitHub's analysis of PR #8 on 2026-09-11. GitHub default setup updates
independently; upgrade these local pins through review when the hosted analyzer
changes. The local scan supplements GitHub's required CodeQL check.

## Install once

Download the appropriate bundle from the official
[CodeQL 2.27.0 release](https://github.com/github/codeql-action/releases/tag/codeql-bundle-v2.27.0)
and verify its published SHA-256 before extracting it. The Windows tar.gz used
for this implementation is `codeql-bundle-win64.tar.gz`, SHA-256
`c472bbd03b0f70a468f5b77b16e26bd8248d5c570fca120605eedcdcc3abd3c0`.
The archive is approximately 695 MB; extracted tools and scan databases require
additional disk space. The bundle contains the query packs, so scanning does
not require downloading packages.

Either install outside a Node project and set `STARA_CODEQL_CLI` to the absolute
path of `codeql.exe` (Windows) or `codeql` (Linux), or extract into the default
repository-local directory:

```text
.artifacts/tools/codeql-2.27.0/codeql/codeql.exe
.artifacts/tools/codeql-2.27.0/codeql/codeql
```

For that repository-local installation, create
`.artifacts/tools/codeql-2.27.0/package.json` with
`{"private":true,"type":"commonjs"}`. This package boundary prevents Stara's
`"type":"module"` from changing how Node runs the bundle's CommonJS extractor.
Do not modify the bundled extractor files. All installed tooling remains ignored.

The executable path is carried into the isolated commit snapshot; dependencies
and source still come from the staged index. The executable and bundled queries
are trusted local toolchain inputs, like Node and pnpm. An absent executable or
wrong CLI version blocks the check with installation guidance.

On Windows, CodeQL's official Actions extractor launches Windows PowerShell.
Use a terminal whose approved execution policy permits that installed script.
A process-only setting, where organizational policy permits it, is:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned
```

Run Git from that same terminal. The hook does not change execution policy or
bypass an organizational policy. A prohibited extractor fails the commit.

## Commands and results

```sh
pnpm security:codeql
pnpm check:commit
```

The first command scans the current working source; the second scans the
isolated staged source and is the pre-commit hook. Both copy authored files to a
fresh temporary source tree, excluding dependencies and generated artifacts,
then create fresh JavaScript/TypeScript and Actions databases. Missing tools,
failed extraction/queries, missing or malformed reports, and new warning/error
findings fail the check. A successful CLI exit alone cannot make findings pass.

Each analyzer subprocess has a five-minute bound; the enclosing commit scanner
has a ten-minute bound. Each scan uses four threads and a 4 GB query memory
budget. Full analysis adds noticeable time to a source commit. Databases are
temporary; SARIF and summary reports are retained under
`.artifacts/gates/<run-id>/codeql/`. The commit gate retains its sanitized copy
under `.artifacts/gates/<run-id>/snapshot/codeql/` after snapshot cleanup.

## Existing findings

`baseline.json` records 34 inherited finding identities from `main` commit
`189a066cacd1559a7640bb200bc2c8ba18330ef9`: 32 JavaScript findings and two
Actions findings. Source analyses are GitHub analysis IDs `1765061391` and
`1765060694`. This is a regression baseline for review, not a claim that those
findings are resolved or newly accepted risks. It contains no MCP SSRF exception.

An allowance matches the exact rule, normalized repository-relative path,
CodeQL line fingerprint, and occurrence count. Different rules/paths,
fingerprints, and extra occurrences are new findings. SARIF suppression markers
do not grant exceptions. Inherited findings remain counted in the summary.

CodeQL's line fingerprint identifies the reported location; it does not prove
that every upstream data flow to an unchanged location remains identical. This
baseline shares that limitation and does not replace security review. Changes
to the analyzer pins, suites, baseline, parser, or hook require independent test
authoring and verification under `AGENTS.md`; never add an allowance merely to
make a failing candidate pass.

See [GitHub's CLI analysis documentation](https://docs.github.com/en/code-security/tutorials/customize-code-scanning/analyze-code)
for the database and SARIF command model.
