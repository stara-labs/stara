import { afterEach, describe, expect, it } from 'vitest';
import { candidateSourceFiles, listFiles } from '../lib/files.mjs';
import { validateLayout } from '../lib/policy.mjs';
import { cleanupFixtures, emptyWorkspace, write } from './fixtures.mjs';

afterEach(cleanupFixtures);

describe('Terraform caches: working scans exclude caches but candidate scans never hide them', () => {
  it.each(['.terraform', 'infra/gcp/delivery/.terraform', 'infra/gcp/target/.terraform'])(
    'omits generated %s provider bytes from the default working inventory',
    async (directory) => {
      const root = await emptyWorkspace();
      await write(
        root,
        `${directory}/providers/synthetic-provider.exe`,
        'synthetic cache, not an executable',
      );
      await write(root, `${directory}/terraform.tfstate`, '{"synthetic":true}');
      await write(root, 'infra/gcp/target/main.tf', '# synthetic source\n');
      await write(root, 'infra/gcp/target/.terraform.lock.hcl', '# synthetic provider lock\n');
      await write(root, 'docs/terraform.md', '# Terraform\n');
      expect((await listFiles(root)).sort()).toEqual([
        'docs/terraform.md',
        'infra/gcp/target/.terraform.lock.hcl',
        'infra/gcp/target/main.tf',
      ]);
    },
  );

  it('retains provided candidate cache bytes so the real layout policy denies them', async () => {
    const root = await emptyWorkspace();
    const supplied = [
      'infra/gcp/delivery/.terraform/providers/synthetic-provider.exe',
      'infra/gcp/target/.terraform/terraform.tfstate',
    ];
    for (const path of supplied) await write(root, path, 'synthetic candidate bytes');
    await write(root, 'infra/gcp/target/main.tf', '# synthetic source\n');
    const files = await candidateSourceFiles(root);
    expect(files).toEqual(expect.arrayContaining(supplied));
    for (const path of supplied) expect(validateLayout([path]).length).toBeGreaterThan(0);
    expect(validateLayout(files).length).toBeGreaterThan(0);
  });

  it('does not extend explicit inventories such as release output and evidence scans', async () => {
    const root = await emptyWorkspace();
    const path = 'infra/gcp/target/.terraform/providers/synthetic-provider.exe';
    await write(root, path, 'synthetic cache');
    expect(await listFiles(root, '', [])).toEqual([path]);
  });

  it.each(['gha-creds-synthetic.json', 'infra/gcp/gha-creds-synthetic.json'])(
    'never hides tracked/provided %s credentials from candidate denial',
    async (path) => {
      const root = await emptyWorkspace();
      await write(root, path, '{"synthetic":"not a real credential"}');
      expect(await candidateSourceFiles(root)).toContain(path);
      expect(validateLayout([path]).length).toBeGreaterThan(0);
    },
  );

  it('still exposes operational state, plans and private inputs outside the exact cache directory', async () => {
    const root = await emptyWorkspace();
    const paths = [
      'infra/gcp/target/terraform.tfstate',
      'infra/gcp/target/unsafe.tfplan',
      'infra/gcp/target/private.tfvars',
    ];
    for (const path of paths) await write(root, path, 'synthetic operational input');
    expect((await listFiles(root)).sort()).toEqual([...paths].sort());
    for (const path of paths) expect(validateLayout([path]).length).toBeGreaterThan(0);
  });
});
