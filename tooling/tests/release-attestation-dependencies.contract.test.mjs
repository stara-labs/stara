import { createPrivateKey, createPublicKey, sign, verify, X509Certificate } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Socket } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Resolve from each actual consumer, not a hoisted package or copied PAE implementation.
async function installedPackage(name, consumer) {
  for (const directory of createRequire(consumer).resolve.paths(name) ?? []) {
    try {
      const root = await realpath(join(directory, name));
      const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      if (metadata.name !== name) throw new Error('Unexpected installed package identity');
      const entry = metadata.exports?.['.']?.import ?? metadata.main ?? 'index.js';
      return { root, metadata, entry: join(root, entry) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Required attestation dependency is missing: ${name}`);
}

let attestPackage;
let signPackage;
let corePackage;
let signer;
let core;
let HttpClient;
beforeAll(async () => {
  attestPackage = await installedPackage('@actions/attest', import.meta.url);
  signPackage = await installedPackage('@sigstore/sign', attestPackage.entry);
  corePackage = await installedPackage('@sigstore/core', signPackage.entry);
  signer = createRequire(attestPackage.entry)('@sigstore/sign');
  core = createRequire(signPackage.entry)('@sigstore/core');
  const http = await installedPackage('@actions/http-client', attestPackage.entry);
  ({ HttpClient } = await import(/* @vite-ignore */ pathToFileURL(http.entry).href));
});

beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('Offline attestation test forbids network connections');
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('Offline attestation test forbids network fetch');
    }),
  );
  vi.stubEnv('GITHUB_EVENT_PATH', '');
  vi.stubEnv('GITHUB_SERVER_URL', 'https://github.com');
  vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', 'https://synthetic-oidc.invalid/token?fixture=1');
  vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'synthetic-offline-request-token');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Public, deliberately predictable test key. Never a credential or trust anchor.
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, 1)]),
  format: 'der',
  type: 'pkcs8',
});
const publicKey = createPublicKey(privateKey);
const certificate = `-----BEGIN CERTIFICATE-----
MIIBbTCCAR+gAwIBAgIUGtfO5Ajqe30tvaF5wkF2wRHTpLwwBQYDK2VwMCwxKjAo
BgNVBAMMIVNUQVJBIHN5bnRoZXRpYyBvZmZsaW5lIHRlc3Qgb25seTAeFw0yNjA5
MTEwMzU4MzdaFw0zNjA5MDgwMzU4MzdaMCwxKjAoBgNVBAMMIVNUQVJBIHN5bnRo
ZXRpYyBvZmZsaW5lIHRlc3Qgb25seTAqMAUGAytlcAMhAIqI4910CfGV/VLbLTy6
XXLKZwm/HZQSG/N0iAG0D29co1MwUTAdBgNVHQ4EFgQUmtGeDxbu9xTLkMbxldvO
ZulFgPkwHwYDVR0jBBgwFoAUmtGeDxbu9xTLkMbxldvOZulFgPkwDwYDVR0TAQH/
BAUwAwEB/zAFBgMrZXADQQALZpuYYyI/d+Dq97E+blCfpoN0E1lalIge2ccfO3nu
AP43PYfrpHt1SH0NtX5TInEzY3mOIy5Y+MXclAR11WkN
-----END CERTIFICATE-----`;
const payload = Buffer.from('hello world');
const payloadType = 'text/plain';
const substitutions = [
  ['one code point', '\u0174ext/plain'],
  ['all letters', '\u0174\u0165\u0178\u0174/\u0170\u016c\u0161\u0169\u016e'],
];
const sourceSha = '1'.repeat(40);
const imageDigest = '2'.repeat(64);

async function offlineSDK() {
  const claims = {
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'nobody',
    sub: 'synthetic-offline-subject',
    exp: Math.floor(Date.now() / 1000) + 300,
    ref: 'refs/heads/main',
    sha: sourceSha,
    repository: 'stara-labs/stara',
    event_name: 'push',
    job_workflow_ref: 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main',
    workflow_ref: 'stara-labs/stara/.github/workflows/release.yml@refs/heads/main',
    repository_id: '1363262992',
    repository_owner_id: '293455507',
    runner_environment: 'github-hosted',
    run_id: '101',
    run_attempt: '2',
  };
  const encoded = [{ alg: 'EdDSA', kid: 'synthetic-offline-key' }, claims]
    .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
    .join('.');
  const token = `${encoded}.${sign(null, Buffer.from(encoded), privateKey).toString('base64url')}`;
  const remote = vi.spyOn(HttpClient.prototype, 'getJson').mockImplementation(async (address) => {
    const url = new URL(address);
    let result;
    if (url.origin === 'https://synthetic-oidc.invalid') {
      expect(url.searchParams.get('audience')).toBe('nobody');
      result = { value: token };
    } else if (address === `${claims.iss}/.well-known/openid-configuration`) {
      result = { jwks_uri: `${claims.iss}/.well-known/jwks` };
    } else if (address === `${claims.iss}/.well-known/jwks`) {
      result = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'synthetic-offline-key' }] };
    } else throw new Error('Unexpected offline OIDC request');
    return { statusCode: 200, headers: {}, result };
  });
  // Substitute remote trust services, retaining real SDK statement construction,
  // DSSE PAE, bundle building/serialization, JWT verification and Ed25519 signatures.
  const signing = vi
    .spyOn(signer.FulcioSigner.prototype, 'sign')
    .mockImplementation(async (data) => ({
      signature: sign(null, data, privateKey),
      key: { $case: 'x509Certificate', certificate },
    }));
  const witness = vi
    .spyOn(signer.RekorWitness.prototype, 'testify')
    .mockResolvedValue({ tlogEntries: [] });
  const sdk = await import(/* @vite-ignore */ pathToFileURL(attestPackage.entry).href);
  return {
    remote,
    signing,
    witness,
    attest: () =>
      sdk.attestProvenance({
        subjects: [{ name: 'stara/web', digest: { sha256: imageDigest } }],
        token: 'synthetic-unused-upload-token',
        sigstore: 'public-good',
        skipWrite: true,
      }),
  };
}

describe('CVE-2026-48758: installed attestation dependency type binding', () => {
  it('resolves the maintained attestation SDK through its own patched core dependency', () => {
    expect(attestPackage.metadata.name).toBe('@actions/attest');
    expect(signPackage.metadata.name).toBe('@sigstore/sign');
    const [major, minor, patch] = corePackage.metadata.version.split('.').map(Number);
    expect(major > 3 || (major === 3 && (minor > 2 || (minor === 2 && patch >= 1)))).toBe(true);
    expect(vi.isMockFunction(core.dsse.preAuthEncoding)).toBe(false);
    expect(vi.isMockFunction(signer.DSSEBundleBuilder.prototype.create)).toBe(false);
  });

  it('preserves the DSSE ASCII known vector exactly', () => {
    expect(core.dsse.preAuthEncoding(payloadType, payload)).toEqual(
      Buffer.from('DSSEv1 10 text/plain 11 hello world', 'ascii'),
    );
  });

  it.each(substitutions)('changes PAE bytes after Unicode substitution of %s', (_name, mutant) => {
    expect(core.dsse.preAuthEncoding(mutant, payload)).not.toEqual(
      core.dsse.preAuthEncoding(payloadType, payload),
    );
  });

  it.each(substitutions)(
    'rejects an original real signature after substitution of %s',
    (_name, mutant) => {
      const original = core.dsse.preAuthEncoding(payloadType, payload);
      const signature = sign(null, original, privateKey);
      expect(verify(null, original, publicKey, signature)).toBe(true);
      expect(verify(null, core.dsse.preAuthEncoding(mutant, payload), publicKey, signature)).toBe(
        false,
      );
    },
  );

  it('encodes Unicode payloadType with its UTF-8 byte length, preserving binary payload bytes', () => {
    const binary = Buffer.from([0, 255, 195, 169]);
    expect(core.dsse.preAuthEncoding(substitutions[1][1], binary)).toEqual(
      Buffer.concat([Buffer.from(`DSSEv1 19 ${substitutions[1][1]} 4 `, 'utf8'), binary]),
    );
  });

  it('runs actual attestProvenance and bundle serialization offline with a valid synthetic signature', async () => {
    const f = await offlineSDK();
    const result = await f.attest();
    expect(result.bundle.mediaType).toBe('application/vnd.dev.sigstore.bundle.v0.3+json');
    const envelope = result.bundle.dsseEnvelope;
    expect(envelope.payloadType).toBe('application/vnd.in-toto+json');
    const body = Buffer.from(envelope.payload, 'base64');
    const statement = JSON.parse(body.toString('utf8'));
    expect(statement.subject).toEqual([{ name: 'stara/web', digest: { sha256: imageDigest } }]);
    expect(statement.predicateType).toBe('https://slsa.dev/provenance/v1');
    expect(statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit).toBe(
      sourceSha,
    );
    expect(statement.predicate.runDetails.metadata.invocationId).toBe(
      'https://github.com/stara-labs/stara/actions/runs/101/attempts/2',
    );
    const pae = core.dsse.preAuthEncoding(envelope.payloadType, body);
    expect(f.signing).toHaveBeenCalledExactlyOnceWith(pae);
    expect(f.witness).toHaveBeenCalledTimes(1);
    expect(f.remote).toHaveBeenCalledTimes(3);
    expect(envelope.signatures).toHaveLength(1);
    expect(
      verify(
        null,
        pae,
        new X509Certificate(result.certificate).publicKey,
        Buffer.from(envelope.signatures[0].sig, 'base64'),
      ),
    ).toBe(true);
    expect(result.attestationID).toBeUndefined();
    expect(Socket.prototype.connect).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects payloadType mutation on the actual SDK-generated envelope', async () => {
    const f = await offlineSDK();
    const result = await f.attest();
    const envelope = result.bundle.dsseEnvelope;
    const body = Buffer.from(envelope.payload, 'base64');
    const signature = Buffer.from(envelope.signatures[0].sig, 'base64');
    expect(
      verify(null, core.dsse.preAuthEncoding(envelope.payloadType, body), publicKey, signature),
    ).toBe(true);
    const mutant = `\u0161${envelope.payloadType.slice(1)}`;
    expect(verify(null, core.dsse.preAuthEncoding(mutant, body), publicKey, signature)).toBe(false);
  });

  it('propagates failed witness IO instead of manufacturing successful SDK evidence', async () => {
    const f = await offlineSDK();
    f.witness.mockRejectedValue(new Error('Synthetic offline witness denial'));
    await expect(f.attest()).rejects.toThrow('Synthetic offline witness denial');
    expect(f.signing).toHaveBeenCalledTimes(1);
    expect(Socket.prototype.connect).not.toHaveBeenCalled();
  });
});
