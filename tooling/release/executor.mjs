import { createHash, randomUUID } from 'node:crypto';
import { parseDispatch, parseManifest, validateEvidence, validateProvenance } from './contract.mjs';

const minute = 60_000;
const components = ['web', 'api'];
const adapterNames = [
  'loadManifest',
  'collectEvidence',
  'verifyProvenance',
  'createRevision',
  'waitReady',
  'readTraffic',
  'switchTraffic',
  'probe',
  'notify',
];
const terminalStatuses = ['succeeded', 'failed', 'degraded', 'reconciliation_required'];

class StateFailure extends Error {
  constructor() {
    super('Release state unavailable or ownership denied');
  }
}

class ControlFailure extends Error {
  constructor(code) {
    super('Release operation stopped');
    this.code = code;
  }
}

function requireValue(condition) {
  if (!condition) throw new Error('Release execution denied');
}

function identifier(value) {
  return (
    typeof value === 'string' &&
    value.length <= 1024 &&
    /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.exec(value)?.[0] === value
  );
}

function pendingEffects(receipt) {
  const unresolved = receipt.effects.filter((effect) =>
    ['pending', 'unknown'].includes(effect.outcome),
  );
  receipt.pendingEffect = unresolved.length ? structuredClone(unresolved) : null;
}

function uncertain(receipt, reason) {
  receipt.status = 'reconciliation_required';
  receipt.reason = reason;
  const uncertainTraffic = receipt.pendingEffect?.some(
    (effect) => effect.operation === 'switchTraffic',
  );
  receipt.serviceStateKnown = receipt.serviceStateKnown && !uncertainTraffic;
  receipt.degraded = receipt.degraded || receipt.trafficChanged || Boolean(uncertainTraffic);
}

