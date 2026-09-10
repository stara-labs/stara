import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const width of [1440, 1100, 900, 700, 390]) {
  test(`UI-A11Y-01 @accessibility ${width}px light/dark inspection and reflow`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    for (const theme of ['dark', 'light']) {
      if (theme === 'light')
        await page.getByRole('button', { name: 'Switch to light theme' }).click();
      await expect(page.getByRole('button', { name: 'Review address decision' })).toBeVisible();
      await page.getByRole('button', { name: 'Review address decision' }).click();
      await expect(page.getByRole('complementary', { name: 'Context panel' })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const control = await page.getByRole('button', { name: 'Hide details' }).boundingBox();
      expect(control!.x + control!.width).toBeLessThanOrEqual(width);
      await page.getByRole('button', { name: 'Hide details' }).click();
      await expect(page.getByRole('button', { name: 'Review address decision' })).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}.png`) });
      for (const title of ['Design-partner preparation', 'Resolve client intake']) {
        await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
        await page
          .getByRole('dialog')
          .getByRole('button', { name: `Open ${title}`, exact: true })
          .click();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`${width}-${theme}-${title}.png`) });
      }
      await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Open Home', exact: true })
        .click();
    }
  });
}

test('UI-A11Y-02 @accessibility keyboard, 200 percent text, forced colors, reduced motion', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await page.goto('/');
  // Text-only zoom approximation: double computed text sizes without scaling controls.
  await page.evaluate(() => {
    const root = document.documentElement;
    const css = getComputedStyle(root);
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
        css.getPropertyValue(property).replace(/(\d+)px/g, (_, size) => `${Number(size) * 2}px`),
      );
    }
  });
  await page.getByRole('button', { name: 'Review address decision' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Which address should govern this form?' }),
  ).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('text-zoom-inspection.png') });
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Review address decision' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('text-zoom-forced-colors.png') });
});
