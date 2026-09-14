import { expect, test } from '@playwright/test';

test('UI-JOURNEY-01 same-origin health and bounded review', async ({ page, request }) => {
  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['content-type']).toContain('application/json');
  expect(await health.json()).toEqual({ status: 'ok' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review: Resolve client intake source conflict' }).click();
  await expect(
    page.getByRole('heading', { name: 'Client intake source decision', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('tabpanel', { name: 'Client intake source decision', exact: true }),
  ).toContainText('External effect: None');
  await expect(
    page.getByRole('button', { name: /approve|authorize|use signed agreement|send/i }),
  ).toHaveCount(0);
});

test('UI-JOURNEY-02 selection, inspection, source and focus restoration', async ({ page }) => {
  await page.goto('/');
  const select = page.getByRole('button', {
    name: 'Resolve client intake source conflict Choose the governing address so the intake draft can advance.',
    exact: true,
  });
  await select.click();
  await expect(select).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('complementary', { name: 'Context panel' })).toHaveCount(0);
  const review = page.getByRole('button', {
    name: 'Review: Resolve client intake source conflict',
  });
  await review.click();
  await expect(page.getByRole('tab', { name: /Client intake source decision/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: /Client intake source decision/ })).toHaveCount(1);
});

test('UI-JOURNEY-03 tabs reorder by pointer and keyboard, then close and reopen', async ({
  page,
}) => {
  await page.goto('/');
  const conversation = page.locator('[data-context-id="conversation"]');
  await conversation.dragTo(page.locator('[data-context-id="work"]'));
  await expect(page.locator('[data-context-id]').nth(0)).toHaveAttribute(
    'data-context-id',
    'conversation',
  );
  await page.getByRole('tab', { name: /Design-partner preparation/ }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.locator('[data-context-id]').nth(0)).toHaveAttribute('data-context-id', 'work');
  await page.getByRole('tab', { name: /Design-partner preparation/ }).click();
  await page
    .getByRole('textbox', { name: 'Conversation draft' })
    .fill('Preserve the evidence boundary.');
  await page.getByRole('button', { name: 'Select contribution from Operations Lead' }).click();
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
    page.getByRole('button', { name: 'Select contribution from Operations Lead' }),
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
  await page.getByRole('button', { name: 'Home, 2 items need attention' }).click();
  await page.getByRole('tab', { name: /Design-partner preparation/ }).click();
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBe(position);
});

test('UI-JOURNEY-05 overflow retains manual order and canonical identities', async ({ page }) => {
  await page.setViewportSize({ width: 901, height: 800 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Review: Resolve client intake source conflict' }).click();
  await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Working contexts', exact: true });
  const openResearch = picker.getByRole('button', {
    name: 'Open Research evidence boundary',
    exact: true,
  });
  const researchTab = page.getByRole('tab', {
    name: 'Research evidence boundary, Unread material',
    exact: true,
  });
  await expect(picker.getByRole('button', { name: /^Open / })).toHaveCount(7);
  await expect(openResearch).toContainText('Conversation | Closed | Unread material');
  await expect(
    picker.getByRole('button', { name: /^Move Research evidence boundary (earlier|later)$/ }),
  ).toHaveCount(0);
  await picker.getByRole('searchbox', { name: 'Find a context', exact: true }).fill('Research');
  await expect(picker.getByRole('button', { name: /^Open / })).toHaveCount(1);
  await openResearch.click();
  await expect(researchTab).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'Show details', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Context panel' });
  await expect(inspector).toBeVisible();
  await expect(inspector).toHaveAttribute('data-overlay', 'false');
  await expect(page.locator('[data-context-id]')).toHaveCount(4);
  await expect(page.getByRole('tab', { name: /Resolve client intake/ })).toHaveCount(1);
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
  const contextTitles = picker.getByRole('button', { name: /^Open / }).locator('strong');
  await expect(contextTitles).toHaveText([
    'Prepare client onboarding plan',
    'Design-partner preparation',
    'Resolve client intake',
    'Client intake source decision',
    'Research evidence boundary',
    'Client onboarding coordination',
    'Onboarding source review',
  ]);
  await expect(openResearch).toContainText('Conversation | Open | Unread material');
  await expect(
    picker.getByRole('button', { name: 'Open Resolve client intake', exact: true }),
  ).toContainText('App activity | Open | Needs attention');
  await picker.getByRole('button', { name: 'Move Research evidence boundary earlier' }).click();
  const reorderedTitles = [
    'Prepare client onboarding plan',
    'Design-partner preparation',
    'Resolve client intake',
    'Research evidence boundary',
    'Client intake source decision',
    'Client onboarding coordination',
    'Onboarding source review',
  ];
  await expect(contextTitles).toHaveText(reorderedTitles);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Home, 2 items need attention' }).click();
  await expect(inspector).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
  await openResearch.click();
  await expect(researchTab).toHaveCount(1);
  await expect(researchTab).toHaveAttribute('id', 'tab-research');
  await expect(researchTab).toHaveAttribute('aria-controls', 'panel-research');
  await expect(researchTab).toHaveAttribute('aria-selected', 'true');
  await expect(inspector).toBeVisible();
  await page.getByRole('button', { name: 'Working contexts', exact: true }).click();
  await expect(picker.getByRole('button', { name: /^Open / })).toHaveCount(7);
  await expect(contextTitles).toHaveText(reorderedTitles);
  await expect(openResearch).toContainText('Conversation | Open | Unread material');
  await page.keyboard.press('Escape');
});

test('STR-2-JOURNEY-01 fixture-backed conversation creation is canonical and session only', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Conversations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Conversations', exact: true })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(3);

  await page.getByRole('button', { name: 'New Conversation', exact: true }).click();
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(
    page.getByRole('combobox', { name: 'Add People or Agents', exact: true }),
  ).toBeFocused();
  const start = page.getByRole('button', { name: 'Start conversation', exact: true });
  await message.fill('   ');
  await expect(start).toBeDisabled();
  await message.fill('Coordinate the evidence review with the responsible group');

  const add = page.getByRole('button', { name: 'Add People or Agents', exact: true });
  await add.click();
  const picker = page.getByRole('region', {
    name: 'Recent and recommended people and Agents',
    exact: true,
  });
  const search = picker.getByRole('searchbox', {
    name: 'Search people or Agents',
    exact: true,
  });
  await expect(search).toBeFocused();
  await picker.getByRole('checkbox', { name: /Customer lead/ }).check();
  await picker.getByRole('checkbox', { name: /Intake Agent/ }).check();
  await search.fill('does not exist');
  await expect(picker.getByText('No matching participants.', { exact: true })).toBeVisible();
  await search.fill('');
  await expect(picker.getByRole('checkbox', { name: /Customer lead/ })).toBeChecked();
  await picker.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Customer lead' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Intake Agent' })).toBeVisible();

  await message.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  const createdTitle = 'Coordinate the evidence review with the r…';
  await expect(page.getByRole('heading', { name: createdTitle, exact: true })).toBeVisible();
  await expect(page.getByText('No person or Agent was contacted.', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Coordinate the evidence review/ })).toHaveCount(1);

  await page.getByRole('button', { name: 'Conversations', exact: true }).click();
  await page.getByRole('button', { name: `Open ${createdTitle}`, exact: true }).click();
  await expect(page.getByRole('tab', { name: /Coordinate the evidence review/ })).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'Conversations', exact: true }).click();
  await expect(page.getByRole('button', { name: `Open ${createdTitle}`, exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('article')).toHaveCount(3);
});
