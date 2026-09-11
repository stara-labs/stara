import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let createExecutor;
beforeAll(async () => {
  ({ createExecutor } = await import(
    /* @vite-ignore */ new URL('../release/executor.mjs', import.meta.url).href
  ));
});
const owned = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    owned.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const minute = 60_000;
const start = 1_800_000_000_000;
const sha = '1'.repeat(40);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const copy = (value) => structuredClone(value);
const failure = (code) => Object.assign(new Error('synthetic-private-adapter-canary'), { code });
const policy = {
  repositoryId: '123456',
  workflows: {
    scaffold: {
      workflowRef: 'synthetic/stara/.github/workflows/checks.yml@refs/heads/main',
      jobs: ['Required scaffold checks'],
    },
    images: {
      workflowRef: 'synthetic/stara/.github/workflows/images.yml@refs/heads/main',
      jobs: ['verify-web', 'verify-api'],
    },
    codeql: {
      workflowRef: 'dynamic/github-code-scanning/codeql',
      jobs: ['Analyze (javascript-typescript)', 'Analyze (actions)'],
    },
  },
  provenanceWorkflowRef: 'synthetic/stara/.github/workflows/images.yml@refs/heads/main',
  requiredTargets: ['@stara/web', '@stara/ui', '@stara/api', '@stara/tooling'],
};
function manifest(sourceSha = sha) {
  return {
    schemaVersion: 1,
    sourceSha,
    repositoryId: policy.repositoryId,
    images: {
      web: { digest: `sha256:${'2'.repeat(64)}`, attestationSha256: '3'.repeat(64) },
      api: { digest: `sha256:${'4'.repeat(64)}`, attestationSha256: '5'.repeat(64) },
    },
    runs: {
      scaffold: { id: '101', attempt: 1 },
      images: { id: '102', attempt: 1 },
      codeql: { id: '103', attempt: 2 },
    },
  };
}
function evidence(candidate) {
  return {
    repositoryId: policy.repositoryId,
    sourceSha: candidate.sourceSha,
    currentMainSha: candidate.sourceSha,
    runs: Object.entries(candidate.runs).map(([kind, run]) => ({
      ...run,
      workflowRef: policy.workflows[kind].workflowRef,
      headSha: candidate.sourceSha,
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      jobs: policy.workflows[kind].jobs.map((name) => ({
        name,
        status: 'completed',
        conclusion: 'success',
      })),
    })),
    coverage: policy.requiredTargets.map((target) => ({
      target,
      sourceSha: candidate.sourceSha,
      complete: true,
      lines: 90,
      branches: 85,
    })),
  };
}

