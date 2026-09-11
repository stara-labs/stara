# Attestation Dependency Regression

Independent author scope: only
`tooling/tests/release-attestation-dependencies.contract.test.mjs` and this ledger.
The parent owns dependency/lockfile implementation; a distinct verifier follows.
No prior protected test, production source, dependency or acceptance floor changes.

## Contract

[CVE-2026-48758](https://github.com/sigstore/sigstore-js/security/advisories/GHSA-jfc7-64v2-mr8c)
affects Sigstore core through 3.2.0. Its PAE conversion truncates Unicode payload
types and uses character rather than UTF-8 byte length. The
[upstream correction](https://github.com/sigstore/sigstore-js/commit/b5aa4f1f8d2db0a9dfa6430fb114d9c2f1c304f7)
binds the full UTF-8 type bytes and their byte count.

Tests resolve the real installed `@sigstore/sign` from `@actions/attest`, then its
own `@sigstore/core`, rather than testing an unrelated hoisted copy. They require
core 3.2.1 or newer and exercise actual PAE bytes and real Ed25519 signatures:
the ASCII known vector remains exact, one/all-letter Unicode substitutions change
bytes and invalidate signatures, and UTF-8 type length preserves binary payloads.

The compatibility scenario executes actual `attestProvenance`, signed synthetic
OIDC JWT verification, provenance construction, the real DSSE bundle builder and
SDK bundle serialization. Only OIDC HTTP responses, the Fulcio signer boundary
and Rekor witness boundary are substituted. The signer uses a deliberately
predictable synthetic key and actual Node cryptography, not a canned signature.
The included self-signed public certificate is test material, not a trust anchor.
The resulting ASCII signature must verify; mutation of that actual SDK envelope's
payload type must fail verification. Failed witness IO must reject.

Network sockets and global fetch are blocked; runner OIDC environment values are
replaced and restored. `skipWrite:true` prevents upload. This does not exercise live
Fulcio certificate issuance, Rekor inclusion, certificate trust, GitHub upload,
OIDC authority or IAM. Empty synthetic witness evidence is never release evidence.
The compatibility claim is SDK construction/serialization and local cryptographic
type binding, not remote-service compatibility or release acceptance.

## Candidate Graph

Observed vulnerable chain: `@actions/attest@3.2.0 -> @sigstore/sign@3.1.0 ->
@sigstore/core@2.0.0`; the SDK also resolves `@sigstore/bundle@3.1.0`.

Fresh npm registry metadata confirms `@sigstore/sign@4.1.1` is the latest stable
4-series patch. It declares core `^3.2.0`, bundle `^4.0.0`, protobuf `^0.5.0`,
and Node `^20.17.0 || >=22.9.0`. Core 3.2.1 has the same Node requirement.
The candidate is retaining attest 3.2.0, narrowly overriding its signer to 4.1.1
and resolving that signer's core to 3.2.1. Tests resolve the actual consumer graph
without pinning the SDK or signer version; the patched-core floor remains mandatory.
This intentionally crosses the SDK's declared signer-major range
and requires the unchanged compatibility test to pass after parent implementation.
It does not require latest sign 5 or a blanket replacement of every Sigstore package.
Do not claim compatibility from package metadata alone or force core 3 beneath
sign 3's declared core-2 range without equivalent evidence.

## Captured Red

`attestation-dependencies-initial-red` executes ten cases: three pass, seven fail,
zero skipped. Six failures demonstrate incorrect PAE bytes or accepted substituted
signatures, including mutation of the real SDK-produced envelope; the seventh is
the installed vulnerable-version floor. The passing cases preserve the ASCII
known vector, actual offline SDK construction/signature verification, and failed
witness propagation. This is behavioral red, not a missing-export fixture failure.

Ignored evidence is under `.artifacts/release-test-author/`:

- `attestation-dependencies-initial-red`: exact command, result, source/test hashes
  and private output; all credentials in this fixture are synthetic.
- `attestation-installed-graph-red`: resolved package metadata, lock/workspace
  identities and actual SDK/signer/core/bundle source hashes.
- `attestation-dependencies-frozen-red`: final version-agnostic test rerun; the
  initial red remains retained separately. Only the unnecessary exact SDK-version
  assertion changed; cryptographic and SDK behavior requirements are unchanged.

Runtime was Node 24.16.0 at `C:/nvm4w/nodejs/node.exe`. No production dependency
installation, cloud request, full coverage, commit, push, merge or deployment was
performed by this author. Frozen tests must run unchanged after the parent's patch;
green and independent verification remain subsequent evidence.
