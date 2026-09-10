import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { delimiter, dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { materializeCommit, materializeIndex } from './snapshot.mjs';
import { recordCommand, sanitize } from './evidence.mjs';

const execute = promisify(execFile);

function failedCommand(executable, args, cause, env) {
  const code = cause?.code ?? cause?.cause?.code ?? 'unknown';
  const diagnostic = `${cause?.stdout ?? cause?.cause?.stdout ?? ''}\n${cause?.stderr ?? cause?.cause?.stderr ?? ''}\n${cause?.message ?? cause ?? ''}`;
  const command = sanitize([executable, ...args].join(' '), env, 800);
  const safe = sanitize(diagnostic, env);
  const message = `${command} failed (exit ${code})\n${safe.slice(0, 2200)}${safe.length > 2200 ? `\n...\n${safe.slice(-800)}` : ''}`;
  return new Error(message.slice(0, 4096), { cause });
}

export async function runProcess(executable, args, options = {}) {
  const { cwd, env = process.env, timeout = 120000, allowExitCodes = [0] } = options;
  if (!Number.isInteger(timeout) || timeout <= 0)
    throw new Error('Command timeout must be a positive finite integer');
  try {
    const result = await execute(executable, args, {
      cwd,
      env,
      timeout,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (cause) {
    if (allowExitCodes.includes(cause.code))
      return { code: cause.code, stdout: cause.stdout, stderr: cause.stderr };
    const detail = cause.killed ? `timeout after ${timeout}ms` : `exit ${cause.code ?? 'unknown'}`;
    const failure = failedCommand(executable, args, cause, env);
    if (cause.killed) failure.message = `${detail}\n${failure.message}`.slice(0, 4096);
    throw failure;
  }
}

export function createRuntime(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const node = options.node ?? process.execPath;
  const suppliedEnv = options.env ?? process.env;
  const env = { ...suppliedEnv };
  if (process.platform === 'win32') {
    for (const name of ['STARA_PNPM_CLI', 'npm_execpath']) {
      const keys = Object.keys(env).filter((key) => key.toUpperCase() === name.toUpperCase());
      if (new Set(keys.map((key) => env[key])).size > 1)
        throw new Error(`Conflicting Windows pnpm environment aliases for ${name}`);
      if (keys.length) {
        const value = env[keys[0]];
        for (const key of keys) delete env[key];
        env[name] = value;
      }
    }
  }
  // pnpm disables this check in script environments; nested snapshot tooling must restore it.
  if (env.STARA_ISOLATED_ROOT === root) env.pnpm_config_verify_deps_before_run = 'error';
  const runId = options.runId ?? randomUUID();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(runId))
    throw new Error('Invalid evidence run identifier');
  const actor = options.actor ?? env.GITHUB_ACTOR ?? env.USERNAME ?? env.USER ?? 'local';
  const runner = options.run ?? runProcess;
  const run = async (executable, args, extra = {}) => {
    const settings = { cwd: root, env, timeout: 120000, ...extra };
    const pathKeys = Object.keys(settings.env).filter((key) => key.toUpperCase() === 'PATH');
    const paths = (process.platform === 'win32' ? pathKeys : ['PATH']).flatMap((key) =>
      (settings.env[key] ?? '').split(delimiter),
    );
    settings.env = { ...settings.env };
    if (process.platform === 'win32') for (const key of pathKeys) delete settings.env[key];
    settings.env.PATH = [...new Set([dirname(node), ...paths])].join(delimiter);
    const startedAt = new Date().toISOString();
    const started = Date.now();
    let result;
    try {
      result = await runner(executable, args, settings);
      if (!result || !(settings.allowExitCodes ?? [0]).includes(result.code))
        throw result ?? new Error('Missing command result');
    } catch (cause) {
      const failure = failedCommand(executable, args, cause, settings.env);
      if (settings.record)
        await recordCommand(
          { root, runId, env: settings.env },
          {
            executable,
            args,
            cwd: settings.cwd,
            actor,
            startedAt,
            durationMs: Date.now() - started,
            status: 'fail',
            code: cause?.code ?? cause?.cause?.code ?? null,
          },
          cause?.stdout ?? cause?.cause?.stdout,
          cause?.stderr ?? cause?.cause?.stderr ?? cause?.message,
        );
      throw failure;
    }
    if (settings.record)
      await recordCommand(
        { root, runId, env: settings.env },
        {
          executable,
          args,
          cwd: settings.cwd,
          actor,
          startedAt,
          durationMs: Date.now() - started,
          status: 'pass',
          code: result.code,
        },
        result.stdout,
        result.stderr,
      );
    return result;
  };
  const pnpmPath = options.pnpmPath ?? env.STARA_PNPM_CLI ?? env.npm_execpath;
  return {
    root,
    node,
    env,
    run,
    pnpmPath,
    runId,
    actor,
    candidate: options.candidate,
    sourceIdentity: options.sourceIdentity,
    output: options.output ?? console.log,
    fetch: options.fetch ?? globalThis.fetch,
    sleep: options.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    materialize: options.materialize ?? materializeIndex,
    materializeCommit: options.materializeCommit ?? materializeCommit,
    git: (args, extra) => run('git', args, extra),
    pnpm: (args, extra) => {
      if (!pnpmPath || !/pnpm\.(?:mjs|cjs|js)$/.test(pnpmPath)) {
        throw new Error(
          'Run through pnpm, or set STARA_PNPM_CLI to the pinned pnpm JavaScript entry point',
        );
      }
      return run(node, [pnpmPath, ...args], extra);
    },
  };
}
