import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const startupDiagnostic =
  'Stara plugin could not start. Run plugin setup from the intended trusted Stara checkout with its pinned Node and a built @stara/api.';

export async function resolveCheckoutFile(root, child) {
  const directory = resolve(await realpath(root));
  const file = resolve(await realpath(join(directory, child)));
  if (!file.startsWith(`${directory}${sep}`)) throw new Error(startupDiagnostic);
  return file;
}

// Internal validator for a root whose authority the caller has already established.
export async function validateStaraCheckout(root, version) {
  try {
    const [workspace, api, pin] = await Promise.all([
      resolveCheckoutFile(root, 'package.json').then((file) => readFile(file, 'utf8')),
      resolveCheckoutFile(root, 'backend/api/package.json').then((file) => readFile(file, 'utf8')),
      resolveCheckoutFile(root, '.node-version').then((file) => readFile(file, 'utf8')),
    ]);
    if (
      JSON.parse(workspace).name !== 'stara' ||
      JSON.parse(api).name !== '@stara/api' ||
      pin.trim() !== version
    ) {
      throw new Error();
    }
    const entrypoint = await resolveCheckoutFile(root, 'backend/api/dist/mcp/index.js');
    return pathToFileURL(entrypoint).href;
  } catch {
    throw new Error(startupDiagnostic);
  }
}

export async function resolveStaraMcp({ env = process.env, version = process.versions.node } = {}) {
  try {
    const binding = JSON.parse(
      await readFile(new URL('../checkout.json', import.meta.url), 'utf8'),
    );
    if (typeof binding?.repoRoot !== 'string' || !isAbsolute(binding.repoRoot)) throw new Error();
    const root = env.STARA_REPO_ROOT;
    if (typeof root !== 'string' || !isAbsolute(root)) throw new Error();
    const selected = resolve(root);
    if (![resolve(binding.repoRoot)].includes(selected)) throw new Error();
    return await validateStaraCheckout(selected, version);
  } catch {
    throw new Error(startupDiagnostic);
  }
}

export async function launchStaraMcp({
  env = process.env,
  version = process.versions.node,
  load = (url) => import(url),
} = {}) {
  try {
    await load(await resolveStaraMcp({ env, version }));
  } catch {
    throw new Error(startupDiagnostic);
  }
}
