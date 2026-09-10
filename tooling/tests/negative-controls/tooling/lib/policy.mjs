// Deliberately unsafe test double. It is never an application implementation.
export function classifyChanges({ files, knownPackages }) {
  const owner = knownPackages.find(({ relativePath }) =>
    files.some((file) => file.startsWith(relativePath)),
  );
  return {
    mode: owner ? 'affected' : 'docs',
    targets: owner ? [owner.name] : [],
    reason: 'Negative control ignores baseline, boundaries, and all later owners',
  };
}

export function assertCoverage() {
  return true;
}

export function assertRequiredResults() {
  return true;
}

export function validateLayout() {
  return [];
}

export function validateDependencies() {
  return [];
}