export function createExecutor({ config, store, adapters, clock }) {
  requireValue(config?.environment === 'staging');
  requireValue(
    typeof config.targetId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.exec(config.targetId)?.[0] === config.targetId,
  );
  requireValue(
    typeof config.configurationSha256 === 'string' &&
      /^[0-9a-f]{64}$/.exec(config.configurationSha256)?.[0] === config.configurationSha256,
  );
  requireValue(typeof store?.read === 'function' && typeof store?.transact === 'function');
  requireValue(typeof clock?.now === 'function' && typeof clock?.sleep === 'function');
  requireValue(adapterNames.every((name) => typeof adapters?.[name] === 'function'));
  const fixed = structuredClone(config);
  const operations = Object.fromEntries(adapterNames.map((name) => [name, adapters[name]]));

  return { run };

  async function run(rawDispatch) {
    const request = parseDispatch(rawDispatch);
    requireValue(request.configurationSha256 === fixed.configurationSha256);
    const receiptId = createHash('sha256')
      .update(
        JSON.stringify([
          fixed.targetId,
          request.sourceSha,
          request.manifestSha256,
          request.configurationSha256,
        ]),
      )
      .digest('hex');
    const ownerId = randomUUID();
    let lastTime = 0;
    let receipt;

    function now() {
      const observed = clock.now();
      requireValue(Number.isSafeInteger(observed) && observed >= 0);
      lastTime = Math.max(lastTime, observed);
      return lastTime;
    }

    function checkDeadline(deadline) {
      if (now() >= deadline) throw new ControlFailure('DEADLINE');
    }

    async function transact(action) {
      try {
        return await store.transact(fixed.targetId, receiptId, async (state) => {
          requireValue(
            state &&
              typeof state === 'object' &&
              state.receipts &&
              typeof state.receipts === 'object' &&
              !Array.isArray(state.receipts),
          );
          return action(state);
        });
      } catch {
        throw new StateFailure();
      }
    }

    async function update(action) {
      receipt = await transact((state) => {
        const current = state.receipts[receiptId];
        requireValue(state.lock?.receiptId === receiptId && state.lock.ownerId === ownerId);
        requireValue(current && ['running', 'reconciliation_required'].includes(current.status));
        action(current, state);
        return { state, value: structuredClone(current) };
      });
    }

    const admission = await transact((state) => {
      const existing = state.receipts[receiptId];
      if (existing) {
        requireValue(
          existing.sourceSha === request.sourceSha &&
            existing.manifestSha256 === request.manifestSha256 &&
            existing.configurationSha256 === request.configurationSha256 &&
            existing.targetId === fixed.targetId,
        );
        if (terminalStatuses.includes(existing.status))
          return { state, value: { admitted: false, receipt: structuredClone(existing) } };
        requireValue(existing.status === 'running' && state.lock?.receiptId === receiptId);
        requireValue(Number.isSafeInteger(existing.totalDeadline) && existing.totalDeadline > 0);
        // Active duplicates acknowledge ownership; only the original deadline can halt it.
        if (now() >= existing.totalDeadline) uncertain(existing, 'interrupted_effect');
        return { state, value: { admitted: false, receipt: structuredClone(existing) } };
      }
      requireValue(state.lock === null);
      const startedAt = now();
      const current = {
        receiptId,
        targetId: fixed.targetId,
        ...request,
        status: 'running',
        startedAt,
        totalDeadline: startedAt + 30 * minute,
        pendingEffect: null,
        effects: [],
        reads: [],
        revisions: {},
        trafficChanged: false,
        serviceStateKnown: true,
        degraded: false,
        notification: { status: 'not_started' },
      };
      state.lock = { receiptId, ownerId };
      state.receipts[receiptId] = current;
      return { state, value: { admitted: true, receipt: structuredClone(current) } };
    });
    receipt = admission.receipt;
    if (!admission.admitted) return receipt;
    lastTime = receipt.startedAt;

    // Abort and stop waiting even if an adapter ignores cancellation. A timed-out
    // mutation retains its intent because the remote operation may still finish.
    async function bounded(action, deadline) {
      checkDeadline(deadline);
      const controller = new AbortController();
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(() => {
            checkDeadline(deadline);
            return action(controller.signal);
          }),
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new ControlFailure('DEADLINE'));
            }, deadline - now());
          }),
        ]);
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    }

    function invoke(operation, args, deadline) {
      return bounded(
        (signal) =>
          operations[operation]({
            ...structuredClone(args),
            targetId: fixed.targetId,
            receiptId,
            signal,
            deadline,
          }),
        deadline,
      );
    }

    async function read(operation, args, deadline) {
      for (let attempt = 0; attempt <= 2; attempt += 1) {
        checkDeadline(deadline);
        const index = receipt.reads.length;
        await update((current) => {
          requireValue(current.status === 'running' && current.pendingEffect === null);
          current.reads.push({
            operation,
            attempt: attempt + 1,
            startedAt: now(),
            deadline,
            outcome: 'pending',
          });
        });
        let result;
        let code;
        try {
          result = await invoke(operation, args, deadline);
          checkDeadline(deadline);
        } catch (error) {
          code =
            error instanceof ControlFailure
              ? error.code
              : error?.code === 'TRANSIENT_READ'
                ? 'TRANSIENT_READ'
                : 'READ_FAILED';
        }
        await update((current) => {
          current.reads[index].outcome = code ?? 'observed';
          current.reads[index].finishedAt = now();
        });
        if (!code) return result;
        if (code !== 'TRANSIENT_READ' || attempt === 2) throw new ControlFailure(code);
        checkDeadline(deadline);
        await bounded(() => clock.sleep(Math.min(250 * (attempt + 1), deadline - now())), deadline);
      }
    }

    async function mutate(operation, args, deadline) {
      checkDeadline(deadline);
      const index = receipt.effects.length;
      await update((current) => {
        requireValue(
          operation === 'notify' ||
            (current.status === 'running' && current.pendingEffect === null),
        );
        if (operation === 'notify') {
          requireValue(current.notification.status === 'not_started');
          current.notification = { status: 'pending', intendedStatus: args.status };
        }
        current.effects.push({
          operation,
          ...(args.component ? { component: args.component } : {}),
          startedAt: now(),
          deadline,
          outcome: 'pending',
        });
        pendingEffects(current);
      });
      let result;
      let outcome = 'observed';
      try {
        // Recheck after the durable commit. No cloud call is allowed once expired.
        checkDeadline(deadline);
      } catch {
        outcome = 'no_effect';
      }
      if (outcome === 'observed') {
        try {
          result = await invoke(operation, args, deadline);
          if (operation === 'createRevision') requireValue(identifier(result?.revision));
          if (operation === 'switchTraffic') requireValue(identifier(result?.operationId));
        } catch (error) {
          outcome = error?.code === 'NO_EFFECT' ? 'no_effect' : 'unknown';
        }
      }
      await update((current) => {
        const effect = current.effects[index];
        effect.outcome = outcome;
        effect.finishedAt = now();
        if (outcome === 'observed' && operation === 'createRevision') {
          current.revisions[args.component] = result.revision;
          effect.revision = result.revision;
        }
        if (outcome === 'observed' && operation === 'switchTraffic') {
          effect.operationId = result.operationId;
          current.trafficChanged = true;
        }
        if (operation === 'notify') current.notification.status = outcome;
        pendingEffects(current);
        if (outcome === 'unknown') uncertain(current, 'unknown_mutation');
      });
      if (outcome !== 'observed')
        throw new ControlFailure(outcome === 'unknown' ? 'UNKNOWN_MUTATION' : 'NO_EFFECT');
      if (operation !== 'notify') checkDeadline(deadline);
      return result;
    }

    async function enterStage(field, duration) {
      await update((current) => {
        requireValue(current.status === 'running' && current.pendingEffect === null);
        current[field] ??= Math.min(current.totalDeadline, now() + duration);
      });
      checkDeadline(receipt[field]);
      return receipt[field];
    }

    async function finish(status, reason) {
      await update((current) => {
        if (current.status === 'reconciliation_required') status = current.status;
        current.outcome = status;
        current.reason = reason;
        current.degraded ||= status === 'degraded';
      });
      if (now() < receipt.totalDeadline) {
        try {
          await mutate(
            'notify',
            {
              status,
              sourceSha: request.sourceSha,
              trafficChanged: receipt.trafficChanged,
              degraded: receipt.degraded,
              uncertain: status === 'reconciliation_required',
              trafficState: !receipt.serviceStateKnown
                ? 'unknown'
                : receipt.trafficChanged
                  ? 'changed'
                  : 'unchanged',
              correctiveAction:
                status === 'reconciliation_required'
                  ? 'operator_reconciliation'
                  : status === 'degraded'
                    ? 'reviewed_forward_fix'
                    : status === 'failed'
                      ? 'reviewed_repair'
                      : 'none',
            },
            receipt.totalDeadline,
          );
        } catch (error) {
          if (error instanceof StateFailure) throw error;
          if (receipt.status === 'reconciliation_required') status = 'reconciliation_required';
          else if (status === 'succeeded') status = receipt.trafficChanged ? 'degraded' : 'failed';
          await update((current) => {
            current.reason = 'notification_failed';
          });
        }
      } else {
        await update((current) => {
          current.notification.status = 'not_sent_deadline';
        });
      }
      await update((current, state) => {
        if (
          current.status === 'reconciliation_required' ||
          current.pendingEffect !== null ||
          !current.serviceStateKnown
        )
          uncertain(current, 'reconciliation_required');
        else {
          current.status = status;
          current.degraded ||= status === 'degraded';
          state.lock = null;
        }
        current.outcome = current.status;
        current.finishedAt = now();
      });
      return receipt;
    }

    try {
      const rawManifest = await read(
        'loadManifest',
        {
          manifestSha256: request.manifestSha256,
          maxBytes: 65536,
        },
        receipt.totalDeadline,
      );
      const manifest = parseManifest(rawManifest, request.manifestSha256);
      requireValue(manifest.sourceSha === request.sourceSha);
      const eligibilityArgs = { manifest, sourceSha: request.sourceSha };
      validateEvidence(
        manifest,
        await read('collectEvidence', eligibilityArgs, receipt.totalDeadline),
        fixed.policy,
      );
      for (const component of components) {
        const verification = await read(
          'verifyProvenance',
          { component, manifest },
          receipt.totalDeadline,
        );
        validateProvenance(manifest, component, verification, fixed.policy);
      }
      const rolloutDeadline = await enterStage('rolloutDeadline', 15 * minute);
      for (const component of components) {
        await mutate(
          'createRevision',
          { component, imageDigest: manifest.images[component].digest },
          rolloutDeadline,
        );
      }
      for (const component of components) {
        const ready = await read(
          'waitReady',
          { component, revision: receipt.revisions[component] },
          rolloutDeadline,
        );
        requireValue(ready?.ready === true);
      }
      const traffic = await read('readTraffic', {}, rolloutDeadline);
      requireValue(
        traffic &&
          typeof traffic === 'object' &&
          !Array.isArray(traffic) &&
          Object.keys(traffic).length === components.length &&
          components.every(
            (component) =>
              Object.hasOwn(traffic, component) &&
              traffic[component] !== null &&
              (identifier(traffic[component]) ||
                (typeof traffic[component] === 'object' &&
                  Object.keys(traffic[component]).length > 0)),
          ),
      );
      requireValue(Buffer.byteLength(JSON.stringify(traffic), 'utf8') <= 65536);
      await update((current) => {
        current.trafficBefore = structuredClone(traffic);
      });
      validateEvidence(
        manifest,
        await read('collectEvidence', eligibilityArgs, rolloutDeadline),
        fixed.policy,
      );
      for (const component of components) {
        await mutate(
          'switchTraffic',
          { component, revision: receipt.revisions[component] },
          rolloutDeadline,
        );
      }
      const probeDeadline = await enterStage('probeDeadline', 5 * minute);
      const probe = await read('probe', {}, probeDeadline);
      requireValue(probe?.ok === true);
    } catch (error) {
      if (error instanceof StateFailure) throw error;
      const status =
        receipt.status === 'reconciliation_required'
          ? 'reconciliation_required'
          : receipt.trafficChanged
            ? 'degraded'
            : 'failed';
      return finish(status, error instanceof ControlFailure ? error.code : 'VALIDATION_FAILED');
    }
    return finish('succeeded', 'verified');
  }
}
