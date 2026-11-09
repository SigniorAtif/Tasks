// The whole cancel path in a real browser (#10, user story 56 of #6): add a
// class, cancel today's occurrence with a reason, reload, and the stripes and
// the reason are still there. Every value is made up.

import { type Browser, type BrowserContext, expect, type Page, test } from '@playwright/test';
import { signIn } from '../support/sign-in.ts';

const EVERY_DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

test('a cancelled class keeps its stripes and reason after a reload', async ({
  page,
  context,
  browser,
}) => {
  await signIn(context);
  await page.goto('/');

  await test.step('add a class on every day, so today has one', async () => {
    await page.getByRole('link', { name: 'Add a class' }).click();
    await page.getByLabel('Title', { exact: true }).fill('Pottery');
    await page.getByLabel('Location', { exact: true }).fill('Studio 4');
    // A new user has no groups, so the class makes its first one. A new group
    // tracks attendance, so the sheet offers Prof and Me.
    await page.getByLabel('Group name', { exact: true }).fill('Evening classes');
    for (const day of EVERY_DAY) {
      await page.getByRole('button', { name: day, exact: true }).click();
    }
    await page.getByLabel('Starts at').fill('10:00');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  });

  await test.step('cancel today’s with a reason: Me, I didn’t go', async () => {
    await todaysPottery(page).click();
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().includes('/api/v1/occurrences/'),
    );
    await page.getByRole('button', { name: /^Me / }).click();
    // Reload only once the server has it, or the reload would test a waiting change instead.
    expect((await saved).ok()).toBe(true);
    await expectSkipped(page);
  });

  await test.step('reload: the stripes and the reason are still there', async () => {
    await page.reload();
    await expectSkipped(page);
  });

  await test.step('a browser with no saved copy shows them too', async () => {
    // The reload drew the copy this browser keeps first, so it alone can't tell
    // whether the server kept the cancel. A fresh browser has only the server.
    const fresh = await signedInLike(browser, context);
    const freshPage = await fresh.newPage();
    await freshPage.goto('/');
    await expectSkipped(freshPage);
    await fresh.close();
  });
});

/** On a phone-sized screen the calendar shows one day, today, so there's one Pottery block. */
function todaysPottery(page: Page) {
  return page.getByRole('button', { name: /^Pottery, / });
}

async function expectSkipped(page: Page) {
  const block = todaysPottery(page);
  // The block's label ends with the reason, and with nothing after it: no
  // ", waiting to sync".
  await expect(block).toHaveAccessibleName(/, I skipped$/);
  await expect(block.getByText('I skipped', { exact: true })).toBeVisible();
  // The stripes, as drawn (time-grid.css), and the dashed edge that says "skipped".
  await expect(block).toHaveCSS('background-image', /^repeating-linear-gradient\(/);
  await expect(block).toHaveCSS('border-left-style', 'dashed');
}

/** A new browser context with the same session cookie and nothing else. */
async function signedInLike(browser: Browser, context: BrowserContext): Promise<BrowserContext> {
  return browser.newContext({ storageState: { cookies: await context.cookies(), origins: [] } });
}
