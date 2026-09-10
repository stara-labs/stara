import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runWorkspace } from '../lib/workspace.mjs';

export async function main(argv = process.argv.slice(2), options = {}) {
  try {
    await runWorkspace(argv, options);
    return 0;
  } catch (error) {
    (options.error ?? console.error)(error.message);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main();
}
