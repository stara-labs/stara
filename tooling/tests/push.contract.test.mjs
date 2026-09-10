import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, readFile, readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { cleanupFixtures, git, json, passed, workspace, write, writeJson } from './fixtures.mjs';

let control;
let processControl;
beforeAll(async () => {
  control = await import(/* @vite-ignore */ new URL('../lib/workspace.mjs', import.meta.url).href);
  processControl = await import(
    /* @vite-ignore */ new URL('../lib/process.mjs', import.meta.url).href
  );
});
afterEach(cleanupFixtures);

const verdictPath = 'UI/shared/src/push-verdict.mjs';
const verdict = (bad) =>
  bad
    ? 'throw new Error("OUTGOING_COMMIT_UNIT_FAILURE");\n'
    : 'export const outgoingUnitPasses = true;\n';

async function candidateFixture({ bad = false } = {}) {
  const root = await workspace({ gitRepository: true });
  const tools = await workspace();
  await cp(fileURLToPath(new URL('../lib', import.meta.url)), join(root, 'tooling/lib'), {
    recursive: true,
  });
  await cp(fileURLToPath(new URL('../scripts', import.meta.url)), join(root, 'tooling/scripts'), {
    recursive: true,
  });
  const manifest = await json(root, 'package.json');
  manifest.syntheticIdentity = 'outgoing';
  await writeJson(root, 'package.json', manifest);
  const shared = await json(root, 'UI/shared/package.json');
  shared.scripts['test:unit'] = 'node src/push-verdict.mjs';
  await writeJson(root, 'UI/shared/package.json', shared);
  await write(root, verdictPath, verdict(false));
  git(root, 'add', '--all');
  git(root, 'commit', '-m', 'Synthetic candidate controls baseline');
  const base = git(root, 'rev-parse', 'HEAD').toString().trim();
  git(root, 'update-ref', 'refs/remotes/origin/main', base);
  await write(root, verdictPath, `${verdict(bad)}// Outgoing proposal\n`);
  git(root, 'add', '--all');
  git(root, 'commit', '-m', 'Synthetic outgoing proposal');
  const commit = git(root, 'rev-parse', 'HEAD').toString().trim();
  const tree = git(root, 'rev-parse', 'HEAD^{tree}').toString().trim();
  const probe = join(tools, 'pnpm-observations.jsonl');
  const pnpmPath = await write(
    tools,
    'pnpm.mjs',
    `
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const root = process.cwd();
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
appendFileSync(${JSON.stringify(probe)}, JSON.stringify({ args, root, identity: rootManifest.syntheticIdentity, hasGit: existsSync(join(root,'.git')), lock: readFileSync(join(root,'pnpm-lock.yaml'),'utf8'), config: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:npm|pnpm)_config_(?:store_dir|node_linker|package_import_method|modules_dir|virtual_store_dir|ignore_pnpmfile|pnpmfile|enable_global_virtual_store|verify_deps_before_run|confirm_modules_purge)$/i.test(key))), env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:NODE_OPTIONS|NODE_PATH|INIT_CWD|npm_config_userconfig|PNPM_HOME|STARA_SENTINEL|PATH)$/i.test(key))) })+'\\n');
if (args.includes('--version')) { process.stdout.write('11.19.0'); process.exit(0); }
if (args.includes('install')) process.exit(0);
const paths = ['UI/web','UI/shared','backend/api','tooling'];
const packages = paths.map((path) => ({...JSON.parse(readFileSync(join(root,path,'package.json'),'utf8')),path:join(root,path)}));
if (args.includes('list')) {
  const filters = args.flatMap((value,index) => value === '--filter' ? [args[index+1]] : []);
  const selected = filters.length ? packages.filter((pkg) => filters.some((filter) => filter === pkg.name || filter === '...'+pkg.name || (filter === '...@stara/ui' && pkg.name === '@stara/web'))) : [{name:rootManifest.name,path:root},...packages];
  process.stdout.write(JSON.stringify(selected.map(({name,path})=>({name,path})))); process.exit(0);
}
const name = args.includes('--filter') ? args[args.indexOf('--filter')+1] : null;
const script = args[args.indexOf('run')+1];
if (script === 'test:unit' && name === '@stara/ui') {
  const pkg = packages.find((item)=>item.name===name);
  if (pkg.scripts['test:unit'] === 'node src/push-verdict.mjs') {
    const child = spawnSync(process.execPath,[join(pkg.path,'src/push-verdict.mjs')],{encoding:'utf8',timeout:5000,windowsHide:true});
    process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? ''); process.exit(child.status ?? 1);
  }
}
if (script === 'build') {
  const path = name === '@stara/web' ? 'UI/web/dist/index.html' : 'backend/api/dist/index.js';
  mkdirSync(join(root,path,'..'),{recursive:true}); writeFileSync(join(root,path), 'Synthetic outgoing build output');
}
`,
  );
  return { root, tools, pnpmPath, probe, candidate: { commit, tree, base } };
}

