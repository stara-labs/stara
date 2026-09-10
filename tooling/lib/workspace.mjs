import { parseArgs } from 'node:util';
import { createRuntime } from './process.mjs';
import { bootstrap, installHooks } from './bootstrap.mjs';
import { environment } from './environment.mjs';
import { artifact, gateStage, layout } from './gates.mjs';
import { checkTokens, updateTokens } from './tokens.mjs';

export { bootstrap, installHooks } from './bootstrap.mjs';
export { composeSettings, environment } from './environment.mjs';
export {
  artifact,
  coverageReport,
  gateStage,
  layout,
  mutationReport,
  parsePushInput,
  packageInventory,
  runGates,
  runMaterializedGate,
  selectProposal,
} from './gates.mjs';
export { checkTokens, generateCss, updateTokens } from './tokens.mjs';

export async function readPushInput(stream = process.stdin, timeout = 5000) {
  stream.setEncoding('utf8');
  const timer = setTimeout(() => stream.destroy(new Error('Pre-push input timed out')), timeout);
  try {
    let input = '';
    for await (const chunk of stream) {
      input += chunk.toString();
      if (Buffer.byteLength(input) > 1024 * 1024) throw new Error('Pre-push input is too large');
    }
    return input;
  } finally {
    clearTimeout(timer);
  }
}

export async function runWorkspace(argv, options = {}) {
  const [command, ...rest] = argv;
  const commands = [
    'bootstrap',
    'start',
    'dev',
    'down',
    'logs',
    'layout',
    'artifact',
    'tokens-update',
    'tokens-check',
    'hooks-install',
    'commit',
    'push',
    'pr',
  ];
  if (!commands.includes(command))
    throw new Error(`Unknown command: ${command}. Usage: workspace.mjs <${commands.join('|')}>`);
  const { values, positionals } = parseArgs({
    args: rest,
    options:
      command === 'tokens-update'
        ? { source: { type: 'string' } }
        : command === 'push'
          ? { hook: { type: 'boolean' } }
          : {},
    allowPositionals: false,
  });
  if (positionals.length) throw new Error('Unexpected command arguments');
  const runtime = createRuntime(options);
  switch (command) {
    case 'bootstrap':
      return bootstrap(runtime);
    case 'start':
    case 'dev':
      await bootstrap(runtime);
      return environment(runtime, command);
    case 'down':
    case 'logs':
      return environment(runtime, command);
    case 'layout':
      return layout(runtime);
    case 'artifact':
      return artifact(runtime);
    case 'tokens-update':
      return updateTokens(runtime, values.source);
    case 'tokens-check':
      return checkTokens(runtime);
    case 'hooks-install':
      return installHooks(runtime);
    case 'push':
      return gateStage(
        runtime,
        command,
        values.hook ? (options.stdin ?? (await readPushInput())) : undefined,
      );
    default:
      return gateStage(runtime, command);
  }
}
