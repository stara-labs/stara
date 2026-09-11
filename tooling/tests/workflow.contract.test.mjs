import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanupFixtures, workspace } from './fixtures.mjs';

let workflow;
let raw;
beforeAll(async () => {
  raw = await readFile(new URL('../../.github/workflows/checks.yml', import.meta.url), 'utf8');
  workflow = parse(raw);
});
afterEach(cleanupFixtures);

const allSteps = () => Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
const runs = (job) => (workflow.jobs[job].steps ?? []).map((step) => step.run ?? '').join('\n');

describe('checks workflow: untrusted proposals have read-only, complete required checks', () => {
  it('uses safe proposal triggers, full history, and no path filters', () => {
    expect(Object.keys(workflow.on)).toEqual(
      expect.arrayContaining([
        'pull_request',
        'push',
        'merge_group',
        'schedule',
        'workflow_dispatch',
      ]),
    );
    expect(workflow.on).not.toHaveProperty('pull_request_target');
    for (const trigger of Object.values(workflow.on)) {
      if (trigger && typeof trigger === 'object' && !Array.isArray(trigger)) {
        expect(trigger).not.toHaveProperty('paths');
        expect(trigger).not.toHaveProperty('paths-ignore');
      }
    }
    for (const step of allSteps().filter((step) => step.uses?.startsWith('actions/checkout@'))) {
      expect(step.with).toMatchObject({ 'fetch-depth': 0, 'persist-credentials': false });
    }
  });

  it('grants only explicit read/none permissions and never references secrets', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    for (const job of Object.values(workflow.jobs)) {
      if (job.permissions) {
        expect(typeof job.permissions).toBe('object');
        expect(
          Object.values(job.permissions).every((permission) =>
            ['read', 'none'].includes(permission),
          ),
        ).toBe(true);
      }
    }
    expect(raw).not.toMatch(/\bsecrets\s*(?:\.|\[)|\binherit\b/);
  });

  it('pins every external action to an immutable commit and never ignores a failure', () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(job['timeout-minutes'], name).toBeGreaterThan(0);
      expect(job['continue-on-error'] ?? false).toBe(false);
      for (const step of job.steps ?? []) {
        if (step.uses) expect(step.uses).toMatch(/^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/);
        expect(step['continue-on-error'] ?? false).toBe(false);
      }
    }
  });

  it('runs Linux candidate, Compose, and Windows package checks on every supported event', () => {
    expect(workflow.jobs.verify['runs-on']).toMatch(/^ubuntu-/);
    expect(workflow.jobs.containers['runs-on']).toMatch(/^ubuntu-/);
    expect(workflow.jobs.windows['runs-on']).toMatch(/^windows-/);
    expect(workflow.jobs.verify.if ?? 'always()').toBe('always()');
    expect(workflow.jobs.containers.if ?? 'always()').toBe('always()');
    expect(workflow.jobs.windows.if ?? 'always()').toBe('always()');
    expect(runs('verify')).toContain('pnpm check:pr');
    expect(runs('verify')).toContain('pnpm validate');
    expect(runs('windows')).toContain('pnpm test:coverage');
    expect(runs('windows')).toContain('pnpm build');
    expect(runs('containers').match(/pnpm start/g)).toHaveLength(2);
    expect(runs('containers')).toContain('pnpm test:e2e');
    expect(runs('containers')).toContain('pnpm test:a11y');
    expect(runs('containers')).not.toMatch(/--volumes|(?:docker|pnpm)\s+.*\bprune\b/);
    for (const step of workflow.jobs.containers.steps.filter((step) =>
      /test:e2e|test:a11y/.test(step.run ?? ''),
    )) {
      expect(step.env).toMatchObject({
        STARA_EXTERNAL_SERVERS: '1',
        STARA_E2E_BASE_URL: 'http://127.0.0.1:5173',
      });
    }
  });

  it('always aggregates every required job and retains diagnostics on failure', () => {
    expect(workflow.jobs.required.if).toBe('always()');
    expect([...workflow.jobs.required.needs].sort()).toEqual(['containers', 'verify', 'windows']);
    for (const name of ['verify', 'windows', 'containers']) {
      const uploads = workflow.jobs[name].steps.filter((step) =>
        step.uses?.startsWith('actions/upload-artifact@'),
      );
      expect(uploads.length).toBeGreaterThan(0);
      for (const step of uploads) {
        expect(step.if).toBe('always()');
        expect(step.with['if-no-files-found']).toBe('error');
      }
    }
  });

  it('runs targeted mutation on full non-PR candidates without making it optional', () => {
    const mutation = workflow.jobs.verify.steps.filter((step) => step.run === 'pnpm test:mutation');
    expect(mutation).toHaveLength(1);
    expect(mutation[0].if.replaceAll('${{', '').replaceAll('}}', '').trim()).toBe(
      "github.event_name != 'pull_request'",
    );
    expect(mutation[0]['continue-on-error'] ?? false).toBe(false);
  });
});

describe('required aggregate: execute the real bounded shell truth table', () => {
  async function aggregate(event, statuses) {
    const step = workflow.jobs.required.steps.find((candidate) => candidate.run);
    expect(step.env).toMatchObject({
      EVENT: '${{ github.event_name }}',
      VERIFY: '${{ needs.verify.result }}',
      WINDOWS: '${{ needs.windows.result }}',
      CONTAINERS: '${{ needs.containers.result }}',
    });
    const safeLines =
      /^(?:test "\$(?:VERIFY|WINDOWS|CONTAINERS)" = (?:success|skipped)|if \[ "\$EVENT" = pull_request \]; then|else|fi)$/;
    expect(
      step.run
        .trim()
        .split('\n')
        .every((line) => safeLines.test(line.trim())),
    ).toBe(true);
    const root = await workspace();
    const bash =
      process.platform === 'win32'
        ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
        : '/bin/bash';
    const result = spawnSync(
      bash,
      ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', step.run],
      {
        cwd: root,
        env: { EVENT: event, ...statuses },
        timeout: 5_000,
        encoding: 'utf8',
        windowsHide: true,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).not.toBeNull();
    return result.status;
  }

  it.each(['pull_request', 'push', 'schedule', 'merge_group', 'workflow_dispatch'])(
    'accepts exactly the expected successful jobs for %s',
    async (event) => {
      expect(
        await aggregate(event, {
          VERIFY: 'success',
          CONTAINERS: 'success',
          WINDOWS: 'success',
        }),
      ).toBe(0);
    },
  );

  for (const event of ['pull_request', 'push']) {
    for (const name of ['VERIFY', 'CONTAINERS', 'WINDOWS']) {
      it.each(['failure', 'cancelled', 'skipped', '', 'unknown'])(
        `rejects ${event} ${name}=%j`,
        async (status) => {
          const statuses = {
            VERIFY: 'success',
            CONTAINERS: 'success',
            WINDOWS: 'success',
            [name]: status,
          };
          expect(await aggregate(event, statuses)).not.toBe(0);
        },
      );
    }
  }

  it.each(['VERIFY', 'CONTAINERS', 'WINDOWS'])(
    'rejects unexpectedly skipped non-PR %s',
    async (name) => {
      expect(
        await aggregate('push', {
          VERIFY: 'success',
          WINDOWS: 'success',
          CONTAINERS: 'success',
          [name]: 'skipped',
        }),
      ).not.toBe(0);
    },
  );
});
