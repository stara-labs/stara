import { afterEach, expect, it } from 'vitest';
import { cleanupFixtures, git, workspace, write } from './fixtures.mjs';

afterEach(cleanupFixtures);

it('keeps the fixture dependency link out of both the committed tree and repeated staging', async () => {
  const root = await workspace({ gitRepository: true });
  expect(git(root, 'ls-files', '--stage', '--', 'node_modules').toString()).toBe('');
  expect(git(root, 'ls-tree', 'HEAD', '--', 'node_modules').toString()).toBe('');
  await write(root, 'UI/shared/src/restaged.js', 'export const restaged = true;\n');
  git(root, 'add', '--all');
  expect(git(root, 'ls-files', '--stage', '--', 'node_modules').toString()).toBe('');
  expect(git(root, 'diff', '--cached', '--name-only').toString()).toContain(
    'UI/shared/src/restaged.js',
  );
});
