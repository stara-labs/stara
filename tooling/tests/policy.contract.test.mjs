import { beforeAll, describe, expect, it } from 'vitest';

let policy;
beforeAll(async () => {
  const moduleUrl = new URL('../lib/policy.mjs', import.meta.url);
  policy = await import(/* @vite-ignore */ moduleUrl.href);
});

const packages = [
  { name: '@stara/web', relativePath: 'UI/web' },
  { name: '@stara/ui', relativePath: 'UI/shared' },
  { name: '@stara/api', relativePath: 'backend/api' },
];

function classify(files, overrides = {}) {
  return policy.classifyChanges({
    files,
    knownPackages: packages,
    baselineAvailable: true,
    ...overrides,
  });
}

function expectSelection(result, mode, targets) {
  expect(result.mode).toBe(mode);
  expect(Array.isArray(result.targets)).toBe(true);
  expect([...result.targets].sort()).toEqual([...targets].sort());
  expect(typeof result.reason).toBe('string');
  expect(result.reason.trim().length).toBeGreaterThan(0);
}

function expectAll(files, overrides) {
  expectSelection(
    classify(files, overrides),
    'all',
    packages.map(({ name }) => name),
  );
}

describe('classifyChanges: conservative complete-diff selection', () => {
  it.each([null, undefined, {}, '', 'README.md'].map((files) => [files]))(
    'rejects malformed diff inventory %j',
    (files) => {
      expect(() => classify(files)).toThrow();
    },
  );

  it.each(
    [
      null,
      undefined,
      {},
      [],
      [null],
      [...packages, packages[0]],
      [...packages, { name: '', relativePath: 'tooling' }],
      [...packages, { name: '@stara/other', relativePath: '../outside' }],
    ].map((knownPackages) => [knownPackages]),
  )('rejects malformed or ambiguous package inventory %j', (knownPackages) => {
    expect(() => classify([], { knownPackages })).toThrow(/\S/);
  });

  it.each([
    'UI/web/test/behavior.ts',
    'UI/web/__tests__/behavior.ts',
    'UI/web/component.test.ts',
    'UI/web/component.spec.tsx',
  ])('broadens protected test changes inside a known owner: %s', (file) => expectAll([file]));

  it('does not classify application-owned Markdown as root documentation', () => {
    expectSelection(classify(['UI/web/README.md']), 'affected', ['@stara/web']);
  });

  it('does not let a Markdown-looking root source name bypass controls', () => {
    expectAll(['README.md.js']);
  });

  it('broadens tooling changes even when tooling is a known pnpm package', () => {
    const knownPackages = [...packages, { name: '@stara/tooling', relativePath: 'tooling' }];
    expectSelection(
      classify(['tooling/lib/policy.mjs'], { knownPackages }),
      'all',
      knownPackages.map(({ name }) => name),
    );
  });

  it('returns all directly changed targets from a complete multi-package diff', () => {
    expectSelection(classify(['UI/web/src/main.tsx', 'backend/api/src/index.ts']), 'affected', [
      '@stara/web',
      '@stara/api',
    ]);
  });

  it('leaves shared-UI dependent expansion to native pnpm', () => {
    expectSelection(classify(['UI/shared/src/button.tsx']), 'affected', ['@stara/ui']);
  });

  it('deduplicates repeated paths and multiple files in the same package', () => {
    expectSelection(
      classify(['UI/web/src/a.ts', 'UI/web/src/a.ts', 'UI/web/src/b.ts']),
      'affected',
      ['@stara/web'],
    );
  });

  it('keeps both owners of a rename whose old and new paths are supplied', () => {
    expectSelection(classify(['UI/web/src/old.ts', 'UI/shared/src/new.ts']), 'affected', [
      '@stara/web',
      '@stara/ui',
    ]);
  });

  it('does not discard code when documentation occurs first in the diff', () => {
    expectSelection(classify(['docs/notes.md', 'UI/web/src/main.tsx']), 'affected', ['@stara/web']);
  });

  it.each([['docs/notes.md'], ['README.md'], ['docs/notes.md', 'README.md'], []])(
    'uses docs mode for a known-baseline documentation/no-op diff: %j',
    (...files) => {
      expectSelection(classify(files), 'docs', []);
    },
  );

  it.each([
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'vitest.config.mjs',
    'eslint.config.mjs',
    'AGENTS.md',
    '.github/workflows/ci.yml',
    'tooling/lib/policy.mjs',
    'tests/e2e/application.spec.ts',
    'docs/product-system.json',
    'UI/web/package.json',
    'UI/shared/package.json',
    'backend/api/package.json',
    'UI/removed-package/src/old.ts',
    'UI/web-other/src/not-web.ts',
    'mystery/file.txt',
    'UI/web',
  ])('broadens the complete selection for %s', (file) => {
    expectAll(['UI/web/src/main.tsx', file]);
  });

  it.each([[], ['docs/notes.md'], ['UI/web/src/main.tsx']])(
    'broadens when the baseline is missing: %j',
    (...files) => {
      expectAll(files, { baselineAvailable: false });
    },
  );

  it('broadens a deleted target absent from the current manifest inventory', () => {
    const current = packages.filter(({ name }) => name !== '@stara/api');
    expectSelection(
      classify(['backend/api/src/deleted.ts'], { knownPackages: current }),
      'all',
      current.map(({ name }) => name),
    );
  });

  it.each([null, undefined, 1, 'true'])(
    'does not trust ambiguous baseline %s',
    (baselineAvailable) => {
      try {
        const result = classify(['UI/web/src/main.tsx'], { baselineAvailable });
        expectSelection(
          result,
          'all',
          packages.map(({ name }) => name),
        );
      } catch (error) {
        if (error?.name === 'AssertionError') throw error;
        expect(error).toBeInstanceOf(Error);
      }
    },
  );

  it.each(['../UI/web/src/main.ts', '/UI/web/src/main.ts', 'UI/web/../../secret.txt', ''])(
    'never narrows an unsafe or ambiguous path %j',
    (file) => {
      try {
        expectAll([file]);
      } catch (error) {
        if (error?.name === 'AssertionError') throw error;
        expect(error).toBeInstanceOf(Error);
      }
    },
  );
});

