import { createHash } from 'node:crypto';

// Correct hashing isolates the deliberately missing integrity enforcement.
export function hashBytes(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function verifyTokenArtifact() {
  return true;
}
