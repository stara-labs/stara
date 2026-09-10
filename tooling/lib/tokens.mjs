import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertUnlinked, readJson, within } from './files.mjs';
import { hashBytes, verifyTokenArtifact } from './integrity.mjs';
import { safeRelativePath } from './policy.mjs';

export const tokenDirectory = 'UI/shared/src/styles';

export async function checkTokens(runtime) {
  const directory = join(runtime.root, tokenDirectory);
  verifyTokenArtifact(
    await readFile(join(directory, 'tokens.css')),
    await readJson(join(directory, 'tokens.provenance.json')),
    await readJson(join(runtime.root, 'docs/product-system.json')),
  );
  runtime.output(
    'Generated CSS checksum and declared consumer revision match. Upstream reproduction is not part of this check.',
  );
  return true;
}

export async function generateCss(tokens, overrides = {}) {
  const StyleDictionary = overrides.StyleDictionary ?? (await import('style-dictionary')).default;
  const formattedVariables =
    overrides.formattedVariables ?? (await import('style-dictionary/utils')).formattedVariables;
  const hooks = StyleDictionary.hooks ?? (await import('style-dictionary')).default.hooks;
  const typography = hooks.transforms['typography/css/shorthand'];
  const errors = [];
  const pixels = (value) => {
    if (
      typeof value !== 'string' ||
      !/^\d+(?:\.\d+)?px$/.test(value) ||
      Number.parseFloat(value) <= 0
    ) {
      throw new Error('Typography dimensions must be positive pixel values');
    }
    return Number.parseFloat(value);
  };
  const dictionary = new StyleDictionary({
    tokens,
    usesDtcg: true,
    log: { verbosity: 'silent', errors: { brokenReferences: 'throw' } },
    hooks: {
      transforms: {
        'stara/typography': {
          ...typography,
          transform: (token, platform, options) => {
            const value = token.$value;
            if (typeof value === 'string') return value;
            try {
              return typography.transform(
                {
                  ...token,
                  $value: {
                    ...value,
                    lineHeight: pixels(value.lineHeight) / pixels(value.fontSize),
                  },
                },
                platform,
                options,
              );
            } catch (error) {
              errors.push(error);
              throw error;
            }
          },
        },
      },
      formats: {
        'stara/css': ({ dictionary: resolved, options }) => {
          const allTokens = resolved.allTokens.map((token) => ({
            ...token,
            name: `stara-${token.path.filter((part, index) => index > 0 && !(index === 1 && ['light', 'dark'].includes(part))).join('-')}`,
          }));
          if (new Set(allTokens.map((token) => token.name)).size !== allTokens.length)
            throw new Error('Duplicate generated CSS variable');
          return `${options.selector} {\n${formattedVariables({ format: 'css', dictionary: { ...resolved, allTokens }, usesDtcg: true, outputReferences: false })}\n}\n`;
        },
      },
    },
    platforms: {
      css: {
        transforms: hooks.transformGroups.css.map((name) =>
          name === 'typography/css/shorthand' ? 'stara/typography' : name,
        ),
        files: ['light', 'dark'].map((theme) => ({
          destination: `${theme}.css`,
          format: 'stara/css',
          options: { selector: theme === 'light' ? ':root' : '[data-theme="dark"]' },
          filter: (token) =>
            theme === 'dark'
              ? token.path[0] === 'semantic' && token.path[1] === 'dark'
              : (token.path[0] === 'primitive' &&
                  ['space', 'radius', 'border'].includes(token.path[1])) ||
                token.path[0] === 'component' ||
                (token.path[0] === 'semantic' && token.path[1] !== 'dark'),
        })),
      },
    },
  });
  const files = await dictionary.formatPlatform('css');
  if (errors.length) throw new AggregateError(errors, 'Invalid typography');
  const css = files.map((file) => file.output).join('\n');
  if (!css.includes('--stara-') || !css.includes('[data-theme="dark"]'))
    throw new Error('Missing generated theme variables');
  return css;
}

export async function updateTokens(runtime, sourceCheckout) {
  if (!sourceCheckout)
    throw new Error('tokens-update requires --source <external Product System checkout>');
  const source = await realpath(sourceCheckout);
  const root = await realpath(runtime.root);
  if (source === root || within(root, source) || within(source, root))
    throw new Error('Product System checkout must be external');
  const consumer = await readJson(join(root, 'docs/product-system.json'));
  if (!/^[a-f0-9]{40}$/i.test(consumer.revision) || !safeRelativePath(consumer.tokenSource))
    throw new Error('Invalid consumer source revision or token path');
  const git = (args) => runtime.run('git', args, { cwd: source, timeout: 30000 });
  const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  if (revision !== consumer.revision)
    throw new Error('External checkout does not match exact consumer revision');
  if ((await git(['status', '--porcelain=v1', '--untracked-files=all'])).stdout.trim())
    throw new Error('External source checkout must be clean');
  const sourcePath = join(source, consumer.tokenSource);
  await assertUnlinked(sourcePath);
  if (!within(source, await realpath(sourcePath)))
    throw new Error('Token source escapes the external checkout');
  const blob = (await git(['show', `${revision}:${consumer.tokenSource}`])).stdout;
  const tokens = JSON.parse(blob);
  const require = createRequire(join(root, 'package.json'));
  const { default: StyleDictionary } = await import(
    pathToFileURL(require.resolve('style-dictionary')).href
  );
  const { formattedVariables } = await import(
    pathToFileURL(require.resolve('style-dictionary/utils')).href
  );
  const css = await generateCss(tokens, { StyleDictionary, formattedVariables });
  const provenance = {
    sourceRevision: revision,
    cssSha256: hashBytes(Buffer.from(css)),
    tokenSourceSha256: hashBytes(Buffer.from(blob)),
    generator: 'style-dictionary@5.5.3',
  };
  const directory = join(root, tokenDirectory);
  await assertUnlinked(directory);
  await assertUnlinked(join(directory, 'tokens.css'));
  await assertUnlinked(join(directory, 'tokens.provenance.json'));
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'tokens.css'), css);
  await writeFile(
    join(directory, 'tokens.provenance.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  runtime.output(
    `Generated CSS from external revision ${revision}. Independent reproduction remains required.`,
  );
  return provenance;
}
