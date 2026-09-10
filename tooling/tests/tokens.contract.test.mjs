import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import StyleDictionary from 'style-dictionary';
import { formattedVariables } from 'style-dictionary/utils';
import { cleanupFixtures, git, json, passed, workspace, write, writeJson } from './fixtures.mjs';

let control;
let createRuntime;
beforeAll(async () => {
  const workspaceUrl = new URL('../lib/workspace.mjs', import.meta.url);
  const processUrl = new URL('../lib/process.mjs', import.meta.url);
  control = await import(/* @vite-ignore */ workspaceUrl.href);
  ({ createRuntime } = await import(/* @vite-ignore */ processUrl.href));
});
afterEach(cleanupFixtures);

const syntheticTokens = {
  semantic: {
    light: { color: { surface: { $value: '#123456', $type: 'color' } } },
    dark: { color: { surface: { $value: '#fedcba', $type: 'color' } } },
  },
  component: { spacing: { small: { $value: '4px', $type: 'dimension' } } },
};

function runtime(root, overrides = {}) {
  return createRuntime({
    root,
    env: {},
    output: vi.fn(),
    run: async (command, args, options) => {
      if (command === 'git') return passed(git(options.cwd, ...args).toString());
      throw new Error(`Unexpected synthetic process: ${command}`);
    },
    ...overrides,
  });
}

async function sourceAndConsumer() {
  const root = await workspace();
  const source = await workspace({ gitRepository: true });
  await writeJson(source, 'tokens/tokens.json', syntheticTokens);
  git(source, 'add', '--all');
  git(source, 'commit', '-m', 'Synthetic token authority');
  const revision = git(source, 'rev-parse', 'HEAD').toString().trim();
  await writeJson(root, 'docs/product-system.json', {
    revision,
    tokenSource: 'tokens/tokens.json',
  });
  return { root, source, revision };
}

