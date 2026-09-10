import { createHash } from 'node:crypto';

export function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyTokenArtifact(css, provenance, consumer) {
  const revision = consumer?.revision;
  if (
    typeof revision !== 'string' ||
    !/^[a-f0-9]{40}$/i.test(revision) ||
    provenance?.sourceRevision !== revision
  )
    throw new Error('Token source revision does not match consumer');
  if (
    typeof provenance?.cssSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(provenance.cssSha256) ||
    hashBytes(css) !== provenance.cssSha256
  )
    throw new Error('Generated token CSS checksum mismatch');
  return true;
}
