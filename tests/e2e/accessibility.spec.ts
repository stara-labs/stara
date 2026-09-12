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
      await expect(page.getByRole('table', { name: 'Home coordination collection' })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
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
      await page.getByRole('button', { name: 'Home, 2 items need attention' }).click();
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
  const review = page.getByRole('button', {
    name: 'Review: Resolve client intake source conflict',
  });
  await review.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /Client intake source decision/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.screenshot({ path: testInfo.outputPath('text-zoom-conversation.png') });
  await page.getByRole('button', { name: 'Home, 2 items need attention' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('text-zoom-forced-colors.png') });
});