describe('token commands: explicit external source, deterministic public artifact', () => {
  it('projects only existing primitive spacing, radius and border values with exact public names', async () => {
    const tokens = structuredClone(syntheticTokens);
    tokens.primitive = {
      space: { 1: { $type: 'dimension', $value: '4px' } },
      radius: { control: { $type: 'dimension', $value: '6px' } },
      border: { hairline: { $type: 'dimension', $value: '1px' } },
      color: { brand: { $type: 'color', $value: '#abcdef' } },
      font: { brand: { $type: 'fontFamily', $value: 'Synthetic Sans' } },
    };
    const css = await control.generateCss(tokens);
    expect(css).toMatch(/--stara-space-1:\s*4px;/);
    expect(css).toMatch(/--stara-radius-control:\s*6px;/);
    expect(css).toMatch(/--stara-border-hairline:\s*1px;/);
    expect(css).not.toContain('--stara-color-brand:');
    expect(css).not.toContain('--stara-font-brand:');
    expect(css).not.toContain('--stara-space-2:');
    tokens.primitive.space[1].$value = '7px';
    expect(await control.generateCss(tokens)).toMatch(/--stara-space-1:\s*7px;/);
  });

  it('resolves light/dark semantic aliases without exposing primitive color variables', async () => {
    const tokens = structuredClone(syntheticTokens);
    tokens.primitive = { color: { brand: { $type: 'color', $value: '#abcdef' } } };
    tokens.semantic.light.color.surface.$value = '{primitive.color.brand}';
    const css = await control.generateCss(tokens);
    expect(css).toMatch(/--stara-color-surface:\s*#abcdef;/);
    expect(css).not.toContain('--stara-color-brand:');
    expect(css).not.toContain('{primitive.color.brand}');
  });

  it.each(['0px', '-1px', '16pt', 'bad'])(
    'rejects invalid typography dimension %s instead of emitting partial CSS',
    async (fontSize) => {
      const tokens = structuredClone(syntheticTokens);
      tokens.semantic.light.typography = {
        body: {
          $type: 'typography',
          $value: {
            fontFamily: 'Synthetic Sans',
            fontWeight: 400,
            fontSize,
            lineHeight: '24px',
            letterSpacing: '0px',
          },
        },
      };
      await expect(control.generateCss(tokens)).rejects.toThrow();
    },
  );

  it('projects valid typography from source pixel sizes and line height', async () => {
    const tokens = structuredClone(syntheticTokens);
    tokens.semantic.light.typography = {
      body: {
        $type: 'typography',
        $value: {
          fontFamily: 'Synthetic Sans',
          fontWeight: 400,
          fontSize: '16px',
          lineHeight: '24px',
          letterSpacing: '0px',
        },
      },
    };
    const css = await control.generateCss(tokens);
    expect(css).toMatch(/--stara-typography-body:/);
    expect(css).toContain('1.5');
    expect(css).not.toMatch(/NaN|Infinity|\[object Object\]/);
  });
  it('checks existing public CSS without invoking Git or reading a private checkout', async () => {
    const root = await workspace();
    const run = vi.fn(async () => {
      throw new Error('A public token check must not invoke external source tooling');
    });
    await expect(control.checkTokens(runtime(root, { run }))).resolves.not.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('detects changed public CSS through the real file-reading boundary', async () => {
    const root = await workspace();
    await write(root, 'UI/shared/src/styles/tokens.css', ':root { --synthetic: #ffffff; }\n');
    await expect(control.checkTokens(runtime(root))).rejects.toThrow();
  });

  it('detects a changed consumer revision even when CSS and its hash still agree', async () => {
    const root = await workspace();
    await writeJson(root, 'docs/product-system.json', { revision: 'f'.repeat(40) });
    await expect(control.checkTokens(runtime(root))).rejects.toThrow();
  });

  it('generates identical CSS on repeated calls using actual Style Dictionary', async () => {
    const first = await control.generateCss(syntheticTokens);
    const second = await control.generateCss(structuredClone(syntheticTokens));
    expect(Buffer.from(first)).toEqual(Buffer.from(second));
    expect(Buffer.from(first).toString()).toContain('#123456');
    expect(Buffer.from(first).toString()).toMatch(/--stara-color-surface/);
    expect(Buffer.from(first).toString()).toContain('[data-theme="dark"]');
    expect(Buffer.from(first).toString()).not.toMatch(/\[object Object\]|undefined/);
  });

  it('propagates a Style Dictionary constructor failure', async () => {
    class FailingDictionary {
      static hooks = StyleDictionary.hooks;
      constructor() {
        throw new Error('synthetic dictionary failure');
      }
    }
    await expect(
      control.generateCss(syntheticTokens, {
        StyleDictionary: FailingDictionary,
        formattedVariables,
      }),
    ).rejects.toThrow(/dictionary failure/);
  });

  it('propagates formatter failures instead of emitting a successful empty artifact', async () => {
    await expect(
      control.generateCss(syntheticTokens, {
        StyleDictionary,
        formattedVariables: () => {
          throw new Error('synthetic formatting failure');
        },
      }),
    ).rejects.toThrow(/formatting failure/);
  });

  it('updates only public CSS/provenance bound to the exact clean source revision', async () => {
    const { root, source, revision } = await sourceAndConsumer();
    await control.updateTokens(runtime(root), source);
    const css = await readFile(join(root, 'UI/shared/src/styles/tokens.css'));
    const provenance = await json(root, 'UI/shared/src/styles/tokens.provenance.json');
    expect(css.toString()).toContain('#123456');
    expect(provenance.sourceRevision).toBe(revision);
    expect(provenance.cssSha256).toBe(createHash('sha256').update(css).digest('hex'));
    expect(existsSync(join(root, 'tokens/tokens.json'))).toBe(false);
    expect(existsSync(join(root, 'stara-product-system'))).toBe(false);
    expect(git(source, 'status', '--porcelain').toString()).toBe('');
  });

  it('rejects a source checkout at a different revision before overwriting public artifacts', async () => {
    const { root, source } = await sourceAndConsumer();
    await writeJson(root, 'docs/product-system.json', {
      revision: 'f'.repeat(40),
      tokenSource: 'tokens/tokens.json',
    });
    const before = await readFile(join(root, 'UI/shared/src/styles/tokens.css'));
    await expect(control.updateTokens(runtime(root), source)).rejects.toThrow();
    expect(await readFile(join(root, 'UI/shared/src/styles/tokens.css'))).toEqual(before);
  });

  it.each(['unstaged', 'staged', 'untracked'])('rejects %s source contamination', async (mode) => {
    const { root, source } = await sourceAndConsumer();
    if (mode === 'untracked')
      await write(source, 'not-committed.txt', 'synthetic source contamination');
    else {
      await writeJson(source, 'tokens/tokens.json', {
        color: { altered: { value: '#ffffff', type: 'color' } },
      });
      if (mode === 'staged') git(source, 'add', '--all');
    }
    await expect(control.updateTokens(runtime(root), source)).rejects.toThrow();
  });

  it.each(['../outside.json', '/absolute/source.json', 'tokens/../../outside.json'])(
    'rejects escaping declared tokenSource %s',
    async (tokenSource) => {
      const { root, source, revision } = await sourceAndConsumer();
      await writeJson(root, 'docs/product-system.json', { revision, tokenSource });
      await expect(control.updateTokens(runtime(root), source)).rejects.toThrow();
    },
  );

  it('requires an explicitly provided source checkout', async () => {
    const root = await workspace();
    await expect(control.updateTokens(runtime(root))).rejects.toThrow();
  });
});
