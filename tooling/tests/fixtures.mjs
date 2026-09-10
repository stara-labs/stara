import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const owned = [];
export const revision = '1234567890abcdef1234567890abcdef12345678';
export const packageRecords = [
  { name: '@stara/web', relativePath: 'UI/web' },
  { name: '@stara/ui', relativePath: 'UI/shared' },
  { name: '@stara/api', relativePath: 'backend/api' },
  { name: '@stara/tooling', relativePath: 'tooling' },
];
export const passed = (stdout = '') => ({ code: 0, stdout, stderr: '' });

export async function write(root, path, value) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, value);
  return target;
}

export function writeJson(root, path, value) {
  return write(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

export function git(root, ...args) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  );
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  env.GIT_TERMINAL_PROMPT = '0';
  return execFileSync('git', ['-c', 'core.hooksPath=.git/no-test-hooks', ...args], {
    cwd: root,
    env,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function emptyWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'stara-control-workspace-'));
  owned.push(root);
  return root;
}

export async function workspace({ gitRepository = false } = {}) {
  const root = await emptyWorkspace();
  await writeJson(root, 'package.json', {
    name: 'stara',
    private: true,
    type: 'module',
    packageManager: 'pnpm@11.19.0',
    engines: { node: '24.16.0', pnpm: '11.19.0' },
    'simple-git-hooks': { 'pre-commit': 'pnpm check:commit', 'pre-push': 'pnpm check:push' },
    scripts: Object.fromEntries(
      [
        'format:check',
        'lint',
        'typecheck',
        'security:secrets',
        'security:dependencies',
        'tokens:check',
        'test:unit',
        'test:integration',
        'test:coverage',
        'test:mutation',
        'build',
        'test:e2e',
        'test:a11y',
      ].map((name) => [name, 'node -e "process.exit(0)"']),
    ),
  });
  await write(root, 'pnpm-workspace.yaml', 'packages:\n  - UI/*\n  - backend/*\n  - tooling\n');
  await write(root, 'pnpm-lock.yaml', 'lockfileVersion: "9.0"\n');
  await write(root, '.gitattributes', '* -text\n');
  await write(root, '.gitignore', 'node_modules/\n.artifacts/\n**/dist/\n');
  await symlink(
    fileURLToPath(new URL('../../node_modules', import.meta.url)),
    join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  for (const entry of packageRecords) {
    await writeJson(root, `${entry.relativePath}/package.json`, {
      name: entry.name,
      version: '0.0.0',
      private: true,
      type: 'module',
      scripts: {
        typecheck: 'exit 0',
        'test:unit': 'exit 0',
        'test:integration': 'exit 0',
        'test:coverage': 'exit 0',
        build: 'exit 0',
      },
      ...(entry.name === '@stara/web' ? { dependencies: { '@stara/ui': 'workspace:*' } } : {}),
    });
    await write(root, `${entry.relativePath}/src/index.js`, 'export const fixture = true;\n');
  }
  await write(root, 'UI/web/dist/index.html', '<!doctype html><title>Synthetic fixture</title>\n');
  await write(root, 'backend/api/dist/index.js', 'export const syntheticArtifact = true;\n');
  await writeJson(root, 'docs/product-system.json', { revision });
  await writeJson(root, '.artifacts/mutation/mutation.json', {
    schemaVersion: '1',
    files: {
      'tooling/lib/policy.mjs': {
        language: 'javascript',
        source: 'export const synthetic = true;',
        mutants: [
          {
            id: '0',
            mutatorName: 'BooleanLiteral',
            replacement: 'false',
            location: { start: { line: 1, column: 26 }, end: { line: 1, column: 30 } },
            status: 'Killed',
          },
        ],
      },
    },
  });
  const css = Buffer.from(':root { --synthetic: #123456; }\n');
  await write(root, 'UI/shared/src/styles/tokens.css', css);
  await writeJson(root, 'UI/shared/src/styles/tokens.provenance.json', {
    sourceRevision: revision,
    cssSha256: createHash('sha256').update(css).digest('hex'),
  });
  for (const name of ['web', 'ui', 'api', 'tooling']) {
    const record = packageRecords.find((item) => item.name === `@stara/${name}`);
    const total = {
      lines: { total: 100, covered: 90, pct: 90 },
      branches: { total: 100, covered: 85, pct: 85 },
    };
    const sourcePath =
      name === 'tooling' ? 'tooling/lib/synthetic.mjs' : `${record.relativePath}/src/index.js`;
    if (name === 'tooling') await write(root, sourcePath, 'export const synthetic = true;\n');
    await writeJson(root, `.artifacts/coverage/${name}/coverage-summary.json`, {
      total,
      [join(root, sourcePath)]: total,
    });
  }
  if (gitRepository) {
    git(root, 'init', '--initial-branch=main');
    git(root, 'config', 'user.name', 'Synthetic Control Test');
    git(root, 'config', 'user.email', 'control-test@example.invalid');
    git(root, 'config', 'core.autocrlf', 'false');
    git(root, 'config', 'commit.gpgsign', 'false');
    git(root, 'add', '--all');
    git(root, 'commit', '-m', 'Synthetic workspace baseline');
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  }
  return root;
}

export function captureEvidence(root) {
  const paths = [
    'UI/web/dist/index.html',
    'backend/api/dist/index.js',
    '.artifacts/mutation/mutation.json',
    ...['web', 'ui', 'api', 'tooling'].map(
      (name) => `.artifacts/coverage/${name}/coverage-summary.json`,
    ),
  ];
  const values = new Map(
    paths
      .filter((path) => existsSync(join(root, path)))
      .map((path) => [path, readFileSync(join(root, path))]),
  );
  return async (args) => {
    for (const [path, bytes] of values) {
      if (
        (args.includes('test:coverage') && path.includes('/coverage/')) ||
        (args.includes('test:mutation') && path.includes('/mutation/')) ||
        (args.includes('build') && path.includes('/dist/'))
      )
        await write(root, path, bytes);
    }
  };
}

export async function json(root, path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'));
}

export async function cleanupFixtures() {
  for (const root of owned.splice(0)) {
    const temporaryRoot = await realpath(tmpdir());
    const target = await realpath(root);
    const child = relative(temporaryRoot, target);
    if (
      !child ||
      isAbsolute(child) ||
      child === '..' ||
      child.startsWith(`..${sep}`) ||
      !target.split(sep).at(-1).startsWith('stara-control-workspace-')
    ) {
      throw new Error(`Refusing cleanup outside owned workspace fixture: ${target}`);
    }
    await rm(target, { recursive: true, force: true });
  }
}
