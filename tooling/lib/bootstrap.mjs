import { createRequire } from 'node:module';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertUnlinked, exists, ownedTemporary, readJson } from './files.mjs';

export async function installHooks(runtime) {
  const { root } = runtime;
  const configured = await runtime.git(['config', '--get', 'core.hooksPath'], {
    allowExitCodes: [0, 1],
  });
  if (configured.code === 0 && configured.stdout.trim()) {
    runtime.output('Custom core.hooksPath preserved; automatic hook installation skipped.');
    return { installed: false, reason: 'custom-hooks-path' };
  }
  const hookDirectory = resolve(
    root,
    (await runtime.git(['rev-parse', '--git-path', 'hooks'])).stdout.trim(),
  );
  await assertUnlinked(hookDirectory);
  const manifest = await readJson(join(root, 'package.json'));
  const hooks = manifest['simple-git-hooks'];
  if (!hooks || typeof hooks !== 'object' || !Object.keys(hooks).length)
    throw new Error('Missing simple-git-hooks configuration');
  const require = createRequire(join(root, 'package.json'));
  const { PREPEND_SCRIPT } = require('simple-git-hooks');
  const existing = (await exists(hookDirectory)) ? await readdir(hookDirectory) : [];
  for (const [name, command] of Object.entries(hooks)) {
    if (name === 'preserveUnused') continue;
    if (!/^[a-z]+(?:-[a-z]+)*$/.test(name) || typeof command !== 'string')
      throw new Error('Invalid hook configuration');
    if (existing.includes(name)) {
      await assertUnlinked(join(hookDirectory, name));
      if ((await readFile(join(hookDirectory, name), 'utf8')) !== PREPEND_SCRIPT + command) {
        runtime.output(`Custom ${name} preserved; automatic hook installation skipped.`);
        return { installed: false, reason: 'custom-hook' };
      }
    }
  }
  await ownedTemporary(async (temp) => {
    const config = join(temp, 'hooks.json');
    await writeFile(config, JSON.stringify({ ...hooks, preserveUnused: true }));
    await runtime.pnpm(['exec', 'simple-git-hooks', config], { timeout: 30000 });
  });
  return { installed: true };
}

export async function bootstrap(runtime, { hooks = true } = {}) {
  const manifest = await readJson(join(runtime.root, 'package.json'));
  const nodeVersion = (
    await runtime.run(runtime.node, ['--version'], { timeout: 10000 })
  ).stdout.trim();
  if (nodeVersion !== `v${manifest.engines?.node}`)
    throw new Error(`Node ${manifest.engines?.node} is required; found ${nodeVersion}`);
  const pnpmVersion = (await runtime.pnpm(['--version'], { timeout: 10000 })).stdout.trim();
  if (manifest.packageManager !== `pnpm@${pnpmVersion}` || manifest.engines?.pnpm !== pnpmVersion) {
    throw new Error('pnpm does not match the pinned packageManager and engines');
  }
  await readFile(join(runtime.root, 'pnpm-lock.yaml'));
  await runtime.pnpm(['install', '--frozen-lockfile'], {
    timeout: 600000,
    env: { ...runtime.env, SKIP_INSTALL_SIMPLE_GIT_HOOKS: '1', SKIP_SIMPLE_GIT_HOOKS: '1' },
  });
  if (hooks) await installHooks(runtime);
  return true;
}
