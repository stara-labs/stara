import { cp } from 'node:fs/promises';
import { basename } from 'node:path';

// Deliberately unsafe: copies dirty worktree bytes instead of the Git index.
export async function materializeIndex(repo, destination) {
  await cp(repo, destination, {
    recursive: true,
    filter: (path) => basename(path) !== '.git',
  });
}
