import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

const text =
  'Internal staging. Synthetic data only. Drafts are temporary and may be lost on reload or when this page closes.';
const label = 'Staging environment';

async function runtime(page: Page, environment: 'development' | 'staging' = 'staging') {
  test.info().annotations.push({
    type: 'evidence-scope',
    description:
      'Synthetic runtime-config interception; built web behavior only, not IAM or live staging acceptance.',
  });
  await page.route('**/api/runtime-config', async (route) => {
    const request = new URL(route.request().url());
    expect(request.pathname).toBe('/api/runtime-config');
    expect(request.origin).toBe(new URL(page.url()).origin);
    await route.fulfill({
      json: { schemaVersion: 1, environment },
      headers: { 'cache-control': 'no-store' },
    });
  });
}
async function notice(page: Page) {
  const note = page.getByRole('note', { name: label, exact: true });
  await expect(note).toHaveCount(1);
  await expect(note).toBeVisible();
  await expect(note).toHaveText(text);
  expect(await note.evaluate((element) => element.closest('[aria-live]') === null)).toBe(true);
  await expect(note.getByRole('button')).toHaveCount(0);
  return note;
}
async function fitsAndDoesNotCover(page: Page, note: Locator, controls: Locator[]) {
  const bounds = await note.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(
    await note.evaluate(
      (element) =>
        element.scrollWidth <= element.clientWidth + 1 &&
        element.scrollHeight <= element.clientHeight + 1,
    ),
  ).toBe(true);
  for (const control of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    const overlapping =
      bounds!.x < box!.x + box!.width &&
      box!.x < bounds!.x + bounds!.width &&
      bounds!.y < box!.y + box!.height &&
      box!.y < bounds!.y + bounds!.height;
    expect(overlapping).toBe(false);
    await control.click({ trial: true });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

async function paintedNoticeContrast(page: Page, note: Locator) {
  const bounds = await note.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const words = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      for (const match of (node.textContent ?? '').matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        const rect = range.getBoundingClientRect();
        words.push({
          x: rect.x - box.x,
          y: rect.y - box.y,
          width: rect.width,
          height: rect.height,
        });
      }
    }
    return { width: box.width, height: box.height, words };
  });
  const png = await note.screenshot({ scale: 'css' });
  // Analyze painted glyph regions, not authored computed colors or border pixels.
  const measured = await page.evaluate(
    async ({ data, bounds }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const colors = new Map<string, number>();
      for (let index = 0; index < pixels.length; index += 4) {
        const key = `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`;
        colors.set(key, (colors.get(key) ?? 0) + 1);
      }
      const background = [...colors].sort((a, b) => b[1] - a[1])[0][0];
      function luminance(color: string) {
        const [r, g, b] = color.split(',').map((channel) => {
          const value = Number(channel) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      const backgroundLuminance = luminance(background);
      return bounds.words.map((word) => {
        let contrastingPixels = 0;
        let sampledPixels = 0;
        let strongestContrast = 1;
        const xScale = image.width / bounds.width;
        const yScale = image.height / bounds.height;
        for (
          let y = Math.max(0, Math.ceil(word.y * yScale));
          y < Math.min(image.height, Math.floor((word.y + word.height) * yScale));
          y++
        ) {
          for (
            let x = Math.max(0, Math.ceil(word.x * xScale));
            x < Math.min(image.width, Math.floor((word.x + word.width) * xScale));
            x++
          ) {
            const index = (y * image.width + x) * 4;
            const foreground = luminance(
              `${pixels[index]},${pixels[index + 1]},${pixels[index + 2]}`,
            );
            const contrast =
              (Math.max(foreground, backgroundLuminance) + 0.05) /
              (Math.min(foreground, backgroundLuminance) + 0.05);
            strongestContrast = Math.max(strongestContrast, contrast);
            if (contrast >= 4.5) contrastingPixels++;
            sampledPixels++;
          }
        }
        return { strongestContrast, coverage: contrastingPixels / Math.max(1, sampledPixels) };
      });
    },
    { data: png.toString('base64'), bounds },
  );
  expect(measured).toHaveLength(text.match(/\S+/g)!.length);
  for (const word of measured) {
    expect(word.strongestContrast).toBeGreaterThanOrEqual(4.5);
    expect(word.coverage).toBeGreaterThanOrEqual(0.025);
  }
}

async function accessibility(page: Page, note: Locator, forcedColors: boolean) {
  if (forcedColors) {
    expect(await page.evaluate(() => window.matchMedia('(forced-colors: active)').matches)).toBe(
      true,
    );
    await paintedNoticeContrast(page, note);
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
  }
  try {
    // All axe rules remain enabled. Forced used colors can differ from the
    // authored computed colors consumed by axe's contrast calculation.
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    if (forcedColors) await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  }
}

test('REL-09 staging notice survives contexts, native dialogs, Escape, theme and reload', async ({
  page,
}) => {
  await runtime(page);
  await page.goto('/');
  await notice(page);
  await page.getByRole('tab', { name: /Design-partner preparation/ }).click();
  await page
    .getByRole('textbox', { name: 'Conversation draft' })
    .fill('Synthetic temporary draft.');
  await notice(page);
  await page.getByRole('button', { name: 'Inspect context' }).click();
  await notice(page);
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await notice(page);
  await page.getByRole('button', { name: 'Hide details' }).click();
  await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Working contexts', exact: true });
  await expect(picker.getByRole('note', { name: label })).toHaveText(text);
  await notice(page);
  await page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await notice(page);
  await page.getByRole('button', { name: 'New conversation' }).click();
  const dialog = page.getByRole('dialog', { name: 'New conversation', exact: true });
  await expect(dialog.getByRole('note', { name: label })).toHaveText(text);
  await notice(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await notice(page);
  await page.reload();
  await notice(page);
  await page.getByRole('tab', { name: /Design-partner preparation/ }).click();
  await expect(page.getByRole('textbox', { name: 'Conversation draft' })).not.toHaveValue(
    'Synthetic temporary draft.',
  );
});

for (const width of [1100, 900, 700]) {
  for (const accessible of [false, true]) {
    test(`REL-09 staging @accessibility ${width}px ${accessible ? '200 percent text forced colors reduced motion' : 'normal'} both themes and dialogs`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      if (accessible) await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
      await runtime(page);
      await page.goto('/');
      await notice(page);
      if (accessible) {
        // Same token-based text zoom approximation as the existing scaffold suite.
        await page.evaluate(() => {
          const root = document.documentElement;
          const computed = getComputedStyle(root);
          for (const role of [
            'workspace-title',
            'section-title',
            'body',
            'body-strong',
            'row-label',
            'control-label',
            'supporting',
            'micro',
          ]) {
            const property = `--stara-type-${role}`;
            root.style.setProperty(
              property,
              computed
                .getPropertyValue(property)
                .replace(/(\d+)px/g, (_match, size) => `${Number(size) * 2}px`),
            );
          }
        });
      }
      for (const theme of ['dark', 'light']) {
        if (theme === 'light')
          await page.getByRole('button', { name: 'Switch to light theme' }).click();
        let note = await notice(page);
        await fitsAndDoesNotCover(page, note, [
          page.getByRole('button', { name: 'Working contexts', exact: true }),
          page.getByRole('button', { name: 'Review: Resolve client intake source conflict' }),
        ]);
        await page
          .getByRole('button', { name: 'Review: Resolve client intake source conflict' })
          .focus();
        await page.keyboard.press('Enter');
        await expect(
          page.getByRole('tab', { name: /Client intake source decision/ }),
        ).toHaveAttribute('aria-selected', 'true');
        note = await notice(page);
        await accessibility(page, note, accessible);
        await page.screenshot({
          path: testInfo.outputPath(`${width}-${accessible}-${theme}-conversation.png`),
        });
        await page.getByRole('button', { name: 'Home, 2 items need attention' }).click();
        await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
        note = await notice(page);
        await fitsAndDoesNotCover(page, note, [
          page.getByRole('dialog').getByRole('searchbox', { name: 'Find a context' }),
        ]);
        await accessibility(page, note, accessible);
        await page.screenshot({
          path: testInfo.outputPath(`${width}-${accessible}-${theme}-picker.png`),
        });
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'New conversation' }).click();
        note = await notice(page);
        await fitsAndDoesNotCover(page, note, [page.getByRole('button', { name: 'Create draft' })]);
        await accessibility(page, note, accessible);
        await page.screenshot({
          path: testInfo.outputPath(`${width}-${accessible}-${theme}-new.png`),
        });
        await page.keyboard.press('Escape');
        await notice(page);
      }
    });
  }
}

test('REL-09 validated development omits the staging notice', async ({ page }) => {
  await runtime(page, 'development');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('note', { name: label })).toHaveCount(0);
});

for (const mode of ['missing', 'invalid', 'unavailable']) {
  test(`REL-09 ${mode} runtime config shows explicit failure without a shell`, async ({ page }) => {
    await page.route('**/api/runtime-config', async (route) => {
      if (mode === 'unavailable')
        await route.fulfill({ status: 503, body: 'synthetic-private-runtime-canary' });
      else
        await route.fulfill({
          json: mode === 'missing' ? {} : { schemaVersion: 1, environment: 'production' },
        });
    });
    await page.goto('/');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('synthetic-private-runtime-canary');
  });
}
