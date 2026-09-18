import { cp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveCheckoutFile, validateStaraCheckout } from '../plugins/stara/scripts/launch.mjs';

const source = fileURLToPath(new URL('../plugins/stara/', import.meta.url));
const catalog = fileURLToPath(new URL('../.agents/plugins/marketplace.json', import.meta.url));
export const setupDiagnostic =
  "Stara plugin setup failed. Use this helper's built checkout with its pinned Node, a new output under its .artifacts directory, and an HTTP loopback API origin.";

export async function configureStaraPlugin({
  repoRoot,
  destination,
  apiOrigin = 'http://127.0.0.1:3000',
}) {
  try {
    if (typeof destination !== 'string' || !isAbsolute(destination)) throw new Error();
    const helperRoot = resolve(await realpath(fileURLToPath(new URL('../../', import.meta.url))));
    if (typeof repoRoot !== 'string' || !isAbsolute(repoRoot)) throw new Error();
    if (resolve(repoRoot) !== helperRoot) throw new Error();
    await validateStaraCheckout(helperRoot, process.versions.node);
    const configuration = await resolveCheckoutFile(helperRoot, 'backend/api/dist/mcp/config.js');
    const { readMcpConfig } = await import(pathToFileURL(configuration).href);
    const origin = readMcpConfig({ STARA_API_URL: apiOrigin });
    const mcp = JSON.parse(await readFile(join(source, 'mcp.json'), 'utf8'));
    const catalogBytes = await readFile(catalog);
    mcp.mcpServers.stara.env = { STARA_REPO_ROOT: helperRoot, STARA_API_URL: origin };

    await mkdir(join(helperRoot, '.artifacts'), { recursive: true });
    const artifacts = resolve(await realpath(join(helperRoot, '.artifacts')));
    if (!artifacts.startsWith(`${helperRoot}${sep}`)) throw new Error();
    const requested = resolve(destination);
    if (!requested.startsWith(`${artifacts}${sep}`)) throw new Error();
    const parent = resolve(await realpath(dirname(requested)));
    if (parent !== artifacts && !parent.startsWith(`${artifacts}${sep}`)) throw new Error();
    const output = resolve(parent, basename(requested));
    if (!output.startsWith(`${artifacts}${sep}`)) throw new Error();
    const canonicalSource = resolve(await realpath(source));
    if (output === canonicalSource || output.startsWith(`${canonicalSource}${sep}`))
      throw new Error();

    // Exclusive creation prevents replacing a previously configured installation.
    await mkdir(output);
    await cp(source, join(output, 'plugins/stara'), { recursive: true });
    await mkdir(join(output, '.agents/plugins'), { recursive: true });
    await writeFile(join(output, '.agents/plugins/marketplace.json'), catalogBytes, {
      flag: 'wx',
    });
    await writeFile(join(output, 'plugins/stara/mcp.json'), `${JSON.stringify(mcp, null, 2)}\n`);
    await writeFile(
      join(output, 'plugins/stara/checkout.json'),
      `${JSON.stringify({ repoRoot: helperRoot }, null, 2)}\n`,
    );
  } catch {
    throw new Error(setupDiagnostic);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length < 4 || process.argv.length > 5) throw new Error();
    await configureStaraPlugin({
      repoRoot: process.argv[2],
      destination: process.argv[3],
      apiOrigin: process.argv[4],
    });
    console.log(
      'Stara plugin copy configured. Register its output directory as a local marketplace.',
    );
  } catch {
    console.error(setupDiagnostic);
    process.exitCode = 1;
  }
}
