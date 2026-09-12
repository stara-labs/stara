import { beforeAll, describe, expect, it } from 'vitest';

let inspectSarif;
beforeAll(async () => {
  const moduleUrl = new URL('../lib/codeql.mjs', import.meta.url);
  ({ inspectSarif } = await import(/* @vite-ignore */ moduleUrl.href));
});

const inherited = {
  ruleId: 'js/request-forgery',
  path: 'backend/api/src/synthetic.ts',
  fingerprint: 'synthetic-line-fingerprint:1',
  count: 1,
};

function result(overrides = {}) {
  return {
    ruleId: inherited.ruleId,
    ruleIndex: 0,
    level: 'warning',
    message: { text: 'Synthetic untrusted destination reaches a request.' },
    partialFingerprints: { primaryLocationLineHash: inherited.fingerprint },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: inherited.path, uriBaseId: '%SRCROOT%' },
          region: { startLine: 12, startColumn: 5 },
        },
      },
    ],
    ...overrides,
  };
}

function report(results = []) {
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [
      {
        tool: {
          driver: {
            name: 'CodeQL',
            semanticVersion: '2.27.0',
            rules: [
              {
                id: inherited.ruleId,
                defaultConfiguration: { level: 'warning' },
                properties: { 'security-severity': '9.1', tags: ['security'] },
              },
            ],
          },
        },
        results,
      },
    ],
  };
}

describe('CodeQL SARIF admission policy', () => {
  it('accepts a completed report with no findings', () => {
    expect(inspectSarif(report())).toMatchObject({
      findings: 0,
      baselineFindings: 0,
      newFindings: [],
    });
  });

  it.each(['warning', 'error', undefined])(
    'returns a new finding when level is %s, including rule default severity',
    (level) => {
      const finding = result({ level });
      if (level === undefined) delete finding.level;
      expect(inspectSarif(report([finding])).newFindings).toHaveLength(1);
    },
  );

  it('counts an exact reviewed baseline finding without concealing it', () => {
    expect(inspectSarif(report([result()]), [inherited])).toMatchObject({
      findings: 1,
      baselineFindings: 1,
      newFindings: [],
    });
  });

  it('resolves query rules from a SARIF tool extension', () => {
    const value = report([result()]);
    value.runs[0].tool.extensions = [
      { name: 'codeql/javascript-queries', rules: value.runs[0].tool.driver.rules },
    ];
    delete value.runs[0].tool.driver.rules;
    value.runs[0].results[0].rule = {
      id: inherited.ruleId,
      index: 0,
      toolComponent: { index: 0 },
    };
    delete value.runs[0].results[0].ruleIndex;
    expect(inspectSarif(value, [inherited]).newFindings).toHaveLength(0);
  });

  it('does not transfer an inherited fingerprint exemption to another rule or path', () => {
    const changedRule = result({ ruleId: 'js/another-security-query' });
    const changedPath = result();
    changedPath.locations[0].physicalLocation.artifactLocation.uri = 'backend/api/src/new.ts';
    const moved = report([changedRule, changedPath]);
    moved.runs[0].tool.driver.rules.push({ id: changedRule.ruleId });
    changedRule.ruleIndex = 1;
    expect(inspectSarif(moved, [inherited]).newFindings).toHaveLength(2);
  });

  it('matches equivalent Windows separators to the reviewed relative path', () => {
    const finding = result();
    finding.locations[0].physicalLocation.artifactLocation.uri = inherited.path.replaceAll(
      '/',
      '\\',
    );
    expect(inspectSarif(report([finding]), [inherited]).newFindings).toHaveLength(0);
  });

  it('blocks a changed fingerprint at an inherited location', () => {
    const changed = result({ partialFingerprints: { primaryLocationLineHash: 'changed:1' } });
    expect(inspectSarif(report([changed]), [inherited]).newFindings).toHaveLength(1);
  });

  it('blocks additional occurrences of an otherwise inherited finding', () => {
    const summary = inspectSarif(report([result(), result()]), [inherited]);
    expect(summary.baselineFindings).toBe(1);
    expect(summary.newFindings).toHaveLength(1);
  });

  it('does not replenish baseline occurrence counts between SARIF runs', () => {
    const candidate = report([result()]);
    candidate.runs.push(structuredClone(candidate.runs[0]));
    expect(inspectSarif(candidate, [inherited]).newFindings).toHaveLength(1);
  });

  it('does not accept a SARIF suppression as a local baseline approval', () => {
    const finding = result({ suppressions: [{ kind: 'inSource', status: 'accepted' }] });
    expect(inspectSarif(report([finding])).newFindings).toHaveLength(1);
  });

  it('cannot match the reviewed baseline when result fingerprints are absent', () => {
    const finding = result();
    delete finding.partialFingerprints;
    expect(inspectSarif(report([finding]), [inherited]).newFindings).toHaveLength(1);
  });

  it.each([
    null,
    {},
    { version: '2.1.0', runs: [] },
    { version: '2.0.0', runs: [] },
    { version: '2.1.0', runs: [{}] },
  ])('fails closed on malformed or empty analysis output: %j', (value) => {
    expect(() => inspectSarif(value)).toThrow();
  });

  it.each(['missing-results', 'null-results', 'wrong-tool', 'failed-invocation'])(
    'rejects incomplete analysis: %s',
    (mutation) => {
      const value = report();
      if (mutation === 'missing-results') delete value.runs[0].results;
      if (mutation === 'null-results') value.runs[0].results = null;
      if (mutation === 'wrong-tool') value.runs[0].tool.driver.name = 'Synthetic substitute';
      if (mutation === 'failed-invocation')
        value.runs[0].invocations = [{ executionSuccessful: false }];
      expect(() => inspectSarif(value)).toThrow();
    },
  );

  it.each(['../escape.ts', '/absolute.ts', 'file:///tmp/source.ts', 'C:/source.ts'])(
    'rejects a finding location outside the candidate: %s',
    (uri) => {
      const finding = result();
      finding.locations[0].physicalLocation.artifactLocation.uri = uri;
      expect(() => inspectSarif(report([finding]))).toThrow();
    },
  );

  it.each(['missing-rule', 'missing-locations', 'invalid-rule-index'])(
    'fails closed on malformed finding: %s',
    (mutation) => {
      const finding = result();
      if (mutation === 'missing-rule') {
        delete finding.ruleId;
        delete finding.ruleIndex;
      }
      if (mutation === 'missing-locations') delete finding.locations;
      if (mutation === 'invalid-rule-index') finding.ruleIndex = 999;
      expect(() => inspectSarif(report([finding]))).toThrow();
    },
  );

  it.each([
    [{ ...inherited, count: 0 }],
    [{ ...inherited, count: -1 }],
    [{ ...inherited, count: 1.5 }],
    [{ ...inherited, fingerprint: '' }],
    [{ ...inherited, path: '../escape.ts' }],
    [inherited, inherited],
  ])('rejects ambiguous or malformed baseline entries: %j', (baseline) => {
    expect(() => inspectSarif(report([result()]), baseline)).toThrow();
  });
});