const report = (target = '@stara/web', lines = 90, branches = 85) => ({
  target,
  total: { lines: { pct: lines }, branches: { pct: branches } },
});

describe('assertCoverage: every target independently meets both floors', () => {
  it.each(['lines', 'branches'])('identifies the failing target and %s metric', (metric) => {
    const value = report('@stara/web');
    value.total[metric].pct = 1;
    let error;
    try {
      policy.assertCoverage([value]);
    } catch (failure) {
      error = failure;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('@stara/web');
    expect(error.message).toContain(metric);
  });
  it('accepts perfect coverage independently for all targets', () => {
    expect(policy.assertCoverage(packages.map(({ name }) => report(name, 100, 100)))).toBe(true);
  });
  it('returns true at the exact floors for every target', () => {
    expect(policy.assertCoverage(packages.map(({ name }) => report(name)))).toBe(true);
  });

  it.each([
    [89.999, 100],
    [100, 84.999],
    [0, 0],
  ])('rejects lines=%s branches=%s despite a perfect aggregate and sibling', (lines, branches) => {
    expect(() =>
      policy.assertCoverage([
        report('repository-total', 100, 100),
        report('@stara/ui', 100, 100),
        report('@stara/web', lines, branches),
      ]),
    ).toThrow();
  });

  it.each(
    [null, undefined, [], {}, [null], [{}], [{ target: '@stara/web' }]].map((value) => [value]),
  )('rejects absent or malformed reports: %j', (reports) => {
    expect(() => policy.assertCoverage(reports)).toThrow();
  });

  for (const metric of ['lines', 'branches']) {
    it.each([undefined, null, '100', NaN, Infinity, -1, 100.001])(
      `rejects malformed ${metric} percentage %s`,
      (pct) => {
        const value = report();
        value.total[metric].pct = pct;
        expect(() => policy.assertCoverage([value])).toThrow();
      },
    );

    it(`rejects missing ${metric} totals`, () => {
      const value = report();
      delete value.total[metric];
      expect(() => policy.assertCoverage([value])).toThrow();
    });
  }

  it.each(['', ' ', undefined, null])('rejects unidentifiable target %j', (target) => {
    const value = report();
    value.target = target;
    expect(() => policy.assertCoverage([value])).toThrow();
  });

  it('rejects duplicate target reports even when both pass', () => {
    expect(() => policy.assertCoverage([report(), report()])).toThrow();
  });
});

const passing = (name = 'lint') => ({ name, required: true, status: 'pass' });

describe('assertRequiredResults: absence and uncertainty cannot pass', () => {
  it('accepts multiple explicit passing required checks', () => {
    expect(() => policy.assertRequiredResults([passing(), passing('unit')])).not.toThrow();
  });

  it.each([
    'error',
    'fail',
    'failed',
    'skip',
    'skipped',
    'pending',
    'unknown',
    'success',
    'PASS',
    '',
    null,
    undefined,
  ])('rejects required status %j among otherwise passing results', (status) => {
    expect(() =>
      policy.assertRequiredResults([
        passing(),
        { name: 'unit', required: true, status },
        passing('build'),
      ]),
    ).toThrow(/unit/);
  });

  it.each([undefined, null, [], {}, [null], [{}]].map((value) => [value]))(
    'rejects malformed/empty result set %j',
    (results) => {
      expect(() => policy.assertRequiredResults(results)).toThrow();
    },
  );

  it('rejects a missing status property', () => {
    expect(() => policy.assertRequiredResults([{ name: 'unit', required: true }])).toThrow();
  });

  it('rejects a missing required flag rather than silently skipping the check', () => {
    expect(() =>
      policy.assertRequiredResults([passing(), { name: 'unit', status: 'error' }]),
    ).toThrow();
  });

  it.each(['true', 1, null])('rejects ambiguous required flag %j', (required) => {
    expect(() =>
      policy.assertRequiredResults([passing(), { name: 'unit', required, status: 'pass' }]),
    ).toThrow();
  });

  it('rejects optional-only results', () => {
    expect(() =>
      policy.assertRequiredResults([{ name: 'optional', required: false, status: 'pass' }]),
    ).toThrow(/\S/);
  });

  it('permits an explicitly optional failure alongside all passing required checks', () => {
    expect(() =>
      policy.assertRequiredResults([
        passing(),
        { name: 'optional', required: false, status: 'error' },
      ]),
    ).not.toThrow();
  });

  it('rejects duplicate check names', () => {
    expect(() => policy.assertRequiredResults([passing(), passing()])).toThrow();
  });

  it.each(['', ' ', null, undefined])('rejects an unnamed required result %j', (name) => {
    expect(() =>
      policy.assertRequiredResults([{ name, required: true, status: 'pass' }]),
    ).toThrow();
  });
});

describe('validateLayout: public files have an explicit owner', () => {
  const allowed = [
    'AGENTS.md',
    'README.md',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.json',
    'vitest.config.mjs',
    'eslint.config.mjs',
    '.gitignore',
    '.gitattributes',
    '.github/workflows/ci.yml',
    'UI/web/src/main.tsx',
    'UI/web/vite.config.ts',
    'UI/web/Dockerfile',
    'UI/shared/src/index.ts',
    'backend/api/src/index.ts',
    'backend/api/wrangler.jsonc',
    'tooling/lib/policy.mjs',
    'tests/e2e/smoke.spec.ts',
    'docs/contracts/public-consumer.md',
    'UI/shared/src/generated/tokens.css',
    'UI/shared/src/generated/tokens.provenance.json',
    'UI/web/.env.example',
  ];

  it('accepts root global files, owned project files, and generated token output', () => {
    expect(policy.validateLayout(allowed)).toEqual([]);
  });

  it.each([
    'src/main.tsx',
    'components/Button.tsx',
    'index.html',
    'vite.config.ts',
    'wrangler.jsonc',
    'Dockerfile',
    'app.ts',
    'stara-product-system/README.md',
    'ProductSystem/source/tokens.json',
    'docs/product-system/private/source.md',
    'UI/shared/tokens/source.json',
    '.env',
    'UI/web/.env.local',
  ])('rejects forbidden tracked file %s even among valid files', (path) => {
    const violations = policy.validateLayout([...allowed, path]);
    expect(Array.isArray(violations)).toBe(true);
    expect(violations.length).toBeGreaterThan(0);
  });
});

function manifests() {
  return [
    { name: '@stara/root', relativePath: '.', private: true, devDependencies: { vitest: '5.0.0' } },
    {
      name: '@stara/web',
      relativePath: 'UI/web',
      dependencies: { '@stara/ui': 'workspace:*', react: '19.0.0' },
    },
    { name: '@stara/ui', relativePath: 'UI/shared', peerDependencies: { react: '^19.0.0' } },
    { name: '@stara/api', relativePath: 'backend/api', dependencies: { hono: '^4.0.0' } },
  ];
}

describe('validateDependencies: project edges and workspace boundaries', () => {
  it('accepts web -> shared UI, third-party dependencies, and root development tools', () => {
    expect(policy.validateDependencies(manifests())).toEqual([]);
  });

  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    it.each([
      ['@stara/web', '@stara/api'],
      ['@stara/ui', '@stara/web'],
      ['@stara/ui', '@stara/api'],
      ['@stara/api', '@stara/web'],
      ['@stara/api', '@stara/ui'],
    ])(`rejects forbidden %s -> %s in ${field}`, (from, to) => {
      const values = manifests();
      const owner = values.find(({ name }) => name === from);
      owner[field] = { ...owner[field], [to]: 'workspace:*' };
      const errors = policy.validateDependencies(values);
      expect(Array.isArray(errors)).toBe(true);
      expect(errors.length).toBeGreaterThan(0);
    });

    it.each(['1.0.0', '^1.0.0', '*', 'file:../shared', 'link:../shared', 'npm:@stara/ui@1.0.0'])(
      `rejects non-workspace internal version %s in ${field}`,
      (version) => {
        const values = manifests();
        values[1][field] = { '@stara/ui': version };
        expect(policy.validateDependencies(values).length).toBeGreaterThan(0);
      },
    );
  }

  it.each(['dependencies', 'optionalDependencies'])(
    'rejects root runtime packages in %s',
    (field) => {
      const values = manifests();
      values[0][field] = { react: '19.0.0' };
      expect(policy.validateDependencies(values).length).toBeGreaterThan(0);
    },
  );

  it('rejects unresolved internal workspace packages', () => {
    const values = manifests();
    values[1].dependencies['@stara/missing'] = 'workspace:*';
    expect(policy.validateDependencies(values).length).toBeGreaterThan(0);
  });
});