// A serialized injected-store simulation persists JSON to disk. It is not proof
// of Cloud Storage generation preconditions, IAM, or cross-process atomicity.
async function harness(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'stara-release-author-'));
  owned.push(directory);
  const queues = new Map();
  const writes = [];
  const transactions = [];
  const read = async (target) => {
    if (!/^[a-z-]+$/.test(target)) throw new Error('Invalid synthetic target');
    try {
      return JSON.parse(await readFile(join(directory, `${target}.json`), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return { lock: null, receipts: {} };
      throw error;
    }
  };
  const store = {
    read: async (target, receiptId) => {
      expect(receiptId).toMatch(/^[0-9a-f]{64}$/);
      return read(target);
    },
    transact: async (target, receiptId, action) => {
      expect(receiptId).toMatch(/^[0-9a-f]{64}$/);
      expect(action).toBeTypeOf('function');
      transactions.push({ target, receiptId });
      const previous = queues.get(target) ?? Promise.resolve();
      const next = previous.then(async () => {
        const before = await read(target);
        const result = await action(copy(before));
        expect(result).toHaveProperty('state');
        if (!isDeepStrictEqual(before, result.state)) {
          await writeFile(join(directory, `${target}.json`), JSON.stringify(result.state));
          writes.push({ target, state: copy(result.state) });
        }
        return copy(result.value);
      });
      queues.set(
        target,
        next.catch(() => {}),
      );
      return next;
    },
  };
  let now = start;
  const clock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
  const candidate = manifest();
  const raw = JSON.stringify(candidate);
  const config = {
    targetId: 'synthetic-a',
    environment: 'staging',
    configurationSha256: '6'.repeat(64),
    policy: copy(policy),
  };
  const dispatch = {
    schemaVersion: 1,
    sourceSha: sha,
    manifestSha256: sha256(raw),
    configurationSha256: config.configurationSha256,
  };
  const calls = [];
  const observedEffects = [];
  const defaults = {
    loadManifest: async () => raw,
    collectEvidence: async () => evidence(candidate),
    verifyProvenance: async ({ component }) => ({
      verified: true,
      sourceSha: sha,
      repositoryId: policy.repositoryId,
      workflowRef: policy.provenanceWorkflowRef,
      imageDigest: candidate.images[component].digest,
      attestationSha256: candidate.images[component].attestationSha256,
      runId: candidate.runs.images.id,
      runAttempt: candidate.runs.images.attempt,
    }),
    createRevision: async ({ component }) => ({ revision: `synthetic-${component}-new` }),
    waitReady: async () => ({ ready: true }),
    readTraffic: async () => ({ web: 'synthetic-web-old', api: 'synthetic-api-old' }),
    switchTraffic: async ({ component }) => ({ operationId: `synthetic-operation-${component}` }),
    probe: async () => ({ ok: true }),
    notify: async () => {},
  };
  const adapters = Object.fromEntries(
    Object.entries(defaults).map(([name, action]) => [
      name,
      vi.fn(async (args) => {
        calls.push({ name, args });
        if (['createRevision', 'switchTraffic', 'notify'].includes(name))
          observedEffects.push({ name, args, state: await read(args.targetId) });
        return (overrides[name] ?? action)(
          args,
          calls.filter((entry) => entry.name === name).length,
        );
      }),
    ]),
  );
  const f = {
    config,
    store,
    clock,
    adapters,
    dispatch,
    candidate,
    raw,
    calls,
    writes,
    transactions,
    readState: read,
    observedEffects,
    advance: (ms) => {
      now += ms;
    },
    executor: (options = {}) => createExecutor({ config, store, clock, adapters, ...options }),
    run: (options = {}) => f.executor(options).run(JSON.stringify(dispatch)),
  };
  return f;
}
function effects(f, name) {
  return f.calls.filter((entry) => entry.name === name);
}
function expectNoTraffic(f) {
  expect(effects(f, 'switchTraffic')).toEqual([]);
}
function expectSanitized(value) {
  expect(JSON.stringify(value)).not.toContain('synthetic-private-adapter-canary');
}
function assertIntentBeforeEffects(f) {
  for (const { args, state } of f.observedEffects) {
    expect(args.receiptId).toEqual(expect.any(String));
    expect(state.lock?.receiptId).toBe(args.receiptId);
    expect(state.receipts[args.receiptId]?.pendingEffect).toBeTruthy();
  }
}

describe('REL-02/03/04 admission and trusted adapter boundary', () => {
  it('uses exact manifest identities and readies both components before separate traffic switches', async () => {
    const f = await harness();
    const result = await f.run();
    expect(result.status).toBe('succeeded');
    expect(result.pendingEffect).toBeNull();
    expect(f.transactions.length).toBeGreaterThan(0);
    for (const transaction of f.transactions)
      expect(transaction).toEqual({ target: f.config.targetId, receiptId: result.receiptId });
    expect((await f.readState(f.config.targetId)).lock).toBeNull();
    expect(effects(f, 'loadManifest')).toHaveLength(1);
    expect(effects(f, 'loadManifest')[0].args).toMatchObject({
      manifestSha256: f.dispatch.manifestSha256,
      maxBytes: 65536,
    });
    expect(
      effects(f, 'verifyProvenance')
        .map(({ args }) => args.component)
        .sort(),
    ).toEqual(['api', 'web']);
    expect(
      effects(f, 'createRevision')
        .map(({ args }) => [args.component, args.imageDigest])
        .sort(),
    ).toEqual([
      ['api', f.candidate.images.api.digest],
      ['web', f.candidate.images.web.digest],
    ]);
    expect(
      effects(f, 'switchTraffic')
        .map(({ args }) => [args.component, args.revision])
        .sort(),
    ).toEqual([
      ['api', 'synthetic-api-new'],
      ['web', 'synthetic-web-new'],
    ]);
    const firstSwitch = f.calls.findIndex((entry) => entry.name === 'switchTraffic');
    expect(
      f.calls.slice(0, firstSwitch).filter((entry) => entry.name === 'waitReady'),
    ).toHaveLength(2);
    expect(
      f.calls.slice(0, firstSwitch).filter((entry) => entry.name === 'collectEvidence').length,
    ).toBeGreaterThanOrEqual(2);
    expect(f.calls.slice(0, firstSwitch).some((entry) => entry.name === 'readTraffic')).toBe(true);
    const secondEvidence = f.calls.map((entry) => entry.name).lastIndexOf('collectEvidence');
    expect(secondEvidence).toBeGreaterThan(
      f.calls.map((entry) => entry.name).lastIndexOf('waitReady'),
    );
    assertIntentBeforeEffects(f);
    for (const { args } of f.calls) {
      expect(args.targetId).toBe('synthetic-a');
      expect(args.receiptId).toBe(result.receiptId);
      expect(args.signal).toBeInstanceOf(AbortSignal);
      expect(Number.isFinite(args.deadline)).toBe(true);
      expect(args.deadline).toBeLessThanOrEqual(start + 30 * minute);
    }
  });

  it.each(['production', 'development', 'unknown'])(
    'rejects environment %s before any adapter or durable admission',
    async (environment) => {
      const f = await harness();
      await expect(async () =>
        f.run({
          config: {
            ...f.config,
            environment,
            productionEnabled: true,
            approval: { approver: 'sundip' },
          },
        }),
      ).rejects.toThrow();
      expect(f.calls).toEqual([]);
      expect(await f.readState(f.config.targetId)).toEqual({ lock: null, receipts: {} });
    },
  );

  it.each([
    ['target injection', (d) => ({ ...d, targetId: 'synthetic-b' })],
    ['command injection', (d) => ({ ...d, command: 'synthetic-private-adapter-canary' })],
    ['configuration substitution', (d) => ({ ...d, configurationSha256: '9'.repeat(64) })],
  ])('rejects %s without external calls', async (_name, mutate) => {
    const f = await harness();
    await expect(f.executor().run(JSON.stringify(mutate(f.dispatch)))).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });

  it.each([
    ['manifest tamper', { loadManifest: async () => `${JSON.stringify(manifest())} ` }],
    [
      'manifest source substitution',
      { loadManifest: async () => JSON.stringify(manifest('a'.repeat(40))) },
    ],
    [
      'ineligible evidence',
      {
        collectEvidence: async () => ({ ...evidence(manifest()), currentMainSha: 'a'.repeat(40) }),
      },
    ],
    ['unverified provenance', { verifyProvenance: async () => ({ verified: false }) }],
  ])('denies %s before revision creation or traffic', async (_name, overrides) => {
    const f = await harness(overrides);
    const result = await f.run();
    expect(result.status).toBe('failed');
    expect(effects(f, 'createRevision')).toEqual([]);
    expectNoTraffic(f);
    expect(effects(f, 'notify')).toHaveLength(1);
    expectSanitized(result);
  });

  it('rechecks current main after readiness and denies a superseded candidate', async () => {
    const f = await harness({
      collectEvidence: async (_args, count) => ({
        ...evidence(manifest()),
        currentMainSha: count === 1 ? sha : 'a'.repeat(40),
      }),
    });
    expect((await f.run()).status).toBe('failed');
    expect(effects(f, 'createRevision')).toHaveLength(2);
    expectNoTraffic(f);
    expect(effects(f, 'notify')).toHaveLength(1);
  });
});

describe('REL-06/07/08 isolated effects and forward failure', () => {
  it.each([
    [
      'known revision failure',
      {
        createRevision: async () => {
          throw failure('NO_EFFECT');
        },
      },
    ],
    [
      'readiness exception',
      {
        waitReady: async () => {
          throw failure('PERMANENT_READ');
        },
      },
    ],
    ['not ready', { waitReady: async () => ({ ready: false }) }],
    [
      'traffic read failure',
      {
        readTraffic: async () => {
          throw failure('PERMANENT_READ');
        },
      },
    ],
  ])(
    'preserves existing traffic on %s and records one failure notification',
    async (_name, overrides) => {
      const f = await harness(overrides);
      const result = await f.run();
      expect(result.status).toBe('failed');
      expectNoTraffic(f);
      expect(effects(f, 'notify')).toHaveLength(1);
      expect(effects(f, 'notify')[0].args.status).toBe('failed');
      expectSanitized(result);
      assertIntentBeforeEffects(f);
    },
  );

  it('marks a confirmed partial switch degraded without restoring earlier traffic or repeating on redelivery', async () => {
    const f = await harness({
      switchTraffic: async ({ component }, count) => {
        if (count === 2) throw failure('NO_EFFECT');
        return { operationId: `synthetic-${component}-switch` };
      },
    });
    const result = await f.run();
    expect(result.status).toBe('degraded');
    expect(effects(f, 'switchTraffic')).toHaveLength(2);
    expect(effects(f, 'notify')).toHaveLength(1);
    expect(effects(f, 'notify')[0].args.status).toBe('degraded');
    const count = f.calls.length;
    expect(await f.run()).toEqual(result);
    expect(f.calls).toHaveLength(count);
    expectSanitized(result);
  });

  it.each([
    ['negative probe', async () => ({ ok: false })],
    [
      'failed probe',
      async () => {
        throw failure('PERMANENT_READ');
      },
    ],
  ])(
    'keeps changed traffic degraded after %s, without rollback or an inline repair loop',
    async (_name, probe) => {
      const f = await harness({ probe });
      const result = await f.run();
      expect(result.status).toBe('degraded');
      expect(effects(f, 'switchTraffic')).toHaveLength(2);
      expect(effects(f, 'createRevision')).toHaveLength(2);
      expect(effects(f, 'notify')).toHaveLength(1);
      expectSanitized(result);
    },
  );

  it('uses A only and leaves independent B durable state unchanged (adapter simulation, not IAM)', async () => {
    const f = await harness();
    const sentinel = {
      lock: { receiptId: 'synthetic-existing-b' },
      receipts: {
        'synthetic-existing-b': { status: 'running', privateConfiguration: 'synthetic-b-only' },
      },
    };
    await f.store.transact('synthetic-b', 'b'.repeat(64), async () => ({
      state: sentinel,
      value: null,
    }));
    expect((await f.run()).status).toBe('succeeded');
    expect(await f.readState('synthetic-b')).toEqual(sentinel);
    expect(f.calls.every(({ args }) => args.targetId === 'synthetic-a')).toBe(true);
    expect(JSON.stringify(f.calls)).not.toContain('synthetic-b-only');
  });
});

describe('REL-11 serialized durable receipts, bounds and uncertainty', () => {
  it('returns an immutable terminal receipt on duplicate delivery after executor recreation', async () => {
    const f = await harness();
    const result = await f.run();
    const persisted = await f.readState(f.config.targetId);
    expect(persisted.receipts[result.receiptId]).toMatchObject({
      status: 'succeeded',
      startedAt: start,
      totalDeadline: start + 30 * minute,
    });
    const count = f.calls.length;
    f.advance(31 * minute);
    expect(await f.executor({ store: { ...f.store } }).run(JSON.stringify(f.dispatch))).toEqual(
      result,
    );
    expect(f.calls).toHaveLength(count);
    expect(await f.readState(f.config.targetId)).toEqual(persisted);
  });

  it('does not repeat terminal failure notification or reset deadline', async () => {
    const f = await harness({ waitReady: async () => ({ ready: false }) });
    const result = await f.run();
    const count = f.calls.length;
    f.advance(60 * minute);
    expect(await f.run()).toEqual(result);
    expect(f.calls).toHaveLength(count);
    expect(effects(f, 'notify')).toHaveLength(1);
  });

  it('binds receipt identity to manifest and configuration as well as source', async () => {
    const f = await harness();
    const originalDispatch = JSON.stringify(f.dispatch);
    const original = await f.run();
    const candidate = manifest();
    candidate.images.web.digest = `sha256:${'9'.repeat(64)}`;
    const raw = JSON.stringify(candidate);
    f.dispatch.manifestSha256 = sha256(raw);
    f.adapters.loadManifest.mockResolvedValue(raw);
    f.adapters.verifyProvenance.mockImplementation(async ({ component }) => ({
      verified: true,
      sourceSha: sha,
      repositoryId: policy.repositoryId,
      workflowRef: policy.provenanceWorkflowRef,
      imageDigest: candidate.images[component].digest,
      attestationSha256: candidate.images[component].attestationSha256,
      runId: candidate.runs.images.id,
      runAttempt: candidate.runs.images.attempt,
    }));
    const changedManifest = await f.run();
    expect(changedManifest.status).toBe('succeeded');
    expect(changedManifest.receiptId).not.toBe(original.receiptId);
    f.config.configurationSha256 = f.dispatch.configurationSha256 = '7'.repeat(64);
    const changedConfiguration = await f.run();
    expect(changedConfiguration.status).toBe('succeeded');
    expect(
      new Set([original.receiptId, changedManifest.receiptId, changedConfiguration.receiptId]).size,
    ).toBe(3);
    expect(effects(f, 'switchTraffic')).toHaveLength(6);
    const count = f.calls.length;
    const originalConfig = { ...f.config, configurationSha256: '6'.repeat(64) };
    expect(await f.executor({ config: originalConfig }).run(originalDispatch)).toEqual(original);
    expect(f.calls).toHaveLength(count);
  });

  it('never repeats an unknown notification outcome on duplicate delivery', async () => {
    const f = await harness({
      notify: async () => {
        throw failure('UNKNOWN_OUTCOME');
      },
    });
    const result = await f.run();
    expect(result.status).toBe('reconciliation_required');
    expect(effects(f, 'notify')).toHaveLength(1);
    const count = f.calls.length;
    expect(await f.run()).toEqual(result);
    expect(f.calls).toHaveLength(count);
    const state = await f.readState(f.config.targetId);
    expect(state.lock?.receiptId).toBe(result.receiptId);
    expect(state.receipts[result.receiptId].pendingEffect).toBeTruthy();
  });

  it('serializes simultaneous identical requests and prevents duplicate effects', async () => {
    const f = await harness();
    const results = await Promise.allSettled([f.run(), f.run(), f.run()]);
    const successes = results.filter(
      (result) => result.status === 'fulfilled' && result.value.status === 'succeeded',
    );
    expect(successes.length).toBeGreaterThanOrEqual(1);
    expect(effects(f, 'createRevision')).toHaveLength(2);
    expect(effects(f, 'switchTraffic')).toHaveLength(2);
    expect(effects(f, 'notify')).toHaveLength(1);
    expect(Object.keys((await f.readState(f.config.targetId)).receipts)).toHaveLength(1);
  });

  it.each(['createRevision', 'switchTraffic', 'notify'])(
    'returns running unchanged for a duplicate during active %s and lets its owner finish',
    async (operation) => {
      let release;
      let arrived;
      const blocked = new Promise((resolve) => {
        release = resolve;
      });
      const entered = new Promise((resolve) => {
        arrived = resolve;
      });
      const f = await harness({
        [operation]: async ({ component }, count) => {
          if (count === 1) {
            arrived();
            await blocked;
          }
          return operation === 'createRevision'
            ? { revision: `synthetic-${component}-new` }
            : operation === 'switchTraffic'
              ? { operationId: `synthetic-operation-${component}` }
              : undefined;
        },
      });
      const first = f.run();
      await Promise.race([
        entered,
        first.then(() => {
          throw new Error('Synthetic owner finished before entering the mutation');
        }),
      ]);
      const before = await f.readState(f.config.targetId);
      const receipt = before.receipts[before.lock.receiptId];
      const callCount = f.calls.length;
      const writeCount = f.writes.length;
      expect(receipt.status).toBe('running');
      expect(receipt.pendingEffect).toBeTruthy();
      expect(f.clock.now()).toBeLessThan(receipt.totalDeadline);
      let completed;
      try {
        const duplicate = await f
          .executor({ store: { ...f.store } })
          .run(JSON.stringify(f.dispatch));
        expect(duplicate).toEqual(receipt);
        expect(duplicate.status).toBe('running');
        expect(await f.readState(f.config.targetId)).toEqual(before);
        expect(f.calls).toHaveLength(callCount);
        expect(f.writes).toHaveLength(writeCount);
        for (const write of f.writes.slice(writeCount)) expect(write.state).toEqual(before);
      } finally {
        release();
        completed = await first.then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      }
      expect(completed.error).toBeUndefined();
      expect(completed.value.status).toBe('succeeded');
      expect(effects(f, 'createRevision')).toHaveLength(2);
      expect(effects(f, 'switchTraffic')).toHaveLength(2);
      expect(effects(f, 'notify')).toHaveLength(1);
    },
  );

  it('rejects a concurrent different candidate while the first holds the target lock', async () => {
    let release;
    let arrived;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const entered = new Promise((resolve) => {
      arrived = resolve;
    });
    const f = await harness({
      waitReady: async () => {
        arrived();
        await blocked;
        return { ready: true };
      },
    });
    const first = f.run();
    await Promise.race([
      entered,
      first.then(() => {
        throw new Error('Synthetic owner finished before entering readiness');
      }),
    ]);
    const contender = { ...f.dispatch, sourceSha: 'a'.repeat(40), manifestSha256: 'a'.repeat(64) };
    try {
      await expect(f.executor().run(JSON.stringify(contender))).rejects.toThrow();
      expect(effects(f, 'loadManifest')).toHaveLength(1);
    } finally {
      release();
      await first;
    }
    expect(effects(f, 'switchTraffic')).toHaveLength(2);
  });

  it.each(['UNKNOWN_OUTCOME', 'TRANSIENT_READ', undefined])(
    'does not retry revision mutations with ambiguous classification %s',
    async (code) => {
      const f = await harness({
        createRevision: async () => {
          throw failure(code);
        },
      });
      const result = await f.run();
      expect(result.status).toBe('reconciliation_required');
      expect(effects(f, 'createRevision')).toHaveLength(1);
      expectNoTraffic(f);
      const state = await f.readState(f.config.targetId);
      expect(state.lock?.receiptId).toBe(result.receiptId);
      expect(state.receipts[result.receiptId].pendingEffect).toBeTruthy();
      const count = f.calls.length;
      f.advance(120 * minute);
      expect(await f.run()).toEqual(result);
      expect(f.calls).toHaveLength(count);
      await expect(
        f.executor().run(JSON.stringify({ ...f.dispatch, sourceSha: 'a'.repeat(40) })),
      ).rejects.toThrow();
      expect((await f.readState(f.config.targetId)).lock?.receiptId).toBe(result.receiptId);
      expectSanitized(result);
    },
  );

  it('halts on an unknown traffic mutation and never issues the second switch', async () => {
    const f = await harness({
      switchTraffic: async () => {
        throw failure('UNKNOWN_OUTCOME');
      },
    });
    const result = await f.run();
    expect(result.status).toBe('reconciliation_required');
    expect(effects(f, 'switchTraffic')).toHaveLength(1);
    expect(effects(f, 'probe')).toHaveLength(0);
    expect((await f.readState(f.config.targetId)).lock?.receiptId).toBe(result.receiptId);
    assertIntentBeforeEffects(f);
  });

  it.each([-1, 0, 1])(
    'preserves a pending owner until the original deadline and reconciles at offset %s ms without retry',
    async (offset) => {
      const f = await harness({
        createRevision: async () => {
          throw failure('UNKNOWN_OUTCOME');
        },
      });
      const original = await f.run();
      await f.store.transact(f.config.targetId, original.receiptId, async (state) => {
        state.receipts[original.receiptId].status = 'running';
        return { state, value: null };
      });
      f.advance(original.totalDeadline - f.clock.now() + offset);
      const before = await f.readState(f.config.targetId);
      const count = f.calls.length;
      const resumed = await f.executor({ store: { ...f.store } }).run(JSON.stringify(f.dispatch));
      expect(resumed.status).toBe(offset < 0 ? 'running' : 'reconciliation_required');
      if (offset < 0) expect(resumed).toEqual(before.receipts[original.receiptId]);
      expect(resumed.totalDeadline).toBe(original.totalDeadline);
      expect(f.calls).toHaveLength(count);
      const after = await f.readState(f.config.targetId);
      expect(after.lock).toEqual(before.lock);
      expect(after.lock?.receiptId).toBe(original.receiptId);
      expect(after.receipts[original.receiptId].pendingEffect).toEqual(
        before.receipts[original.receiptId].pendingEffect,
      );
      if (offset < 0) expect(after).toEqual(before);
    },
  );

  it('cannot mutate when durable admission is unavailable', async () => {
    const f = await harness();
    await expect(
      f.run({
        store: {
          ...f.store,
          transact: async () => {
            throw failure('STATE_UNAVAILABLE');
          },
        },
      }),
    ).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });

  it('records intent before each effect and stops if its durable outcome cannot be recorded', async () => {
    const f = await harness();
    const transact = f.store.transact;
    let failWrites = false;
    f.adapters.createRevision.mockImplementation(async (args) => {
      f.calls.push({ name: 'createRevision', args });
      const state = await f.readState(args.targetId);
      expect(state.receipts[args.receiptId].pendingEffect).toBeTruthy();
      failWrites = true;
      return { revision: 'synthetic-web-created' };
    });
    const brokenStore = {
      ...f.store,
      transact: async (...args) => {
        if (failWrites) throw failure('STATE_UNAVAILABLE');
        return transact(...args);
      },
    };
    const [outcome] = await Promise.allSettled([f.run({ store: brokenStore })]);
    if (outcome.status === 'fulfilled')
      expect(outcome.value.status).toBe('reconciliation_required');
    expect(effects(f, 'createRevision')).toHaveLength(1);
    expectNoTraffic(f);
    const state = await f.readState(f.config.targetId);
    expect(state.lock).not.toBeNull();
    expect(state.receipts[state.lock.receiptId].pendingEffect).toBeTruthy();
  });

  it('retries only transient safe reads twice, then stops before traffic', async () => {
    const f = await harness({
      collectEvidence: async () => {
        throw failure('TRANSIENT_READ');
      },
    });
    const result = await f.run();
    expect(result.status).toBe('failed');
    expect(effects(f, 'collectEvidence')).toHaveLength(3);
    expectNoTraffic(f);
    const before = f.calls.length;
    await f.run();
    expect(f.calls).toHaveLength(before);
  });

  it('permits a transient safe read to recover on the final bounded attempt', async () => {
    const f = await harness({
      readTraffic: async (_args, count) => {
        if (count < 3) throw failure('TRANSIENT_READ');
        return { web: 'synthetic-web-old', api: 'synthetic-api-old' };
      },
    });
    expect((await f.run()).status).toBe('succeeded');
    expect(effects(f, 'readTraffic')).toHaveLength(3);
  });

  it('never retries unclassified or permanent read failures', async () => {
    const f = await harness({
      collectEvidence: async () => {
        throw failure('PERMANENT_READ');
      },
    });
    expect((await f.run()).status).toBe('failed');
    expect(effects(f, 'collectEvidence')).toHaveLength(1);
  });

  it('uses original total, rollout and probe stage deadlines', async () => {
    let f;
    f = await harness({
      collectEvidence: async () => {
        f.advance(minute);
        return evidence(manifest());
      },
    });
    const result = await f.run();
    expect(result.totalDeadline).toBe(start + 30 * minute);
    expect(result.rolloutDeadline).toBe(start + 16 * minute);
    expect(result.probeDeadline).toBe(start + 7 * minute);
    for (const { args } of effects(f, 'waitReady'))
      expect(args.deadline).toBe(result.rolloutDeadline);
    for (const { args } of effects(f, 'probe')) expect(args.deadline).toBe(result.probeDeadline);
  });

  it('stops expired rollout work and redelivery cannot restart the clock', async () => {
    let f;
    f = await harness({
      waitReady: async () => {
        f.advance(16 * minute);
        return { ready: true };
      },
    });
    const result = await f.run();
    expect(result.status).toBe('failed');
    expectNoTraffic(f);
    expect(result.rolloutDeadline).toBe(start + 15 * minute);
    const count = f.calls.length;
    await f.run();
    expect(f.calls).toHaveLength(count);
  });

  it('rechecks the deadline after a slow durable intent commit before calling a mutation', async () => {
    const f = await harness();
    let delayed = false;
    const store = {
      ...f.store,
      transact: async (target, receiptId, action) =>
        f.store.transact(target, receiptId, async (state) => {
          const result = await action(state);
          if (
            !delayed &&
            Object.values(result.state.receipts).some((receipt) => receipt.pendingEffect)
          ) {
            delayed = true;
            f.advance(16 * minute);
          }
          return result;
        }),
    };
    const result = await f.run({ store });
    expect(result.status).toBe('failed');
    expect(effects(f, 'createRevision')).toHaveLength(0);
    expectNoTraffic(f);
  });

  it('caps late rollout and probes by the original total deadline', async () => {
    let f;
    f = await harness({
      collectEvidence: async (_args, count) => {
        if (count === 1) f.advance(28 * minute);
        return evidence(manifest());
      },
    });
    const result = await f.run();
    expect(result.status).toBe('succeeded');
    expect(result.rolloutDeadline).toBe(result.totalDeadline);
    expect(result.probeDeadline).toBe(result.totalDeadline);
  });

  it('marks a probe exceeding five minutes degraded without another switch', async () => {
    let f;
    f = await harness({
      probe: async () => {
        f.advance(6 * minute);
        return { ok: true };
      },
    });
    expect((await f.run()).status).toBe('degraded');
    expect(effects(f, 'switchTraffic')).toHaveLength(2);
  });

  it('does not retry transient reads after waiting has exhausted the original total deadline', async () => {
    let f;
    f = await harness({
      collectEvidence: async () => {
        f.advance(31 * minute);
        throw failure('TRANSIENT_READ');
      },
    });
    expect((await f.run()).status).toBe('failed');
    expect(effects(f, 'collectEvidence')).toHaveLength(1);
    expectNoTraffic(f);
  });

  it('aborts a hung mutation at the rollout deadline and retains reconciliation instead of hanging or retrying', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    let entered;
    let mutationArgs;
    const arrived = new Promise((resolve) => {
      entered = resolve;
    });
    const f = await harness({
      createRevision: async (args) => {
        mutationArgs = args;
        entered();
        return new Promise(() => {});
      },
    });
    f.clock.now = () => Date.now();
    const pending = f.run();
    const observed = Promise.allSettled([pending]);
    await arrived;
    await vi.advanceTimersByTimeAsync(16 * minute);
    expect(mutationArgs.signal.aborted).toBe(true);
    const [outcome] = await observed;
    expect(outcome.status).toBe('fulfilled');
    expect(outcome.value.status).toBe('reconciliation_required');
    expect(effects(f, 'createRevision')).toHaveLength(1);
    expectNoTraffic(f);
    const state = await f.readState(f.config.targetId);
    expect(state.lock?.receiptId).toBe(outcome.value.receiptId);
    expect(state.receipts[outcome.value.receiptId].pendingEffect).toBeTruthy();
  }, 10_000);

  it('aborts a hung safe read at the original total deadline and cannot start revisions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    let entered;
    let readArgs;
    const arrived = new Promise((resolve) => {
      entered = resolve;
    });
    const f = await harness({
      collectEvidence: async (args) => {
        readArgs = args;
        entered();
        return new Promise(() => {});
      },
    });
    f.clock.now = () => Date.now();
    const pending = f.run();
    const observed = Promise.allSettled([pending]);
    await arrived;
    await vi.advanceTimersByTimeAsync(31 * minute);
    expect(readArgs.signal.aborted).toBe(true);
    const [outcome] = await observed;
    expect(outcome.status).toBe('fulfilled');
    expect(outcome.value.status).toBe('failed');
    expect(effects(f, 'createRevision')).toHaveLength(0);
    expectNoTraffic(f);
    expect(outcome.value.totalDeadline).toBe(start + 30 * minute);
  }, 10_000);
});
