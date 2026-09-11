const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const rootFiles = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'vitest.config.mjs',
  'eslint.config.mjs',
  'commitlint.config.mjs',
  'compose.yaml',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.node-version',
  '.npmrc',
  '.prettierignore',
  '.secretlintrc.json',
  '.secretlintignore',
  '.dockerignore',
]);

export function safeRelativePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !/[<>:"|?*\\]/.test(path) &&
    !Array.from(path).some((character) => character.charCodeAt(0) < 32) &&
    !path.startsWith('/') &&
    path
      .split('/')
      .every(
        (part) =>
          part &&
          part !== '.' &&
          part !== '..' &&
          part.toLowerCase() !== '.git' &&
          !/[. ]$/.test(part) &&
          !/^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(
            part,
          ),
      )
  );
}

export function classifyChanges({ files, knownPackages, baselineAvailable }) {
  if (
    !Array.isArray(files) ||
    !Array.isArray(knownPackages) ||
    !knownPackages.length ||
    knownPackages.some((pkg) => !pkg?.name || !safeRelativePath(pkg.relativePath)) ||
    new Set(knownPackages.map((pkg) => pkg.name)).size !== knownPackages.length
  ) {
    throw new Error('Invalid change inventory');
  }
  const all = (reason) => ({ mode: 'all', targets: knownPackages.map((pkg) => pkg.name), reason });
  if (baselineAvailable !== true) return all('Complete baseline unavailable');
  const targets = new Set();
  for (const file of files) {
    if (!safeRelativePath(file)) return all('Unsafe or ambiguous changed path');
    if (
      file === 'AGENTS.md' ||
      file === 'docs/product-system.json' ||
      file.endsWith('/package.json') ||
      /(?:^|\/)(?:tests?|__tests__)\//.test(file) ||
      /\.(?:test|spec)\.[^/]+$/.test(file)
    )
      return all('Changed contract, manifest, or tests');
    if (/^[^/]+\.md$/.test(file) || file.startsWith('docs/')) continue;
    const owner = knownPackages.find((pkg) => file.startsWith(`${pkg.relativePath}/`));
    if (!owner || owner.relativePath === 'tooling')
      return all('Global control or unknown ownership');
    targets.add(owner.name);
  }
  return targets.size
    ? {
        mode: 'affected',
        targets: [...targets],
        reason: 'All directly changed packages; pnpm expands dependents',
      }
    : { mode: 'docs', targets: [], reason: 'Documentation or no changed files' };
}

function namedEntries(values, field) {
  if (!Array.isArray(values) || !values.length) throw new Error('Required evidence is missing');
  const names = new Set();
  for (const value of values) {
    const name = value?.[field];
    if (typeof name !== 'string' || !name.trim() || names.has(name)) {
      throw new Error(`Missing or duplicate evidence ${field}`);
    }
    names.add(name);
  }
}

export function assertCoverage(reports) {
  namedEntries(reports, 'target');
  for (const report of reports) {
    for (const [metric, floor] of [
      ['lines', 90],
      ['branches', 85],
    ]) {
      const pct = report.total?.[metric]?.pct;
      if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < floor || pct > 100) {
        throw new Error(`${report.target}: ${metric} coverage must be at least ${floor}%`);
      }
    }
  }
  return true;
}

export function assertRequiredResults(results) {
  namedEntries(results, 'name');
  if (!results.some((item) => item.required === true)) throw new Error('No required checks');
  for (const item of results) {
    if (typeof item.required !== 'boolean' || (item.required && item.status !== 'pass')) {
      throw new Error(`Required check did not pass: ${item.name}`);
    }
  }
  return true;
}

export function validateLayout(files) {
  if (!Array.isArray(files)) throw new Error('Invalid tracked-file inventory');
  return files
    .filter((file) => {
      if (!safeRelativePath(file)) return true;
      const approvedExample = file === 'infra/gcp/terraform.tfvars.example';
      if (
        /(?:^|\/)\.terraform(?:\/|$)/.test(file) ||
        /(?:\.tfstate|\.tfplan)(?:\.|$)/i.test(file) ||
        (!approvedExample && /\.tfvars(?:\.|$)/i.test(file)) ||
        /(?:^|\/)(?:credentials[^/]*|application_default_credentials|service-account|gha-creds-[^/]*)\.json$/i.test(
          file,
        ) ||
        /\.(?:pem|p12|pfx|key)$/i.test(file)
      )
        return true;
      if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('/.env.example')) return true;
      if (
        /(?:^|\/)(?:stara-product-system|ProductSystem|private)(?:\/|$)/i.test(file) ||
        /(?:^|\/)tokens\/(?:source|tokens)\.json$/i.test(file)
      )
        return true;
      return !(
        rootFiles.has(file) ||
        /^[^/]+\.md$/.test(file) ||
        /^(?:\.github|docs|tooling|tests|UI\/(?:web|shared)|backend\/api|infra\/gcp)\//.test(file)
      );
    })
    .map((file) => `Forbidden tracked file: ${file}`);
}

export function validateDependencies(manifests) {
  if (!Array.isArray(manifests)) throw new Error('Invalid package inventory');
  const errors = [];
  const names = new Set(manifests.map((pkg) => pkg.name));
  for (const pkg of manifests) {
    for (const field of fields) {
      const deps = pkg[field] ?? {};
      if (
        pkg.relativePath === '.' &&
        ['dependencies', 'optionalDependencies'].includes(field) &&
        Object.keys(deps).length
      ) {
        errors.push('Root runtime dependencies are forbidden');
      }
      for (const [name, version] of Object.entries(deps)) {
        if (/^(?:file|link|portal):/.test(String(version)))
          errors.push(`${pkg.name}: local path dependencies are not isolated`);
        if (
          !name.startsWith('@stara/') &&
          !names.has(name) &&
          !String(version).startsWith('workspace:')
        )
          continue;
        if (!names.has(name) || typeof version !== 'string' || !version.startsWith('workspace:')) {
          errors.push(`${pkg.name}: ${name} must resolve through the workspace`);
        }
        if (pkg.relativePath !== '.' && !(pkg.name === '@stara/web' && name === '@stara/ui')) {
          errors.push(`${pkg.name} cannot depend on ${name}`);
        }
      }
    }
  }
  return errors;
}
