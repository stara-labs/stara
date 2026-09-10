import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const sourceReferences = ['UI/shared/src', 'UI/web/src'].flatMap((directory) =>
  readdirSync(resolve(directory), { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.(css|tsx?)$/.test(path) && !/^styles[/\\]/.test(path))
    .flatMap((path) =>
      Array.from(
        readFileSync(join(directory, path), 'utf8').matchAll(/--stara-[\w-]+/g),
        (match) => match[0],
      ),
    ),
);

test('UI-TOKENS-01 every consumed design token resolves in the built artifact', async ({
  page,
}) => {
  await page.goto('/');
  const missing = await page.evaluate(async (references) => {
    const sheets = await Promise.all(
      Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).map(
        async (link) => (await fetch(link.href)).text(),
      ),
    );
    const names = new Set([
      ...references,
      ...Array.from(sheets.join('\n').matchAll(/var\((--stara-[\w-]+)/g), (match) => match[1]),
    ]);
    const root = document.documentElement;
    const originalTheme = root.dataset.theme;
    const failures = ['dark', 'light'].flatMap((theme) => {
      root.dataset.theme = theme;
      const css = getComputedStyle(root);
      return Array.from(names)
        .filter((name) => !css.getPropertyValue(name).trim())
        .map((name) => ({ theme, name }));
    });
    root.dataset.theme = originalTheme;
    return failures;
  }, sourceReferences);
  expect(missing).toEqual([]);
  const fonts = await page.evaluate(async () =>
    (await document.fonts.load('13px Inter')).map((font) => ({
      // CSSOM can retain matching family-name quotes in unminified dev styles.
      family: font.family.replace(/^(['"])(.*)\1$/, '$2'),
      status: font.status,
    })),
  );
  expect(fonts).toEqual([{ family: 'Inter', status: 'loaded' }]);
  const license = await page.request.get('/licenses/Inter-OFL.txt');
  expect(license.status()).toBe(200);
  expect(await license.text()).toContain('SIL OPEN FONT LICENSE');
});