function runtimeFor(fixture, options = {}) {
  const run = vi.fn(async (command, args, settings) => {
    if (command === 'git') return passed(git(settings.cwd, ...args).toString());
    return processControl.runProcess(command, args, settings);
  });
  return {
    root: fixture.root,
    pnpmPath: fixture.pnpmPath,
    run,
    runId: 'outgoing-fixture',
    actor: 'synthetic-test-author',
    output: vi.fn(),
    ...options,
  };
}

async function observations(fixture) {
  return (await readFile(fixture.probe, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function effectiveConfig(call, name) {
  const option = name.replaceAll('_', '-');
  for (const flag of [`--${option}`, `--config.${option}`]) {
    const index = call.args.indexOf(flag);
    if (index >= 0)
      return call.args[index + 1]?.startsWith('--') ? 'true' : (call.args[index + 1] ?? 'true');
    const assignment = call.args.find((arg) => arg.startsWith(`${flag}=`));
    if (assignment) return assignment.slice(flag.length + 1);
  }
  for (const prefix of ['pnpm', 'npm']) {
    const entry = Object.entries(call.config).find(
      ([key]) => key.toLowerCase() === `${prefix}_config_${name}`,
    );
    if (entry) return entry[1];
  }
}

describe('isolated package-manager configuration', () => {
  it.each(['commit', 'push'])(
    'keeps %s install and all child pnpm commands on the same owned store',
    async (stage) => {
      const fixture = await candidateFixture();
      if (stage === 'commit') {
        await write(fixture.root, verdictPath, `${verdict(false)}// Staged proposal\n`);
        git(fixture.root, 'add', verdictPath);
      }
      await control.runWorkspace([stage], runtimeFor(fixture));
      const calls = await observations(fixture);
      const install = calls.find(({ args }) => args.includes('install'));
      const afterInstall = calls.slice(calls.indexOf(install));
      expect(afterInstall.some(({ args }) => args.includes('format:check'))).toBe(true);
      const expected = {
        store_dir: effectiveConfig(install, 'store_dir'),
        node_linker: 'isolated',
        package_import_method: 'copy',
        modules_dir: 'node_modules',
        virtual_store_dir: 'node_modules/.pnpm',
        ignore_pnpmfile: 'true',
        pnpmfile: '',
        enable_global_virtual_store: 'false',
        verify_deps_before_run: 'error',
      };
      expect(expected.store_dir).toBeTruthy();
      expect(expected.store_dir.replaceAll('\\', '/')).not.toContain(
        fixture.root.replaceAll('\\', '/'),
      );
      for (const call of afterInstall) {
        for (const [name, value] of Object.entries(expected))
          expect
            .soft(
              effectiveConfig(call, name),
              `${stage}: ${call.args.join(' ')} must preserve ${name}`,
            )
            .toBe(value);
        expect(effectiveConfig(call, 'confirm_modules_purge')).not.toBe('false');
      }
    },
  );

  it.each([
    { stage: 'commit', drift: false },
    { stage: 'push', drift: false },
    { stage: 'commit', drift: true },
    { stage: 'push', drift: true },
  ])(
    'real pnpm frozen install preserves store and rejects dependency drift: $stage drift=$drift',
    async ({ stage, drift }) => {
      const fixture = await candidateFixture();
      const pnpm = process.env.STARA_TEST_PNPM_CLI ?? process.env.npm_execpath;
      expect(pnpm, 'Run this contract through pinned pnpm or provide STARA_TEST_PNPM_CLI').toMatch(
        /pnpm\.(?:mjs|cjs|js)$/,
      );
      await write(
        fixture.root,
        'pnpm-lock.yaml',
        `lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n  UI/shared: {}\n  UI/web:\n    dependencies:\n      '@stara/ui':\n        specifier: workspace:*\n        version: link:../shared\n  backend/api: {}\n  tooling: {}\n`,
      );
      await write(
        fixture.root,
        'tooling/scripts/untrusted-hook.cjs',
        'throw new Error("UNTRUSTED_PNPMFILE_EXECUTED");\n',
      );
      const rootManifest = await json(fixture.root, 'package.json');
      rootManifest.scripts['format:check'] = 'node tooling/scripts/nested-pnpm-probe.mjs';
      rootManifest.scripts['isolated:probe'] =
        'node -e "process.stdout.write(\'NESTED_PNPM_VERIFIED\')"';
      await writeJson(fixture.root, 'package.json', rootManifest);
      await write(
        fixture.root,
        'tooling/scripts/nested-pnpm-probe.mjs',
        `import { createRuntime } from '../lib/process.mjs';
const runtime = createRuntime();
if (runtime.env.pnpm_config_verify_deps_before_run !== 'error' || runtime.env.pnpm_config_pnpmfile !== '') throw new Error('Nested pnpm isolation configuration lost');
try {
  const result = await runtime.pnpm(['run','isolated:probe'], {timeout:10000});
  process.stdout.write(result.stdout);
} catch (error) {
  process.stderr.write('NESTED_RUNTIME_IDENTITY '+JSON.stringify({npmExecpath:process.env.npm_execpath,declaredPnpm:process.env.STARA_PNPM_CLI,selectedPnpm:runtime.pnpmPath,pathKeys:Object.keys(process.env).filter((key)=>/^(?:npm_execpath|STARA_PNPM_CLI)$/i.test(key)),node:process.execPath,argv:process.argv.slice(0,2),packaged:Boolean(process.pkg)})+'\\n');
  throw error;
}
`,
      );
      await write(
        fixture.root,
        'pnpm-workspace.yaml',
        'packages:\n  - UI/*\n  - backend/*\n  - tooling\npnpmfile: tooling/scripts/untrusted-hook.cjs\n',
      );
      git(
        fixture.root,
        'add',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'tooling/scripts/untrusted-hook.cjs',
        'tooling/scripts/nested-pnpm-probe.mjs',
        'package.json',
      );
      if (stage === 'push') git(fixture.root, 'commit', '-m', 'Synthetic real pnpm lockfile');
      const fake = await readFile(fixture.pnpmPath, 'utf8');
      await write(
        fixture.tools,
        'pnpm.mjs',
        fake.replace(
          "if (args.includes('install')) process.exit(0);",
          `
if (args.includes('install') || args.includes('format:check')) {
  writeFileSync(join(root,'.pnpmfile.cjs'),'throw new Error("UNTRUSTED_PNPMFILE_EXECUTED");');
  process.env.pnpm_config_global_pnpmfile = join(root,'tooling/scripts/untrusted-hook.cjs');
  if (${drift} && args.includes('format:check')) writeFileSync(join(root,'package.json'),JSON.stringify({...rootManifest,devDependencies:{'@stara/api':'workspace:*'}}));
  const child = spawnSync(process.execPath,[${JSON.stringify(pnpm)},...args],{cwd:root,env:process.env,encoding:'utf8',timeout:20000,windowsHide:true});
  await import('node:fs').then(({unlinkSync})=>unlinkSync(join(root,'.pnpmfile.cjs')));
  appendFileSync(${JSON.stringify(join(fixture.tools, 'real-pnpm.jsonl'))},JSON.stringify({args,status:child.status,stdout:child.stdout,stderr:child.stderr,error:child.error?.message,lock:readFileSync(join(root,'pnpm-lock.yaml'),'utf8'),metadata:existsSync(join(root,'node_modules/.modules.yaml'))?readFileSync(join(root,'node_modules/.modules.yaml'),'utf8'):null})+'\\n');
  process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? ''); process.exit(child.status ?? 1);
}
`,
        ),
      );
      const failure = await control.runWorkspace([stage], runtimeFor(fixture)).then(
        () => null,
        (error) => error,
      );
      const actual = (await readFile(join(fixture.tools, 'real-pnpm.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(actual[0].args).toContain('install');
      expect(actual[0].status, actual[0].stdout + actual[0].stderr).toBe(0);
      expect(
        parseYaml(actual[0].metadata).storeDir,
        'Actual pnpm must materialize module metadata before testing a subsequent command',
      ).toBeTruthy();
      const format = actual.find(({ args }) => args.includes('format:check'));
      expect(format).toBeDefined();
      if (drift) {
        expect(format.status, format.stdout + format.stderr).toBe(1);
        expect(format.stdout + format.stderr).toContain('ERR_PNPM_VERIFY_DEPS_BEFORE_RUN');
        expect(format.stdout + format.stderr).not.toContain('currentPnpmfiles is not iterable');
        expect(failure).not.toBeNull();
      } else {
        expect(format.status, format.stdout + format.stderr).toBe(0);
        expect(format.stdout).toContain('NESTED_PNPM_VERIFIED');
        expect(failure).toBeNull();
      }
      expect(actual.map(({ stdout, stderr }) => stdout + stderr).join('\n')).not.toContain(
        'UNTRUSTED_PNPMFILE_EXECUTED',
      );
      expect(format.metadata).toBe(actual[0].metadata);
      expect(format.lock).toBe(actual[0].lock);
    },
  );
});

async function dirt(fixture, { staged = true } = {}) {
  await write(fixture.root, verdictPath, `${verdict(false)}// Dirty passing fix\n`);
  if (staged) git(fixture.root, 'add', verdictPath);
  await write(fixture.root, verdictPath, `${verdict(false)}// Unstaged passing fix\n`);
  await write(fixture.root, 'docs/unrelated-scratch.md', 'preserve unrelated dirty scratch\n');
  return {
    index: git(fixture.root, 'ls-files', '--stage', '-z'),
    staged: git(fixture.root, 'show', `:${verdictPath}`),
    working: await readFile(join(fixture.root, verdictPath)),
    scratch: await readFile(join(fixture.root, 'docs/unrelated-scratch.md')),
  };
}

async function expectDirtPreserved(fixture, before) {
  expect(git(fixture.root, 'ls-files', '--stage', '-z')).toEqual(before.index);
  expect(git(fixture.root, 'show', `:${verdictPath}`)).toEqual(before.staged);
  expect(await readFile(join(fixture.root, verdictPath))).toEqual(before.working);
  expect(await readFile(join(fixture.root, 'docs/unrelated-scratch.md'))).toEqual(before.scratch);
}

const hookLine = (candidate, local = 'refs/heads/topic', remote = 'refs/heads/topic') =>
  `${local} ${candidate.commit} ${remote} ${candidate.base}\n`;

async function retainedManifests(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) result.push(...(await retainedManifests(join(root, entry.name))));
    else if (entry.name.endsWith('.json')) {
      const value = JSON.parse(await readFile(join(root, entry.name), 'utf8'));
      if (value.artifacts && value.sourceHashes) result.push(value);
    }
  }
  return result;
}

describe('outgoing push integrity: validate immutable objects, not local fixes', () => {
  it('pins the baseline ref before any candidate command can move it', async () => {
    const fixture = await candidateFixture();
    let moved = false;
    const state = runtimeFor(fixture, {
      run: async (command, args, settings) => {
        if (command === 'git') return passed(git(settings.cwd, ...args).toString());
        if (!moved) {
          moved = true;
          git(fixture.root, 'update-ref', 'refs/remotes/origin/main', fixture.candidate.commit);
        }
        return processControl.runProcess(command, args, settings);
      },
    });
    await control.runWorkspace(['push'], state);
    expect(moved).toBe(true);
    expect(
      await json(fixture.root, '.artifacts/gates/outgoing-fixture/selection.json'),
    ).toMatchObject({ mode: 'affected', candidate: fixture.candidate });
  });
  it('manual push retains the initially pinned candidate when HEAD moves during validation', async () => {
    const fixture = await candidateFixture({ bad: true });
    const before = await dirt(fixture);
    const newTree = git(fixture.root, 'write-tree').toString().trim();
    const replacement = git(
      fixture.root,
      'commit-tree',
      newTree,
      '-p',
      fixture.candidate.commit,
      '-m',
      'Synthetic moving HEAD',
    )
      .toString()
      .trim();
    let moved = false;
    const state = runtimeFor(fixture, {
      run: async (command, args, settings) => {
        if (command !== 'git') return processControl.runProcess(command, args, settings);
        const result = passed(git(settings.cwd, ...args).toString());
        if (
          !moved &&
          args.includes('rev-parse') &&
          args.some((arg) => /^HEAD(?:\^\{commit\})?$/.test(arg))
        ) {
          moved = true;
          git(fixture.root, 'update-ref', 'HEAD', replacement);
        }
        return result;
      },
    });
    const failure = await control.runWorkspace(['push'], state).then(
      () => null,
      (error) => error,
    );
    expect(moved).toBe(true);
    expect(failure?.message).toContain('OUTGOING_COMMIT_UNIT_FAILURE');
    expect(
      await json(fixture.root, '.artifacts/gates/outgoing-fixture/selection.json'),
    ).toMatchObject({ candidate: fixture.candidate });
    await expectDirtPreserved(fixture, before);
  });

  it('retains a build manifest bound to the outgoing tree, not dirty local source', async () => {
    const fixture = await candidateFixture();
    await dirt(fixture);
    await control.runWorkspace(['push'], runtimeFor(fixture));
    const builds = await retainedManifests(join(fixture.root, '.artifacts/gates/outgoing-fixture'));
    expect(builds.length).toBeGreaterThan(0);
    const expectedSource = createHash('sha256')
      .update(git(fixture.root, 'show', `${fixture.candidate.commit}:${verdictPath}`))
      .digest('hex');
    for (const build of builds) {
      expect(build).toMatchObject({
        revision: fixture.candidate.commit,
        dirty: false,
        candidate: fixture.candidate,
      });
      expect(build.sourceHashes[verdictPath]).toBe(expectedSource);
      expect(build.sourceHashes).not.toHaveProperty('docs/unrelated-scratch.md');
      expect(Object.keys(build.artifacts).length).toBeGreaterThan(0);
    }
  });

  it.each(['modify', 'add', 'delete', 'manifest', 'nested-dist', 'nested-coverage'])(
    'rejects persistent %s source drift caused by a candidate build',
    async (kind) => {
      const fixture = await candidateFixture();
      const fakePnpm = await readFile(fixture.pnpmPath, 'utf8');
      const drift = {
        modify: `writeFileSync(join(root,${JSON.stringify(verdictPath)}),'export const changedDuringBuild = true;\\n');`,
        add: "writeFileSync(join(root,'UI/shared/src/added-during-build.mjs'),'export const added = true;\\n');",
        delete: `await import('node:fs').then(({unlinkSync})=>unlinkSync(join(root,${JSON.stringify(verdictPath)})));`,
        manifest:
          "writeFileSync(join(root,'package.json'),JSON.stringify({...rootManifest,syntheticIdentity:'changed-during-build'}));",
        'nested-dist':
          "mkdirSync(join(root,'UI/shared/src/dist'),{recursive:true});writeFileSync(join(root,'UI/shared/src/dist/injected.mjs'),'export const injected = true;');",
        'nested-coverage':
          "mkdirSync(join(root,'UI/shared/src/coverage'),{recursive:true});writeFileSync(join(root,'UI/shared/src/coverage/injected.mjs'),'export const injected = true;');",
      }[kind];
      await write(
        fixture.tools,
        'pnpm.mjs',
        fakePnpm.replace("if (script === 'build') {", `if (script === 'build') { ${drift}`),
      );
      await expect(control.runWorkspace(['push'], runtimeFor(fixture))).rejects.toThrow(
        /source|identity|drift|changed/i,
      );
    },
  );

  it('broadens missing baseline history while retaining the exact outgoing commit and tree', async () => {
    const fixture = await candidateFixture();
    git(fixture.root, 'update-ref', '-d', 'refs/remotes/origin/main');
    await control.runWorkspace(['push'], runtimeFor(fixture));
    expect(
      await json(fixture.root, '.artifacts/gates/outgoing-fixture/selection.json'),
    ).toMatchObject({ mode: 'all', candidate: { ...fixture.candidate, base: null } });
  });
  it.each([true, false])(
    'a dirty passing fix cannot mask the outgoing unit failure (staged=%s)',
    async (staged) => {
      const fixture = await candidateFixture({ bad: true });
      const before = await dirt(fixture, { staged });
      const failure = await control.runWorkspace(['push'], runtimeFor(fixture)).then(
        () => null,
        (error) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure.message).toContain('OUTGOING_COMMIT_UNIT_FAILURE');
      await expectDirtPreserved(fixture, before);
    },
  );

  it('uses outgoing manifests, native pnpm selection and isolated install/environment', async () => {
    const fixture = await candidateFixture();
    const before = await dirt(fixture);
    const manifest = await json(fixture.root, 'package.json');
    manifest.syntheticIdentity = 'dirty-manifest';
    await writeJson(fixture.root, 'package.json', manifest);
    await write(fixture.root, 'pnpm-lock.yaml', 'synthetic dirty dependency lock\n');
    const state = runtimeFor(fixture, {
      env: {
        ...process.env,
        NODE_OPTIONS: '--conditions=synthetic-dirty',
        NODE_PATH: fixture.tools,
        INIT_CWD: fixture.root,
        npm_config_userconfig: join(fixture.tools, 'dirty.npmrc'),
        PNPM_HOME: fixture.root,
        STARA_SENTINEL: 'preserve-safe-setting',
        PATH: `${join(fixture.root, 'node_modules/.bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
    });
    await control.runWorkspace(['push'], state);
    const calls = await observations(fixture);
    const install = calls.find(({ args }) => args.includes('install'));
    expect(install).toBeDefined();
    expect(install.args).toEqual(
      expect.arrayContaining([
        '--frozen-lockfile',
        '--ignore-scripts',
        '--ignore-pnpmfile',
        '--store-dir',
      ]),
    );
    const native = calls.filter(({ args }) => args.includes('list'));
    expect(
      native.some(
        ({ args }) => args.includes('...@stara/ui') && args.includes('--fail-if-no-match'),
      ),
    ).toBe(true);
    for (const call of [install, ...native]) {
      expect(call.root).not.toBe(fixture.root);
      expect(call.hasGit).toBe(false);
      expect(call.identity).toBe('outgoing');
      expect(call.lock).not.toContain('dirty');
      expect(call.env.STARA_SENTINEL).toBe('preserve-safe-setting');
      for (const key of Object.keys(call.env))
        if (key !== 'STARA_SENTINEL' && key.toUpperCase() !== 'PATH')
          expect(call.env[key]).toBeUndefined();
      expect(
        Object.entries(call.env)
          .filter(([key]) => key.toUpperCase() === 'PATH')
          .flatMap(([, value]) => value.split(delimiter)),
      ).not.toContain(join(fixture.root, 'node_modules/.bin'));
    }
    await expectDirtPreserved(fixture, before);
  });

  it.each([false, true])(
    'retains candidate commit, tree and base in durable %s results',
    async (bad) => {
      const fixture = await candidateFixture({ bad });
      await dirt(fixture);
      const failure = await control.runWorkspace(['push'], runtimeFor(fixture)).then(
        () => null,
        (error) => error,
      );
      if (bad) expect(failure?.message).toContain('OUTGOING_COMMIT_UNIT_FAILURE');
      else expect(failure).toBeNull();
      const directory = '.artifacts/gates/outgoing-fixture';
      expect(await json(fixture.root, `${directory}/selection.json`)).toMatchObject({
        stage: 'push',
        candidate: fixture.candidate,
      });
      expect(await json(fixture.root, `${directory}/results.json`)).toMatchObject({
        stage: 'push',
        status: bad ? 'fail' : 'pass',
        candidate: fixture.candidate,
      });
    },
  );
});

describe('pre-push protocol: outgoing OIDs are authoritative', () => {
  it('retains both ref mappings when one commit is pushed as a branch and a lightweight tag', async () => {
    const fixture = await candidateFixture();
    const updates = [
      {
        localRef: 'refs/heads/topic',
        localOid: fixture.candidate.commit,
        remoteRef: 'refs/heads/topic',
        remoteOid: fixture.candidate.base,
      },
      {
        localRef: 'refs/tags/synthetic-lightweight',
        localOid: fixture.candidate.commit,
        remoteRef: 'refs/tags/synthetic-lightweight',
        remoteOid: fixture.candidate.base,
      },
    ];
    git(fixture.root, 'tag', 'synthetic-lightweight', fixture.candidate.commit);
    const stdin = updates
      .map(
        (update) =>
          `${update.localRef} ${update.localOid} ${update.remoteRef} ${update.remoteOid}\n`,
      )
      .join('');
    await control.runWorkspace(['push', '--hook'], runtimeFor(fixture, { stdin }));
    for (const name of ['selection', 'results']) {
      expect(
        await json(fixture.root, `.artifacts/gates/outgoing-fixture/${name}.json`),
      ).toMatchObject({ candidate: fixture.candidate, updates });
    }
  });

  it('retains separate identities, logs and build manifests for two passing outgoing commits', async () => {
    const fixture = await candidateFixture();
    await write(fixture.root, verdictPath, `${verdict(false)}// Second good outgoing commit\n`);
    git(fixture.root, 'add', verdictPath);
    git(fixture.root, 'commit', '-m', 'Synthetic second passing proposal');
    const second = {
      commit: git(fixture.root, 'rev-parse', 'HEAD').toString().trim(),
      tree: git(fixture.root, 'rev-parse', 'HEAD^{tree}').toString().trim(),
      base: fixture.candidate.base,
    };
    const stdin =
      hookLine(fixture.candidate, 'refs/heads/first', 'refs/heads/first') +
      hookLine(second, 'refs/heads/second', 'refs/heads/second');
    await control.runWorkspace(['push', '--hook'], runtimeFor(fixture, { stdin }));
    const aggregate = await json(fixture.root, '.artifacts/gates/outgoing-fixture/results.json');
    expect(aggregate).toMatchObject({ status: 'pass', candidates: [fixture.candidate, second] });
    expect(new Set(aggregate.results.map(({ runId }) => runId)).size).toBe(2);
    for (const result of aggregate.results) {
      const directory = `.artifacts/gates/${result.runId}`;
      for (const file of ['selection', 'results'])
        expect(await json(fixture.root, `${directory}/${file}.json`)).toMatchObject({
          candidate: result.candidate,
        });
      const logs = await json(fixture.root, `${directory}/snapshot/commands.json`);
      expect(logs.length).toBeGreaterThan(0);
      for (const log of logs) {
        expect(
          typeof (await readFile(
            join(fixture.root, directory, 'snapshot', log.stdoutFile),
            'utf8',
          )),
        ).toBe('string');
        expect(
          typeof (await readFile(
            join(fixture.root, directory, 'snapshot', log.stderrFile),
            'utf8',
          )),
        ).toBe('string');
      }
      const builds = await retainedManifests(join(fixture.root, directory));
      expect(builds.length).toBeGreaterThan(0);
      expect(builds.every((build) => build.candidate.commit === result.candidate.commit)).toBe(
        true,
      );
    }
  });
  it.each(['\n', '\r\n', ''])(
    'accepts the supported hook line ending %j without changing the OID',
    async (ending) => {
      const fixture = await candidateFixture();
      const stdin = hookLine(fixture.candidate).trimEnd() + ending;
      await control.runWorkspace(['push', '--hook'], runtimeFor(fixture, { stdin }));
      expect(
        await json(fixture.root, '.artifacts/gates/outgoing-fixture/results.json'),
      ).toMatchObject({ status: 'pass', candidate: fixture.candidate });
    },
  );
  it.each([false, true])(
    'validates non-HEAD outgoing commit with bad=%s, not the opposite HEAD verdict',
    async (bad) => {
      const fixture = await candidateFixture({ bad });
      await write(fixture.root, verdictPath, verdict(!bad));
      git(fixture.root, 'add', verdictPath);
      git(fixture.root, 'commit', '-m', 'Synthetic unrelated HEAD state');
      const state = runtimeFor(fixture, { stdin: hookLine(fixture.candidate) });
      const failure = await control.runWorkspace(['push', '--hook'], state).then(
        () => null,
        (error) => error,
      );
      if (bad) expect(failure?.message).toContain('OUTGOING_COMMIT_UNIT_FAILURE');
      else expect(failure).toBeNull();
      expect(
        await json(fixture.root, '.artifacts/gates/outgoing-fixture/results.json'),
      ).toMatchObject({ status: bad ? 'fail' : 'pass', candidate: fixture.candidate });
    },
  );

  it('cannot hide a failed second outgoing ref behind the first successful ref', async () => {
    const fixture = await candidateFixture({ bad: true });
    const first = { ...fixture.candidate, commit: fixture.candidate.base };
    const stdin =
      hookLine(first, 'refs/heads/first', 'refs/heads/first') +
      hookLine(fixture.candidate, 'refs/heads/second', 'refs/heads/second');
    const failure = await control
      .runWorkspace(['push', '--hook'], runtimeFor(fixture, { stdin }))
      .then(
        () => null,
        (error) => error,
      );
    expect(failure?.message).toContain('OUTGOING_COMMIT_UNIT_FAILURE');
    const evidence = await json(fixture.root, '.artifacts/gates/outgoing-fixture/results.json');
    expect(evidence.status).toBe('fail');
    expect(evidence.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ commit: first.commit }),
        fixture.candidate,
      ]),
    );
  });

  it('prevalidates every outgoing record before running any candidate', async () => {
    const fixture = await candidateFixture();
    const state = runtimeFor(fixture, {
      stdin: hookLine(fixture.candidate) + 'malformed second outgoing record\n',
      materializeCommit: vi.fn(async () => {
        throw new Error('MATERIALIZED_BEFORE_PROTOCOL_VALIDATION');
      }),
    });
    await expect(control.runWorkspace(['push', '--hook'], state)).rejects.toThrow();
    expect(
      state.run.mock.calls.some(
        ([, args]) =>
          args.includes('install') || args.includes('list') || args.includes('test:unit'),
      ),
    ).toBe(false);
    expect(state.materializeCommit).not.toHaveBeenCalled();
  });

  it.each(['', 'malformed', 'deletion', 'blob', 'tree', 'missing-object', 'annotated-tag'])(
    'fails closed for unsupported or invalid outgoing input: %s',
    async (kind) => {
      const fixture = await candidateFixture();
      let stdin = kind;
      if (kind === 'deletion')
        stdin = hookLine({ ...fixture.candidate, commit: '0'.repeat(40) }, '(delete)');
      if (kind === 'blob')
        stdin = hookLine({
          ...fixture.candidate,
          commit: git(fixture.root, 'rev-parse', `HEAD:${verdictPath}`).toString().trim(),
        });
      if (kind === 'tree')
        stdin = hookLine({ ...fixture.candidate, commit: fixture.candidate.tree });
      if (kind === 'missing-object')
        stdin = hookLine({ ...fixture.candidate, commit: 'f'.repeat(40) });
      if (kind === 'annotated-tag') {
        git(fixture.root, 'tag', '-a', 'synthetic-tag', '-m', 'Unsupported tag object');
        stdin = hookLine(
          {
            ...fixture.candidate,
            commit: git(fixture.root, 'rev-parse', 'refs/tags/synthetic-tag').toString().trim(),
          },
          'refs/tags/synthetic-tag',
          'refs/tags/synthetic-tag',
        );
      }
      const state = runtimeFor(fixture, { stdin });
      await expect(control.runWorkspace(['push', '--hook'], state)).rejects.toThrow();
      expect(
        state.run.mock.calls.some(
          ([, args]) =>
            args.includes('install') || args.includes('list') || args.includes('test:unit'),
        ),
      ).toBe(false);
    },
  );

  it('the real CLI consumes Git pre-push stdin rather than silently checking HEAD', async () => {
    const fixture = await candidateFixture();
    await write(fixture.root, verdictPath, verdict(true));
    git(fixture.root, 'add', verdictPath);
    git(fixture.root, 'commit', '-m', 'Synthetic failing HEAD not being pushed');
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(?:GIT_|NODE_OPTIONS$|NODE_PATH$)/i.test(key),
      ),
    );
    const child = spawnSync(
      process.execPath,
      [join(fixture.root, 'tooling/scripts/workspace.mjs'), 'push', '--hook'],
      {
        cwd: fixture.root,
        env: { ...env, STARA_PNPM_CLI: fixture.pnpmPath },
        input: hookLine(fixture.candidate),
        encoding: 'utf8',
        timeout: 20_000,
        windowsHide: true,
      },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    const directories = await readdir(join(fixture.root, '.artifacts/gates'));
    const evidence = await Promise.all(
      directories.map((name) => json(fixture.root, `.artifacts/gates/${name}/results.json`)),
    );
    expect(evidence).toContainEqual(
      expect.objectContaining({ status: 'pass', candidate: fixture.candidate }),
    );
  });
});

describe('pre-push input boundary: bounded streams and explicit malformed input', () => {
  it('preserves a UTF-8 ref name split across input buffers', async () => {
    const input = `refs/heads/caf\u00e9 ${'a'.repeat(40)} refs/heads/caf\u00e9 ${'b'.repeat(40)}\n`;
    const bytes = Buffer.from(input);
    const split = bytes.indexOf(0xc3) + 1;
    expect(
      await control.readPushInput(
        Readable.from([bytes.subarray(0, split), bytes.subarray(split)]),
        1000,
      ),
    ).toBe(input);
  });

  it('reads all streamed input chunks without dropping the final unterminated record', async () => {
    const chunks = ['refs/heads/topic ', 'a'.repeat(40), ' refs/heads/topic ', 'b'.repeat(40)];
    expect(await control.readPushInput(Readable.from(chunks), 1000)).toBe(chunks.join(''));
  });

  it('fails explicitly when stdin remains open beyond its bound', async () => {
    const input = new PassThrough();
    await expect(control.readPushInput(input, 20)).rejects.toThrow(/timed out/i);
    expect(input.destroyed).toBe(true);
  });

  it('rejects streamed input above its byte bound', async () => {
    await expect(
      control.readPushInput(Readable.from(['x'.repeat(1024 * 1024), 'y']), 1000),
    ).rejects.toThrow(/too large/i);
  });

  it('preserves a stream failure as an explicit input failure', async () => {
    const stream = Readable.from(
      (async function* () {
        yield 'partial record';
        throw new Error('SYNTHETIC_STDIN_FAILURE');
      })(),
    );
    await expect(control.readPushInput(stream, 1000)).rejects.toThrow(/SYNTHETIC_STDIN_FAILURE/);
  });

  it.each(
    [null, undefined, 3, {}, 'x'.repeat(1024 * 1024 + 1)].map((input, index) => [index, input]),
  )('rejects malformed direct input case %s', (_index, input) => {
    expect(() => control.parsePushInput(input)).toThrow();
  });

  it.each([
    `refs/heads/topic ${'g'.repeat(40)} refs/heads/topic ${'b'.repeat(40)}`,
    `refs/heads/topic ${'a'.repeat(40)} not-a-remote-ref ${'b'.repeat(40)}`,
    `refs/heads/topic ${'a'.repeat(40)} refs/heads/topic ${'b'.repeat(64)}`,
    `refs/heads/topic ${'a'.repeat(40)} refs/heads/topic ${'b'.repeat(40)}\n`.repeat(2),
  ])('rejects invalid object/ref fields or duplicate destination: %s', (input) => {
    expect(() => control.parsePushInput(input)).toThrow();
  });
});
