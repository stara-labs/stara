import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const bookworm =
  'node:24.16.0-bookworm-slim@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203';
const alpineNode =
  'node:24.16.0-alpine@sha256:21f403ab171f2dc89bad4dd69d7721bfd15f084ccb46cdd225f31f2bc59b5c9a';
const alpineNginx =
  'nginxinc/nginx-unprivileged:1.30.4-alpine@sha256:442753882674b49ae2c1de83ed67896131c0777f56df5005e356e62bc3f7e7ce';
const alpineRepair = 'RUN apk add --no-cache libcrypto3=3.5.8-r0 libssl3=3.5.8-r0';
const images = [
  ['backend/api/release.Dockerfile', alpineNode, 'node'],
  ['UI/web/release.Dockerfile', alpineNginx, '101'],
  ['tooling/release/Dockerfile', alpineNode, 'node'],
];
const source = (file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8');

// Match the repository's named-stage Dockerfile convention, not general shell syntax.
function stages(raw) {
  const result = [];
  for (const line of raw
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim())) {
    if (!line || line.startsWith('#')) continue;
    const from = line.match(/^FROM\s+(\S+)\s+AS\s+([\w-]+)$/i);
    if (from) result.push({ base: from[1], name: from[2], lines: [] });
    else {
      expect(result.length, 'Instruction outside a named stage').toBeGreaterThan(0);
      expect(line).not.toMatch(/^FROM\s/i);
      result.at(-1).lines.push(line);
    }
  }
  expect(result.length).toBeGreaterThan(1);
  expect(new Set(result.map((stage) => stage.name)).size).toBe(result.length);
  expect(result.at(-1).name).toBe('runtime');
  return result;
}

describe('lean release runtime images: static contract, not vulnerability clearance', () => {
  it.each(images)(
    '%s pins only the final runtime to approved Alpine and preserves builders',
    async (file, base, user) => {
      const parsed = stages(await source(file));
      expect(parsed.at(-1).base).toBe(base);
      for (const builder of parsed.slice(0, -1)) expect(builder.base).toBe(bookworm);
      expect(
        parsed
          .at(-1)
          .lines.filter((line) => /^USER\s/i.test(line))
          .at(-1),
      ).toBe(`USER ${user}`);
    },
  );

  it.each(['backend/api/release.Dockerfile', 'tooling/release/Dockerfile'])(
    '%s removes only bundled npm/Yarn trees and their launcher symlinks',
    async (file) => {
      const runtime = stages(await source(file)).at(-1);
      const commands = runtime.lines.filter(
        (line) => /^RUN\s/i.test(line) && line !== alpineRepair,
      );
      expect(commands, 'One explicit, reviewable runtime cleanup is required').toHaveLength(1);
      expect(commands[0]).toMatch(/^RUN\s+rm\s+-rf\s+/);
      const targets = commands[0]
        .replace(/^RUN\s+rm\s+-rf\s+/, '')
        .trim()
        .split(/\s+/);
      const required = [
        '/usr/local/lib/node_modules/npm',
        '/usr/local/bin/npm',
        '/usr/local/bin/npx',
        '/usr/local/bin/yarn',
        '/usr/local/bin/yarnpkg',
      ];
      expect(targets).toHaveLength(required.length + 1);
      expect(new Set(targets).size).toBe(targets.length);
      expect(targets).toEqual(expect.arrayContaining(required));
      const yarn = targets.filter((target) => !required.includes(target));
      expect(yarn).toHaveLength(1);
      expect(yarn[0]).toMatch(/^\/opt\/yarn-v(?:\*|[0-9]+\.[0-9]+\.[0-9]+)$/);
      expect(runtime.lines.indexOf(commands[0])).toBeLessThan(runtime.lines.indexOf('USER node'));
    },
  );

  it.each(['backend/api/release.Dockerfile', 'tooling/release/Dockerfile'])(
    '%s repairs only the two exact OpenSSL packages in its final Alpine runtime',
    async (file) => {
      const parsed = stages(await source(file));
      const runtime = parsed.at(-1);
      for (const stage of parsed) {
        const apkCommands = stage.lines.filter((line) => /\bapk\b/.test(line));
        expect(apkCommands).toEqual(stage === runtime ? [alpineRepair] : []);
      }
      expect(runtime.lines.indexOf(alpineRepair)).toBeLessThan(runtime.lines.indexOf('USER node'));
    },
  );

  it('uses the identical approved unprivileged NGINX image for the actual gateway', async () => {
    const document = parseDocument(await source('tests/e2e/release.compose.yaml'), {
      uniqueKeys: true,
    });
    expect(document.errors).toEqual([]);
    const gateway = document.toJS().services.gateway;
    expect(gateway.image).toBe(alpineNginx);
    expect(gateway.user).toBe('101');
    expect(gateway.read_only).toBe(true);
    expect(await source('tooling/release/pipeline.mjs')).toContain(`'${alpineNginx}'`);
  });

  it('does not hide package inventory or add CVE suppression in image recipes', async () => {
    for (const [file] of images) {
      const raw = await source(file);
      expect(raw).not.toMatch(
        /\/lib\/apk|\/var\/lib\/(?:apk|dpkg)|\/var\/lib\/rpm|\/usr\/lib\/sysimage\/rpm/,
      );
      expect(raw).not.toMatch(
        /\.trivyignore|TRIVY_IGNORE|--ignore-unfixed|--ignorefile|CVE-\d{4}-\d+/i,
      );
      const runtime = stages(raw).at(-1);
      expect(runtime.lines).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^(?:ADD|ONBUILD|SHELL)\s/i)]),
      );
      if (file === 'UI/web/release.Dockerfile')
        expect(runtime.lines.filter((line) => /^RUN\s/i.test(line))).toEqual([]);
    }
  });

  it('keeps the checksum-verified official GH binary and license in the lean control runtime', async () => {
    const parsed = stages(await source('tooling/release/Dockerfile'));
    const gh = parsed.find((stage) => stage.name === 'gh');
    expect(gh).toBeDefined();
    expect(gh.lines).toContain(
      'ADD --checksum=sha256:e4d4bb4498e8d007abe545b6568926793ace1b6447da598294a610018cb164be https://github.com/cli/cli/releases/download/v2.100.0/gh_2.100.0_linux_amd64.tar.gz /tmp/gh.tar.gz',
    );
    expect(parsed.at(-1).lines).toEqual(
      expect.arrayContaining([
        'COPY --from=gh /opt/gh/bin/gh /usr/local/bin/gh',
        'COPY --from=gh /opt/gh/LICENSE /usr/share/licenses/gh/LICENSE',
        'ENTRYPOINT ["node", "tooling/release/cli.mjs"]',
        'CMD ["execute"]',
      ]),
    );
  });
});
