import { expect, test } from '@playwright/test';

test('UI-JOURNEY-01 same-origin health and bounded review', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['content-type']).toContain('application/json');
  expect(await health.json()).toEqual({ status: 'ok' });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Review address decision' }).click();
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'Context panel' })).toContainText(
    'Updated 12 days ago',
  );
  await page.getByRole('button', { name: 'Open activity', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Resolve client intake', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('tabpanel', { name: 'Resolve client intake', exact: true }),
  ).toContainText('External effect: None');
  await expect(
    page.getByRole('button', { name: /approve|authorize|use signed agreement|send/i }),
  ).toHaveCount(0);
});

test('UI-JOURNEY-02 selection, inspection, source and focus restoration', async ({ page }) => {
  await page.goto('/');
  const select = page.getByRole('button', {
    name: 'Select: Choose the governing address for the client form',
    exact: true,
  });
  await select.click();
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Context panel' })).toHaveCount(0);
  const review = page.getByRole('button', { name: 'Review address decision' });
  await review.click();
  const panel = page.getByRole('complementary', { name: 'Context panel' });
  await panel.getByRole('radio', { name: /Client account record/ }).check();
  await page.getByRole('tab', { name: 'Sources', exact: true }).click();
  await page.getByRole('button', { name: 'Hide details' }).click();
  await expect(review).toBeFocused();
  await review.click();
  await expect(page.getByRole('tab', { name: 'Sources', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(panel.getByRole('radio', { name: /Client account record/ })).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(review).toBeFocused();
});

test('UI-JOURNEY-03 tabs reorder by pointer and keyboard, then close and reopen', async ({
  page,
}) => {
  await page.goto('/');
  const conversation = page.locator('[data-context-id="conversation"]');
  await conversation.dragTo(page.locator('[data-context-id="work"]'));
  await expect(page.locator('[data-context-id]').nth(1)).toHaveAttribute(
    'data-context-id',
    'conversation',
  );
  await page.getByRole('tab', { name: /Design-partner preparation/ }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('[data-context-id]').nth(1)).toHaveAttribute('data-context-id', 'work');
  await page.getByRole('tab', { name: /Design-partner preparation/ }).click();
  await page
    .getByRole('textbox', { name: 'Conversation draft' })
    .fill('Preserve the evidence boundary.');
  await page.getByRole('button', { name: 'Select contribution from Human contributor' }).click();
  await page.getByRole('button', { name: 'Close Design-partner preparation' }).click();
  await expect(page.getByRole('status')).toContainText('Underlying work is unchanged');
  await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Open Design-partner preparation', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: 'Conversation draft' })).toHaveValue(
    'Preserve the evidence boundary.',
  );
  await expect(
    page.getByRole('button', { name: 'Select contribution from Human contributor' }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('UI-JOURNEY-04 real scrolling survives tab switches and panel transitions', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 460 });
  await page.goto('/');
  await page.getByRole('tab', { name: /Design-partner preparation/ }).click();
  const region = page.getByRole('region', { name: 'Design-partner preparation content' });
  await region.evaluate((element) => {
    element.scrollTop = 150;
  });
  const position = await region.evaluate((element) => element.scrollTop);
  expect(position).toBeGreaterThan(0);
  await page.getByRole('tab', { name: 'Home', exact: true }).click();
  await page.getByRole('tab', { name: /Design-partner preparation/ }).click();
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(position);
});

test('UI-JOURNEY-05 overflow retains manual order and canonical identities', async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Review address decision' }).click();
  await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
  const picker = page.getByRole('dialog');
  await expect(picker.getByRole('button', { name: /^Open / })).toHaveCount(7);
  await picker.getByRole('button', { name: 'Move Research evidence boundary earlier' }).click();
  await picker
    .getByRole('button', { name: 'Open Research evidence boundary', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: /Research evidence boundary/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Open Research evidence boundary', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: /Research evidence boundary/ })).toHaveCount(1);
});
